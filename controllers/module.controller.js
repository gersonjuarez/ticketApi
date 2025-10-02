// controllers/module.controller.js
const db = require("../models");
const { ApiError } = require("../middlewares/errorHandler");
const { Op, ValidationError, UniqueConstraintError, ForeignKeyConstraintError, DatabaseError } = require("sequelize");

const { Module, sequelize } = db;

/* ===========================
   Helpers de parseo/validación
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
  if (Number.isInteger(n) && n >= 0) return n; // 0-based
  return 0;
};

const parsePageSize = (v) => {
  const n = Number(v);
  if (Number.isInteger(n) && n > 0) return Math.min(n, 100);
  return 10;
};

const parseSort = (sortBy, sortDir) => {
  const allowed = new Set(["idModule", "name", "route", "status", "createdAt", "updatedAt"]);
  const by = allowed.has(String(sortBy)) ? String(sortBy) : "idModule";
  const dir = String(sortDir || "ASC").toUpperCase() === "DESC" ? "DESC" : "ASC";
  return [by, dir];
};

const sanitizeStr = (v, max) => {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
};

const toPublicModule = (m) => ({
  idModule: m.idModule,
  name: m.name,
  route: m.route,
  description: m.description ?? null,
  status: Boolean(m.status),
  createdAt: m.createdAt,
  updatedAt: m.updatedAt,
});

/* ===========================
   Normalización de errores
   =========================== */
const mapSequelizeError = (err) => {
  // No tiramos el server: convertimos a ApiError con código y detalle útil
  if (err instanceof UniqueConstraintError) {
    return new ApiError("Registro duplicado (violación de unique)", 409, { fields: err.fields, errors: err.errors });
  }
  if (err instanceof ValidationError) {
    return new ApiError("Error de validación de datos", 400, { errors: err.errors?.map(e => ({ path: e.path, message: e.message })) });
  }
  if (err instanceof ForeignKeyConstraintError) {
    return new ApiError("Violación de integridad referencial (FK)", 409, { table: err.table, fields: err.fields });
  }
  if (err instanceof DatabaseError) {
    return new ApiError("Error de base de datos", 500, { message: err.message });
  }
  return err; // podría ser ApiError u otro error: lo delega al middleware
};

module.exports = {
  // GET /api/modules
  list: async (req, res, next) => {
    try {
      const page = parsePage(req.query.page);
      const pageSize = parsePageSize(req.query.pageSize);
      const q = (req.query.q || "").toString().trim();
      const [sortBy, sortDir] = parseSort(req.query.sortBy, req.query.sortDir);

      const where = {};
      if (q) {
        where[Op.or] = [
          { name:  { [Op.like]: `%${q}%` } },
          { route: { [Op.like]: `%${q}%` } },
        ];
      }
      if (req.query.status !== undefined) {
        const s = parseBool(req.query.status, null);
        if (s !== null) where.status = s;
      }

      const { rows, count } = await Module.findAndCountAll({
        where,
        limit: pageSize,
        offset: page * pageSize,
        order: [[sortBy, sortDir]],
      });

      const items = rows.map(toPublicModule);

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
    } catch (error) {
      return next(mapSequelizeError(error));
    }
  },

  // GET /api/modules/:id
  get: async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const mod = await Module.findByPk(id);
      if (!mod) throw new ApiError("Módulo no encontrado", 404);
      return res.json(toPublicModule(mod));
    } catch (error) {
      return next(mapSequelizeError(error));
    }
  },

  // POST /api/modules
  create: async (req, res, next) => {
    let t;
    try {
      const name = sanitizeStr(req.body?.name, 50);
      const route = sanitizeStr(req.body?.route, 100);
      const description = sanitizeStr(req.body?.description, 65535); // TEXT long
      const status = parseBool(req.body?.status, true);

      if (!name || !route) throw new ApiError("Nombre y ruta son obligatorios", 400);

      t = await sequelize.transaction();

      const created = await Module.create(
        { name, route, description, status },
        { transaction: t }
      );

      await t.commit();
      return res.status(201).json(toPublicModule(created));
    } catch (error) {
      if (t && !t.finished) await t.rollback();
      return next(mapSequelizeError(error));
    }
  },

  // PUT /api/modules/:id
  update: async (req, res, next) => {
    let t;
    try {
      const id = parseId(req.params.id);

      const name = req.body?.name !== undefined ? sanitizeStr(req.body?.name, 50) : undefined;
      const route = req.body?.route !== undefined ? sanitizeStr(req.body?.route, 100) : undefined;
      const description = req.body?.description !== undefined ? sanitizeStr(req.body?.description, 65535) : undefined;
      const hasStatus = req.body?.status !== undefined;

      if (name === "") throw new ApiError("Nombre no puede ser vacío", 400);
      if (route === "") throw new ApiError("Ruta no puede ser vacía", 400);

      t = await sequelize.transaction();

      const mod = await Module.findByPk(id, { transaction: t });
      if (!mod) throw new ApiError("Módulo no encontrado", 404);

      if (name !== undefined) mod.name = name ?? mod.name;
      if (route !== undefined) mod.route = route ?? mod.route;
      if (description !== undefined) mod.description = description; // puede ser null
      if (hasStatus) mod.status = parseBool(req.body.status, mod.status);

      await mod.save({ transaction: t });
      await t.commit();
      return res.json(toPublicModule(mod));
    } catch (error) {
      if (t && !t.finished) await t.rollback();
      return next(mapSequelizeError(error));
    }
  },

  // DELETE /api/modules/:id
  remove: async (req, res, next) => {
    let t;
    try {
      const id = parseId(req.params.id);
      t = await sequelize.transaction();

      const deleted = await Module.destroy({ where: { idModule: id }, transaction: t });
      if (!deleted) throw new ApiError("Módulo no encontrado", 404);

      await t.commit();
      return res.json({ ok: true, deleted: id });
    } catch (error) {
      if (t && !t.finished) await t.rollback();
      return next(mapSequelizeError(error));
    }
  },
};
