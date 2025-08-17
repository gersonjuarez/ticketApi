// controllers/loginController.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../models");
const { ApiError } = require("../middlewares/errorHandler");
const tokenBlacklist = require("../utils/tokenBlacklist");

const { User, Service, Cashier, sequelize, Sequelize } = db;
const { Op } = Sequelize;

// Helpers
const normalizeEmail = (email) =>
  typeof email === "string" ? email.trim().toLowerCase() : null;

const isProd = process.env.NODE_ENV === "production";
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
const BLACKLIST_TTL_SECONDS = Number(process.env.JWT_BLACKLIST_TTL || 60 * 60 * 24); // 24h por defecto

if (!JWT_SECRET) {
  // Advertencia temprana en el arranque
  console.warn("[loginController] JWT_SECRET no está definido. Usa variables de entorno seguras.");
}

module.exports = {
  // POST /api/register
  register: async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
      const { userName, password, idRole, idCashier, email, fullName } = req.body;

      // Validaciones simples
      if (!userName || !password) {
        throw new ApiError("Usuario y contraseña son obligatorios", 400);
      }
      if (!idRole) {
        throw new ApiError("idRole es obligatorio", 400);
      }
      // idCashier puede ser opcional según tu modelo de negocio
      const username = String(userName).trim();
      const emailNorm = normalizeEmail(email);
      const fullNameNorm = String(fullName || "").trim();

      // Unicidad por username/email
      const exists = await User.findOne({
        where: {
          [Op.or]: [
            { username },
            ...(emailNorm ? [{ email: emailNorm }] : []),
          ],
        },
        transaction: t,
      });
      if (exists) throw new ApiError("El usuario o email ya existe", 409);

      const hash = await bcrypt.hash(password, 10);

      const user = await User.create(
        {
          username,
          email: emailNorm,
          fullName: fullNameNorm,
          password: hash,
          idRole,
          idCashier: idCashier ?? null,
          status: true,
        },
        { transaction: t }
      );

      await t.commit();

      return res.status(201).json({
        ok: true,
        user: {
          id: user.idUser ?? user.id,
          username: user.username,
          fullName: user.fullName,
          email: user.email,
          idRole: user.idRole,
          idCashier: user.idCashier,
          status: user.status,
        },
      });
    } catch (error) {
      if (t.finished !== "commit") await t.rollback();
      return next(error);
    }
  },

  // POST /api/login
  login: async (req, res, next) => {
    try {
      const { user, password } = req.body;

      if (!user || !password) {
        throw new ApiError("Usuario y contraseña son obligatorios", 400);
      }

      const usernameOrEmail = String(user || "").trim();
      const where = {
        [Op.or]: [
          { username: usernameOrEmail },
          { email: normalizeEmail(usernameOrEmail) },
        ],
        status: true, // solo usuarios activos
      };

      const userLogin = await User.findOne({
        where,
        include: [
          {
            model: Cashier,
            attributes: ["idCashier", "name", "idService", "status"],
            include: [
              {
                model: Service,
                attributes: ["idService", "name", "prefix", "status"],
              },
            ],
            required: false,
          },
          // Si tu User tiene relación directa a Service (opcional):
          // {
          //   model: Service,
          //   attributes: ["idService", "name", "prefix", "status"],
          //   required: false,
          // },
        ],
        attributes: [
          "idUser",
          "username",
          "idRole",
          "idCashier",
          "password",
          "email",
          "fullName",
          "status",
        ],
      });

      if (!userLogin) throw new ApiError("Usuario o Contraseña Incorrecto.", 401);

      const ok = await bcrypt.compare(password, userLogin.password);
      if (!ok) throw new ApiError("Usuario o Contraseña Incorrecto.", 401);

      // Si quieres exigir que la caja esté activa:
      // if (userLogin.Cashier && userLogin.Cashier.status === false) {
      //   throw new ApiError("La caja asignada está inactiva. Contacte al administrador.", 403);
      // }

      const tokenPayload = {
        sub: userLogin.idUser,
        username: userLogin.username,
        role: userLogin.idRole,
      };

      const token = jwt.sign(tokenPayload, JWT_SECRET || "insecure_dev_secret", {
        expiresIn: JWT_EXPIRES_IN,
      });

      // Opcional: setear cookie httpOnly (útil si manejas cookie en vez de header)
      // res.cookie("token", token, {
      //   httpOnly: true,
      //   sameSite: "lax",
      //   secure: isProd,
      //   maxAge: 1000 * 60 * 60 * 8, // 8h
      // });

      // Construir objetos limpios para el front
      const cashierObj = userLogin.Cashier
        ? {
            idCashier: userLogin.Cashier.idCashier,
            name: userLogin.Cashier.name,
            service: userLogin.Cashier.Service
              ? {
                  idService: userLogin.Cashier.Service.idService,
                  name: userLogin.Cashier.Service.name,
                  prefix: userLogin.Cashier.Service.prefix,
                }
              : null,
          }
        : null;

      // Prioriza el service a través de Cashier -> Service (como ya lo usas en el front)
      const serviceObj = userLogin.Cashier?.Service
        ? {
            idService: userLogin.Cashier.Service.idService,
            name: userLogin.Cashier.Service.name,
            prefix: userLogin.Cashier.Service.prefix,
          }
        : null;

      return res.json({
        ok: true,
        token,
        idUser: userLogin.idUser,
        username: userLogin.username,
        fullName: userLogin.fullName,
        email: userLogin.email,
        idRole: userLogin.idRole,
        idCashier: userLogin.idCashier,
        status: userLogin.status,

        // Estructura para que el front no tenga que decodificar el JWT:
        userSession: {
          idUser: userLogin.idUser,
          idRole: userLogin.idRole,
          idCashier: userLogin.idCashier,
          username: userLogin.username,
          fullName: userLogin.fullName,
          email: userLogin.email,
          status: userLogin.status,
          service: serviceObj, // { idService, name, prefix } o null
          cashier: cashierObj, // { idCashier, name, service? } o null
        },

        // Back-compat con tu AuthResponse actual:
        service: serviceObj,
        cashier: cashierObj,
      });
    } catch (err) {
      return next(err);
    }
  },

  // POST /api/logout
  logout: async (req, res, next) => {
    try {
      // Destruir sesión si existe (si usas express-session)
      if (req.session) {
        await new Promise((resolve) => req.session.destroy(() => resolve()));
      }

      // Añadir token al blacklist para invalidar su uso posterior
      const auth = req.headers?.authorization;
      const bearer = auth && auth.startsWith("Bearer ") ? auth.slice(7) : null;
      if (bearer) {
        tokenBlacklist.add(bearer, BLACKLIST_TTL_SECONDS);
      }

      // Limpiar cookies (si las usas)
      res.clearCookie("token", {
        httpOnly: true,
        sameSite: "lax",
        secure: isProd,
      });
      res.clearCookie("connect.sid");

      return res.json({ ok: true, message: "Sesión cerrada" });
    } catch (e) {
      return next(new ApiError("No se pudo cerrar sesión", 500));
    }
  },
};
