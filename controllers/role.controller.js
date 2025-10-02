// controllers/role.controller.js
const db = require("../models");
const { ApiError } = require("../middlewares/errorHandler");
const {
  Op,
  ValidationError,
  UniqueConstraintError,
  ForeignKeyConstraintError,
  DatabaseError,
} = require("sequelize");

const { Role, RoleModule, Module, User, sequelize } = db;

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

const parseId = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError("Id inválido", 400);
  return n;
};

const parsePage = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : 0; // 0-based
};

const parsePageSize = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 10;
};

const parseSort = (by, dir) => {
  const allowed = new Set(["idRole", "name", "status", "isCashier", "createdAt", "updatedAt"]);
  const sortBy = allowed.has(String(by)) ? String(by) : "idRole";
  const sortDir = String(dir || "ASC").toUpperCase() === "DESC" ? "DESC" : "ASC";
  return [sortBy, sortDir];
};

const sanitizeStr = (v, max) => {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
};

const toPublicRole = (r) => ({
  idRole: r.idRole,
  name: r.name,
  status: Boolean(r.status),
  isCashier: Boolean(r.isCashier),
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/* ===========================
   Mapeo de errores Sequelize
   =========================== */
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

module.exports = {
  // GET /api/roles?page=0&pageSize=10&q=adm&sortBy=name&sortDir=ASC&isCashier=true
  list: async (req, res, next) => {
    try {
      const page = parsePage(req.query.page);
      const pageSize = parsePageSize(req.query.pageSize);
      const q = (req.query.q || "").toString().trim();
      const [sortBy, sortDir] = parseSort(req.query.sortBy, req.query.sortDir);

      const where = {};
      if (q) where.name = { [Op.like]: `%${q}%` }; // búsqueda por nombre
      if (req.query.status !== undefined) {
        const s = parseBool(req.query.status, null);
        if (s !== null) where.status = s;
      }
      if (req.query.isCashier !== undefined) {
        const ic = parseBool(req.query.isCashier, null);
        if (ic !== null) where.isCashier = ic;
      }

      const { rows, count } = await Role.findAndCountAll({
        attributes: ["idRole", "name", "status", "isCashier", "createdAt", "updatedAt"],
        where,
        limit: pageSize,
        offset: page * pageSize,
        order: [[sortBy, sortDir]],
      });

      const items = rows.map(toPublicRole);

      req.log?.info("Roles list", { page, pageSize, q, sortBy, sortDir, count });
      return res.json({
        items,
        page,
        pageSize,
        totalItems: count,
        totalPages: Math.ceil(count / pageSize),
        hasNext: (page + 1) * pageSize < count,
        hasPrev: page > 0,
        sort: { by: sortBy, dir: sortDir },
        q,
      });
    } catch (err) {
      req.log?.error("Roles list error", { error: err.message });
      return next(mapSequelizeError(err));
    }
  },

  // GET /api/roles/:id
  get: async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const role = await Role.findByPk(id, {
        attributes: ["idRole", "name", "status", "isCashier", "createdAt", "updatedAt"],
      });
      if (!role) throw new ApiError("Rol no encontrado", 404);
      return res.json(toPublicRole(role));
    } catch (err) {
      req.log?.warn("Roles get error", { id: req.params.id, error: err.message });
      return next(mapSequelizeError(err));
    }
  },

  // POST /api/roles
  create: async (req, res, next) => {
    let t;
    try {
      const name = sanitizeStr(req.body?.name, 20);
      const status = parseBool(req.body?.status, true);
      const isCashier = parseBool(req.body?.isCashier, false);

      if (!name) throw new ApiError("El nombre del rol es obligatorio", 400);

      t = await sequelize.transaction();

      // si tienes unique index en DB esto no es indispensable, pero deja un mensaje más claro
      const exists = await Role.findOne({ where: { name }, transaction: t });
      if (exists) throw new ApiError("El rol ya existe", 409);

      const created = await Role.create({ name, status, isCashier }, { transaction: t });
      await t.commit();

      req.log?.info("Role created", { idRole: created.idRole, name });
      return res.status(201).json(toPublicRole(created));
    } catch (err) {
      if (t && !t.finished) await t.rollback();
      req.log?.error("Role create error", { error: err.message });
      return next(mapSequelizeError(err));
    }
  },

  // PUT /api/roles/:id
  update: async (req, res, next) => {
    let t;
    try {
      const id = parseId(req.params.id);

      const rawName = req.body?.name;
      const hasStatus = req.body?.status !== undefined;
      const hasIsCashier = req.body?.isCashier !== undefined;

      const name = rawName !== undefined ? sanitizeStr(rawName, 20) : undefined;
      if (name === "") throw new ApiError("El nombre no puede ser vacío", 400);

      t = await sequelize.transaction();

      const role = await Role.findByPk(id, {
        attributes: ["idRole", "name", "status", "isCashier"],
        transaction: t,
      });
      if (!role) throw new ApiError("Rol no encontrado", 404);

      if (name !== undefined) role.name = name ?? role.name;
      if (hasStatus) role.status = parseBool(req.body.status, role.status);
      if (hasIsCashier) role.isCashier = parseBool(req.body.isCashier, role.isCashier);

      await role.save({ transaction: t });
      await t.commit();

      req.log?.info("Role updated", { idRole: role.idRole });
      return res.json(toPublicRole(role));
    } catch (err) {
      if (t && !t.finished) await t.rollback();
      req.log?.error("Role update error", { idRole: req.params.id, error: err.message });
      return next(mapSequelizeError(err));
    }
  },

  // DELETE /api/roles/:id
  remove: async (req, res, next) => {
    let t;
    try {
      const id = parseId(req.params.id);

      t = await sequelize.transaction();
      const used = await User.count({ where: { idRole: id }, transaction: t });
      if (used > 0) throw new ApiError("Rol en uso por usuarios", 400);

      const deleted = await Role.destroy({ where: { idRole: id }, transaction: t });
      if (!deleted) throw new ApiError("Rol no encontrado", 404);

      await t.commit();
      req.log?.info("Role removed", { idRole: id });
      return res.json({ ok: true, deleted: id });
    } catch (err) {
      if (t && !t.finished) await t.rollback();
      req.log?.warn("Role remove error", { idRole: req.params.id, error: err.message });
      return next(mapSequelizeError(err));
    }
  },

  // GET /api/roles/:id/modules
  getModules: async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const role = await Role.findByPk(id);
      if (!role) throw new ApiError("Rol no encontrado", 404);

      const modules = await Module.findAll({
        attributes: ["idModule", "name", "route", "status"],
        order: [["idModule", "ASC"]],
      });

      const assigned = await RoleModule.findAll({
        where: { idRole: id },
        attributes: ["idModule"],
      });
      const assignedSet = new Set(assigned.map((a) => a.idModule));

      const result = modules.map((m) => ({
        idModule: m.idModule,
        name: m.name,
        route: m.route,
        status: !!m.status,
        selected: assignedSet.has(m.idModule),
      }));

      req.log?.info("Role modules fetched", { idRole: id, count: result.length });
      return res.json(result);
    } catch (err) {
      req.log?.error("Role getModules error", { idRole: req.params.id, error: err.message });
      return next(mapSequelizeError(err));
    }
  },

  // PUT /api/roles/:id/modules
  setModules: async (req, res, next) => {
    let t;
    try {
      const id = parseId(req.params.id);

      let arr = Array.isArray(req.body) ? req.body : req.body?.modules;
      if (!Array.isArray(arr))
        throw new ApiError("El cuerpo debe incluir un array 'modules'", 400);

      const ids = [...new Set(arr.map(Number))].filter(
        (n) => Number.isInteger(n) && n > 0
      );

      t = await sequelize.transaction();

      const role = await Role.findByPk(id, { transaction: t });
      if (!role) throw new ApiError("Rol no encontrado", 404);

      // (opcional) validar que existan los módulos
      if (ids.length) {
        const countModules = await Module.count({ where: { idModule: ids }, transaction: t });
        if (countModules !== ids.length) {
          throw new ApiError("Lista de módulos contiene ids inválidos", 400);
        }
      }

      await RoleModule.destroy({ where: { idRole: id }, transaction: t });

      if (ids.length) {
        const toCreate = ids.map((idModule) => ({ idRole: id, idModule }));
        await RoleModule.bulkCreate(toCreate, { transaction: t });
      }

      await t.commit();
      req.log?.info("Role modules updated", { idRole: id, assignedCount: ids.length });
      return res.json({ ok: true, assigned: ids });
    } catch (err) {
      if (t && !t.finished) await t.rollback();
      req.log?.error("Role setModules error", { idRole: req.params.id, error: err.message });
      return next(mapSequelizeError(err));
    }
  },
};
