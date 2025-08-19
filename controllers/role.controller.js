// controllers/roles.controller.js
const db = require("../models");
const { ApiError } = require("../middlewares/errorHandler");

const { Role, RoleModule, Module, User, sequelize } = db;

const parseBool = (v, dflt) => {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1") return true;
  if (v === 0 || v === "0") return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "sí" || s === "si") return true;
    if (s === "false" || s === "no") return false;
  }
  return dflt;
};
const parseId = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError("Id inválido", 400);
  return n;
};

module.exports = {
  // GET /api/roles
  list: async (_req, res, next) => {
    try {
      const roles = await Role.findAll({ order: [["idRole", "ASC"]] });
      return res.json(roles);
    } catch (err) {
      return next(err);
    }
  },

  // GET /api/roles/:id
  get: async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const role = await Role.findByPk(id);
      if (!role) throw new ApiError("Rol no encontrado", 404);
      return res.json(role);
    } catch (err) {
      return next(err);
    }
  },

  // POST /api/roles
  create: async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
      const name = String(req.body?.name ?? "").trim();
      const status = parseBool(req.body?.status, true);
      if (!name) throw new ApiError("El nombre del rol es obligatorio", 400);

      const exists = await Role.findOne({ where: { name }, transaction: t });
      if (exists) throw new ApiError("El rol ya existe", 409);

      const created = await Role.create({ name, status }, { transaction: t });
      await t.commit();
      return res.status(201).json(created);
    } catch (err) {
      if (t.finished !== "commit") await t.rollback();
      return next(err);
    }
  },

  // PUT /api/roles/:id
  update: async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
      const id = parseId(req.params.id);
      const role = await Role.findByPk(id, { transaction: t });
      if (!role) throw new ApiError("Rol no encontrado", 404);

      const name = req.body?.name;
      const status = req.body?.status;

      if (typeof name === "string") role.name = name.trim() || role.name;
      if (status !== undefined) role.status = parseBool(status, role.status);

      await role.save({ transaction: t });
      await t.commit();
      return res.json(role);
    } catch (err) {
      if (t.finished !== "commit") await t.rollback();
      return next(err);
    }
  },

  // DELETE /api/roles/:id
  remove: async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
      const id = parseId(req.params.id);

      const used = await User.count({ where: { idRole: id }, transaction: t });
      if (used > 0) throw new ApiError("Rol en uso por usuarios", 400);

      const deleted = await Role.destroy({ where: { idRole: id }, transaction: t });
      if (!deleted) throw new ApiError("Rol no encontrado", 404);

      await t.commit();
      return res.json({ ok: true, deleted: id });
    } catch (err) {
      if (t.finished !== "commit") await t.rollback();
      return next(err);
    }
  },

  // GET /api/roles/:id/modules
  getModules: async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const role = await Role.findByPk(id);
      if (!role) throw new ApiError("Rol no encontrado", 404);

      const modules = await Module.findAll({
        include: [
          {
            model: Role,
            through: { attributes: [] },
            where: { idRole: id },
            required: false,
          },
        ],
        order: [["idModule", "ASC"]],
      });

      const result = modules.map((m) => ({
        idModule: m.idModule,
        name: m.name,
        route: m.route,
        status: m.status,
        selected: Array.isArray(m.Roles) && m.Roles.length > 0,
      }));

      return res.json(result);
    } catch (err) {
      return next(err);
    }
  },

  // PUT /api/roles/:id/modules
  setModules: async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
      const id = parseId(req.params.id);

      // Tolerante: acepta body como array directo o { modules: [] }
      let arr = Array.isArray(req.body) ? req.body : req.body?.modules;
      if (!Array.isArray(arr)) throw new ApiError("El cuerpo debe incluir un array 'modules'", 400);

      // Limpia duplicados y normaliza a enteros válidos
      const ids = [...new Set(arr.map(Number))].filter((n) => Number.isInteger(n) && n > 0);

      const role = await Role.findByPk(id, { transaction: t });
      if (!role) throw new ApiError("Rol no encontrado", 404);

      await RoleModule.destroy({ where: { idRole: id }, transaction: t });

      if (ids.length) {
        const toCreate = ids.map((idModule) => ({ idRole: id, idModule }));
        await RoleModule.bulkCreate(toCreate, { transaction: t });
      }

      await t.commit();
      return res.json({ ok: true, assigned: ids });
    } catch (err) {
      if (t.finished !== "commit") await t.rollback();
      return next(err);
    }
  },
};
