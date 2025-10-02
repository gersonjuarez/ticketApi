// server/controllers/user.controller.js
const bcrypt = require("bcryptjs");
const {
  Op,
  ValidationError,
  UniqueConstraintError,
  ForeignKeyConstraintError,
  DatabaseError,
} = require("sequelize");
const { User, Role, Cashier, Service, sequelize } = require("../models");
const { ApiError } = require("../middlewares/errorHandler");

/* ===========================
   Helpers
   =========================== */
const parseBool = (v, dflt) => {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1") return true;
  if (v === 0 || v === "0") return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "sí", "si"].includes(s)) return true;
    if (["false", "no"].includes(s)) return false;
  }
  return dflt;
};

const parseIntSafe = (v, dflt = null) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : dflt;
};

const sanitizeStr = (v, max) => {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
};

const parsePage = (v) => {
  const n = Number(v);
  // 0-based (consistente con otros endpoints)
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

const parsePageSize = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 200) : 20;
};

const parseSort = (by, dir) => {
  const allowed = new Set([
    "createdAt",
    "updatedAt",
    "fullName",
    "username",
    "email",
    "idRole",
    "status",
  ]);
  const sortBy = allowed.has(String(by)) ? String(by) : "createdAt";
  const sortDir = String(dir || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
  return [sortBy, sortDir];
};

const toPublicUser = (u) => {
  const plain = typeof u.get === "function" ? u.get({ plain: true }) : u;
  delete plain.password;
  return plain;
};

const isCashierRole = async (idRole) => {
  if (!idRole) return false;
  const role = await Role.findByPk(idRole, { attributes: ["idRole", "isCashier"] });
  return !!role && role.isCashier === true;
};

const mapSequelizeError = (err) => {
  if (err instanceof UniqueConstraintError) {
    return new ApiError("Registro duplicado (violación de unique)", 409, {
      fields: err.fields,
      errors: err.errors,
    });
  }
  if (err instanceof ValidationError) {
    return new ApiError("Error de validación de datos", 400, {
      errors: err.errors?.map((e) => ({ path: e.path, message: e.message })),
    });
  }
  if (err instanceof ForeignKeyConstraintError) {
    return new ApiError("Violación de integridad referencial (FK)", 409, {
      table: err.table,
      fields: err.fields,
    });
  }
  if (err instanceof DatabaseError) {
    return new ApiError("Error de base de datos", 500, { message: err.message });
  }
  return err;
};

/* ===========================
   Handlers
   =========================== */

/** GET /users (paginado, sin password) */
exports.findAll = async (req, res, next) => {
  try {
    const page = parsePage(req.query.page);
    const pageSize = parsePageSize(req.query.pageSize);
    const [orderBy, orderDir] = parseSort(req.query.orderBy, req.query.orderDir);
    const q = (req.query.q || "").toString().trim();

    const where = {};
    if (q) {
      const term = `%${q}%`;
      where[Op.or] = [
        { fullName: { [Op.like]: term } },
        { username: { [Op.like]: term } },
        { email: { [Op.like]: term } },
      ];
    }
    const idRole = parseIntSafe(req.query.idRole);
    if (idRole !== null) where.idRole = idRole;

    if (req.query.status !== undefined) {
      const s = parseBool(req.query.status, null);
      if (s !== null) where.status = s;
    }

    const { rows, count } = await User.findAndCountAll({
      where,
      attributes: { exclude: ["password"] },
      include: [
        { model: Role, attributes: ["idRole", "name", "isCashier"] },
        { model: Cashier, attributes: ["idCashier", "name"], required: false },
      ],
      order: [[orderBy, orderDir]],
      limit: pageSize,
      offset: page * pageSize,
    });

    req.log?.info("Users list", { page, pageSize, q, orderBy, orderDir, total: count });

    return res.json({
      data: rows.map(toPublicUser),
      pagination: {
        page,
        pageSize,
        total: count,
        totalPages: Math.ceil(count / pageSize),
        sortBy: orderBy,
        sortDir: orderDir,
      },
    });
  } catch (err) {
    req.log?.error("Users list error", { error: err.message });
    return next(mapSequelizeError(err));
  }
};

/** GET /users/:id (sin password) */
exports.findOne = async (req, res, next) => {
  try {
    const id = parseIntSafe(req.params.id);
    if (id === null) throw new ApiError("Id inválido", 400);

    const user = await User.findByPk(id, {
      attributes: { exclude: ["password"] },
      include: [
        { model: Role, attributes: ["idRole", "name", "isCashier"] },
        { model: Cashier, attributes: ["idCashier", "name"], required: false },
      ],
    });
    if (!user) throw new ApiError("Usuario no encontrado", 404);

    req.log?.info("Users get", { id });
    return res.json(toPublicUser(user));
  } catch (err) {
    req.log?.warn("Users get error", { id: req.params.id, error: err.message });
    return next(mapSequelizeError(err));
  }
};

/** POST /users */
exports.create = async (req, res, next) => {
  let t;
  try {
    let {
      fullName,
      username,
      email,
      idRole,
      status,
      idCashier,
      password,
    } = req.body;

    fullName = sanitizeStr(fullName, 100);
    username = sanitizeStr(username, 30);
    email = sanitizeStr(email, 100);
    idRole = parseIntSafe(idRole);
    idCashier = idCashier === null ? null : parseIntSafe(idCashier);

    if (!fullName || !username || !email || idRole === null) {
      throw new ApiError("fullName, username, email e idRole son requeridos.", 400);
    }
    if (!password || String(password).trim().length < 8) {
      throw new ApiError("password es requerido y debe tener al menos 8 caracteres.", 400);
    }

    t = await sequelize.transaction();

    // Check unicidad username/email
    const existsUser = await User.findOne({ where: { username }, transaction: t });
    if (existsUser) throw new ApiError("Usuario ya existe", 409);
    const existsMail = await User.findOne({ where: { email }, transaction: t });
    if (existsMail) throw new ApiError("Email ya está en uso", 409);

    // Rol cajero y política de ventanilla
    const cashierRole = await isCashierRole(idRole);
    if (cashierRole) {
      if (idCashier !== null && idCashier !== undefined && idCashier !== 0) {
        const cashier = await Cashier.findByPk(idCashier, { transaction: t });
        if (!cashier) throw new ApiError("Ventanilla (idCashier) no encontrada.", 404);
        if (cashier.status === false) throw new ApiError("Ventanilla inactiva", 400);
        const occupied = await User.findOne({
          where: { idCashier: cashier.idCashier },
          attributes: ["idUser", "fullName", "username"],
          transaction: t,
        });
        if (occupied) throw new ApiError("La ventanilla ya está asignada a otro usuario", 409);
      } else {
        idCashier = null;
      }
    } else {
      idCashier = null;
    }

    const rounds = parseInt(process.env.BCRYPT_ROUNDS || "10", 10);
    const hash = await bcrypt.hash(String(password).trim(), rounds);

    const created = await User.create(
      {
        fullName,
        username,
        email,
        idRole,
        status: parseBool(status, true),
        idCashier,
        password: hash,
      },
      { transaction: t }
    );

    await t.commit();
    req.log?.info("User created", { idUser: created.idUser, username });

    return res.status(201).json(toPublicUser(created));
  } catch (err) {
    if (t && !t.finished) await t.rollback();
    req.log?.error("User create error", { error: err.message });
    return next(mapSequelizeError(err));
  }
};

/** PUT /users/:id */
exports.update = async (req, res, next) => {
  let t;
  try {
    const id = parseIntSafe(req.params.id);
    if (id === null) throw new ApiError("Id inválido", 400);

    let { fullName, username, email, idRole, status, idCashier, password } = req.body;

    fullName = fullName !== undefined ? sanitizeStr(fullName, 100) : undefined;
    username = username !== undefined ? sanitizeStr(username, 30) : undefined;
    email = email !== undefined ? sanitizeStr(email, 100) : undefined;
    idRole = idRole !== undefined ? parseIntSafe(idRole) : undefined;
    idCashier = idCashier === null ? null : idCashier !== undefined ? parseIntSafe(idCashier) : undefined;

    t = await sequelize.transaction();

    const current = await User.findByPk(id, { transaction: t });
    if (!current) throw new ApiError("Usuario no encontrado", 404);

    // unicidad cuando cambian username/email
    if (username && username !== current.username) {
      const existsUser = await User.findOne({ where: { username }, transaction: t });
      if (existsUser) throw new ApiError("Usuario ya existe", 409);
    }
    if (email && email !== current.email) {
      const existsMail = await User.findOne({ where: { email }, transaction: t });
      if (existsMail) throw new ApiError("Email ya está en uso", 409);
    }

    // ¿Rol final es cajero?
    const finalRoleId = idRole !== undefined ? idRole : current.idRole;
    const cashierRole = await isCashierRole(finalRoleId);

    const prevIdCashier = current.idCashier === null ? null : Number(current.idCashier);
    let nextIdCashier =
      idCashier !== undefined ? idCashier : prevIdCashier;

    if (cashierRole) {
      if (idCashier === null || idCashier === 0) {
        nextIdCashier = null;
      } else if (idCashier !== undefined) {
        const cashier = await Cashier.findByPk(idCashier, { include: [{ model: Service }], transaction: t });
        if (!cashier) throw new ApiError("Ventanilla (idCashier) no encontrada.", 404);
        if (cashier.status === false) throw new ApiError("Ventanilla inactiva", 400);
        const occupied = await User.findOne({
          where: { idCashier: cashier.idCashier, idUser: { [Op.ne]: current.idUser } },
          attributes: ["idUser"],
          transaction: t,
        });
        if (occupied) throw new ApiError("La ventanilla ya está asignada a otro usuario", 409);
      }
      // si no se envía idCashier, conserva actual (puede ser null)
    } else {
      nextIdCashier = null;
    }

    const patch = {};
    if (fullName !== undefined) patch.fullName = fullName ?? current.fullName;
    if (username !== undefined) patch.username = username ?? current.username;
    if (email !== undefined) patch.email = email ?? current.email;
    if (idRole !== undefined) patch.idRole = idRole ?? current.idRole;
    if (status !== undefined) patch.status = parseBool(status, current.status);
    patch.idCashier = nextIdCashier;

    if (typeof password === "string" && password.trim().length > 0) {
      if (password.trim().length < 8) {
        throw new ApiError("La nueva contraseña debe tener al menos 8 caracteres.", 400);
      }
      const rounds = parseInt(process.env.BCRYPT_ROUNDS || "10", 10);
      patch.password = await bcrypt.hash(password.trim(), rounds);
    }

    const cashierChanged = prevIdCashier !== patch.idCashier;

    await current.update(patch, { transaction: t });

    // Notificación por socket si cambió ventanilla (no rompe flujo si falla)
    if (cashierChanged) {
      try {
        const socketModule = require("../server/socket");
        const loggedOutSessions = socketModule.forceLogoutUser(
          current.idUser,
          "Cambio de ventanilla asignada"
        );
        req.log?.info("Forced logout due to cashier change", {
          idUser: current.idUser,
          from: prevIdCashier,
          to: patch.idCashier,
          sessionsClosed: loggedOutSessions,
        });
      } catch (socketError) {
        req.log?.warn("Socket logout error", { error: String(socketError?.message || socketError) });
      }
    } else {
      req.log?.info("No cashier change for user", { idUser: current.idUser });
    }

    const updated = await User.findByPk(id, {
      attributes: { exclude: ["password"] },
      include: [
        { model: Role, attributes: ["idRole", "name", "isCashier"] },
        { model: Cashier, attributes: ["idCashier", "name"], required: false },
      ],
      transaction: t,
    });

    await t.commit();
    req.log?.info("User updated", { idUser: id });
    return res.json(toPublicUser(updated));
  } catch (err) {
    if (t && !t.finished) await t.rollback();
    req.log?.error("User update error", { idUser: req.params.id, error: err.message });
    return next(mapSequelizeError(err));
  }
};

/** PATCH /users/:id/assign-cashier */
exports.assignCashier = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const id = parseIntSafe(req.params.id);
    const idCashier = parseIntSafe(req.body?.idCashier);
    const idService = parseIntSafe(req.body?.idService);

    if (id === null || idCashier === null || idService === null) {
      throw new ApiError("idCashier e idService son requeridos", 400);
    }

    const user = await User.findByPk(id, { transaction: t });
    if (!user) throw new ApiError("Usuario no encontrado", 404);
    if (user.status === false) throw new ApiError("Usuario inactivo", 400);

    const cashier = await Cashier.findByPk(idCashier, {
      include: [{ model: Service, attributes: ["idService", "name", "prefix"] }],
      transaction: t,
    });
    if (!cashier) throw new ApiError("Ventanilla no encontrada", 404);
    if (cashier.status === false) throw new ApiError("Ventanilla inactiva", 400);
    if (Number(cashier.idService) !== Number(idService)) {
      throw new ApiError("La ventanilla no pertenece al servicio seleccionado", 400);
    }

    const occupied = await User.findOne({
      where: { idCashier: cashier.idCashier, idUser: { [Op.ne]: user.idUser } },
      transaction: t,
      attributes: ["idUser", "fullName", "username"],
    });
    if (occupied) {
      throw new ApiError(
        `La ventanilla ya está asignada a ${occupied.fullName || occupied.username}`,
        409
      );
    }

    await user.update({ idCashier: cashier.idCashier }, { transaction: t });

    await t.commit();
    req.log?.info("Cashier assigned to user", { idUser: user.idUser, idCashier: cashier.idCashier });

    return res.json({
      ok: true,
      user: {
        idUser: user.idUser,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        idRole: user.idRole,
        idCashier: user.idCashier,
        status: user.status,
      },
      cashier: { idCashier: cashier.idCashier, name: cashier.name },
      service: cashier.Service
        ? {
            idService: cashier.Service.idService,
            name: cashier.Service.name,
            prefix: cashier.Service.prefix,
          }
        : null,
    });
  } catch (err) {
    if (t && !t.finished) await t.rollback();
    req.log?.error("Assign cashier error", { idUser: req.params.id, error: err.message });
    return next(mapSequelizeError(err));
  }
};

/** DELETE /users/:id */
exports.remove = async (req, res, next) => {
  try {
    const id = parseIntSafe(req.params.id);
    if (id === null) throw new ApiError("Id inválido", 400);

    const deleted = await User.destroy({ where: { idUser: id } });
    if (!deleted) throw new ApiError("Usuario no encontrado", 404);

    req.log?.info("User removed", { idUser: id });
    return res.json({ deleted: true });
  } catch (err) {
    req.log?.error("User remove error", { idUser: req.params.id, error: err.message });
    return next(mapSequelizeError(err));
  }
};

/** GET /roles (para selects rápidos) */
exports.roles = async (_req, res, next) => {
  try {
    const roles = await Role.findAll({
      attributes: ["idRole", "name", "status", "isCashier"],
      order: [["name", "ASC"]],
    });
    return res.json(roles);
  } catch (err) {
    return next(mapSequelizeError(err));
  }
};
