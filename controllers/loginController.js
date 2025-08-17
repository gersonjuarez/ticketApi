// controllers/loginController.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../models");
const { ApiError } = require("../middlewares/errorHandler");
const tokenBlacklist = require("../utils/tokenBlacklist");

const { User, Service, Cashier, sequelize, Sequelize } = db;
const { Op } = Sequelize;

module.exports = {
  // POST /api/register
  register: async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { userName, password, idRole, idCashier, email, fullName } = req.body;

      const username = String(userName).trim();
      const emailNorm = email ? String(email).trim().toLowerCase() : null;
      const fullNameNorm = String(fullName || "").trim();

      const exists = await User.findOne({
        where: { [Op.or]: [{ username }, { email: emailNorm }] },
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
          idCashier,
          status: true,
        },
        { transaction: t }
      );

      await t.commit();

      res.status(201).json({
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
      throw error;
    }
  },

  // POST /api/login
  login: async (req, res) => {
    const { user, password } = req.body;
    const usernameOrEmail = String(user || "").trim();

    const where = {
      [Op.or]: [{ username: usernameOrEmail }, { email: usernameOrEmail.toLowerCase() }],
      status: true,
    };

    const userLogin = await User.findOne({
      where,
      include: [
        {
          model: Cashier,
          attributes: ["idCashier", "name"],
          include: [{ model: Service, attributes: ["idService", "name", "prefix"] }],
          required: false,
        },
      ],
      attributes: ["idUser","username","idRole","idCashier","password","email","fullName","status"],
    });

    if (!userLogin) throw new ApiError("Usuario o Contraseña Incorrecto.", 401);

    const ok = await bcrypt.compare(password, userLogin.password);
    if (!ok) throw new ApiError("Usuario o Contraseña Incorrecto.", 401);

    // Generar JWT
    const token = jwt.sign(
      {
        sub: userLogin.idUser,
        username: userLogin.username,
        role: userLogin.idRole,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );

res.json({
  ok: true,
  token,
  username: userLogin.username,
  fullName: userLogin.fullName,
  email: userLogin.email,
  idRole: userLogin.idRole,
  idCashier: userLogin.idCashier,
  status: userLogin.status,
  // ⬇️ agrega esto si quieres que el front no decode el JWT
  idUser: userLogin.idUser,
  userSession: {
    idUser: userLogin.idUser,
    idRole: userLogin.idRole,
    idCashier: userLogin.idCashier,
    username: userLogin.username,
    fullName: userLogin.fullName,
    email: userLogin.email,
    status: userLogin.status,
    service: userLogin.Cashier?.Service
      ? {
          idService: userLogin.Cashier.Service.idService,
          name: userLogin.Cashier.Service.name,
          prefix: userLogin.Cashier.Service.prefix,
        }
      : null,
  },
  cashier: userLogin.Cashier
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
    : null,
});
  },

  // POST /api/logout
  logout: async (_req, res) => {
    try {
      if (_req.session) {
        await new Promise((resolve) => _req.session.destroy(() => resolve()));
      }

      const auth = _req.headers?.authorization;
      const bearer = auth && auth.startsWith("Bearer ") ? auth.slice(7) : null;
      if (bearer) {
        tokenBlacklist.add(bearer, 60 * 60 * 24);
      }

      res.clearCookie("token", { httpOnly: true, sameSite: "lax", secure: true });
      res.clearCookie("connect.sid");

      return res.json({ ok: true, message: "Sesión cerrada" });
    } catch (e) {
      throw new ApiError("No se pudo cerrar sesión", 500);
    }
  },
};
