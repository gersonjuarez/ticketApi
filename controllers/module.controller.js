// controllers/modules.controller.js
const db = require("../models");
const { ApiError } = require("../middlewares/errorHandler");

const { Module, sequelize } = db;

// Helpers
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
  // GET /api/modules
  list: async (_req, res, next) => {
    try {
      const items = await Module.findAll({ order: [["idModule", "ASC"]] });
      return res.json(items);
    } catch (err) {
      return next(err);
    }
  },

  // GET /api/modules/:id
  get: async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const mod = await Module.findByPk(id);
      if (!mod) throw new ApiError("Módulo no encontrado", 404);
      return res.json(mod);
    } catch (err) {
      return next(err);
    }
  },

  // POST /api/modules
  create: async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
      const name = String(req.body?.name ?? "").trim();
      const route = String(req.body?.route ?? "").trim();
      const status = parseBool(req.body?.status, true);

      if (!name || !route) throw new ApiError("Nombre y ruta son obligatorios", 400);

      const created = await Module.create({ name, route, status }, { transaction: t });
      await t.commit();
      return res.status(201).json(created);
    } catch (err) {
      if (t.finished !== "commit") await t.rollback();
      return next(err);
    }
  },

  // PUT /api/modules/:id
  update: async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
      const id = parseId(req.params.id);
      const mod = await Module.findByPk(id, { transaction: t });
      if (!mod) throw new ApiError("Módulo no encontrado", 404);

      const name = req.body?.name;
      const route = req.body?.route;
      const status = req.body?.status;

      if (typeof name === "string") mod.name = name.trim() || mod.name;
      if (typeof route === "string") mod.route = route.trim() || mod.route;
      if (status !== undefined) mod.status = parseBool(status, mod.status);

      await mod.save({ transaction: t });
      await t.commit();
      return res.json(mod);
    } catch (err) {
      if (t.finished !== "commit") await t.rollback();
      return next(err);
    }
  },

  // DELETE /api/modules/:id
  remove: async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
      const id = parseId(req.params.id);
      const deleted = await Module.destroy({ where: { idModule: id }, transaction: t });
      if (!deleted) throw new ApiError("Módulo no encontrado", 404);
      await t.commit();
      return res.json({ ok: true, deleted: id });
    } catch (err) {
      if (t.finished !== "commit") await t.rollback();
      return next(err);
    }
  },
};
