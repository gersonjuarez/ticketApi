// controllers/services.controller.js
const { Op } = require("sequelize");
const { Service, sequelize } = require("../models");
const { ApiError } = require("../middlewares/errorHandler");

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
const parsePage = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : 0; // 0-based
};
const parsePageSize = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 10;
};
const parseSort = (sortBy, sortDir) => {
  const allowed = new Set([
    "idService",
    "name",
    "prefix",
    "value",
    "status",
    "createdAt",
    "updatedAt",
  ]);
  const by = allowed.has(String(sortBy)) ? String(sortBy) : "idService";
  const dir = String(sortDir || "ASC").toUpperCase() === "DESC" ? "DESC" : "ASC";
  return [by, dir];
};

// GET /api/services (paginado)
exports.findAll = async (req, res, next) => {
  try {
    const page = parsePage(req.query.page);
    const pageSize = parsePageSize(req.query.pageSize);
    const q = (req.query.q || "").toString().trim();
    const [sortBy, sortDir] = parseSort(req.query.sortBy, req.query.sortDir);

    const where = {};
    if (q) {
      where[Op.or] = [
        { name: { [Op.like]: `%${q}%` } },
        { prefix: { [Op.like]: `%${q}%` } },
        { description: { [Op.like]: `%${q}%` } },
      ];
    }
    if (req.query.status !== undefined) {
      const s = parseBool(req.query.status, null);
      if (s !== null) where.status = s ? 1 : 0;
    }

    const { rows, count } = await Service.findAndCountAll({
      where,
      limit: pageSize,
      offset: page * pageSize,
      order: [[sortBy, sortDir]],
    });

    const payload = {
      items: rows,
      page,
      pageSize,
      totalItems: count,
      totalPages: Math.ceil(count / pageSize),
      hasNext: (page + 1) * pageSize < count,
      hasPrev: page > 0,
      sort: { by: sortBy, dir: sortDir },
      q,
    };

    // Log de acceso (info)
    (req.log || console).info?.({ route: "/api/services", ...payload.sort, q }, "services.findAll");

    return res.json(payload);
  } catch (error) {
    (req.log || console).error?.(
      { err: error, route: "/api/services" },
      "services.findAll error"
    );
    return next(error);
  }
};

// GET /api/services/:id
exports.findById = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const service = await Service.findByPk(id);
    if (!service) throw new ApiError("Servicio no encontrado", 404);
    return res.json(service);
  } catch (error) {
    (req.log || console).warn?.({ err: error, id: req.params?.id }, "services.findById warn");
    return next(error);
  }
};

// POST /api/services
exports.create = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { name, prefix, value, status, description } = req.body;

    if (!name || !String(name).trim()) {
      throw new ApiError("El nombre es obligatorio", 400);
    }

    const created = await Service.create(
      {
        name: String(name).trim(),
        prefix: prefix ? String(prefix).trim().toUpperCase() : null,
        value, // respeta el tipo definido en el modelo (DECIMAL/STRING)
        status: parseBool(status, true) ? 1 : 0,
        description: description ? String(description).trim() : null,
      },
      { transaction: t }
    );

    await t.commit();

    (req.log || console).info?.({ idService: created.idService }, "services.create OK");

    // Si usas Socket.IO global para avisar de nuevos servicios activos
    if (global.io && created.status === 1) {
      global.io.emit("new-service", created);
    }

    return res.status(201).json(created);
  } catch (error) {
    if (t.finished !== "commit") await t.rollback();
    (req.log || console).error?.({ err: error, body: req.body }, "services.create error");
    return next(error);
  }
};

// PUT /api/services/:id
exports.update = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const id = parseId(req.params.id);
    const current = await Service.findByPk(id, { transaction: t });
    if (!current) throw new ApiError("Servicio no encontrado", 404);

    const { name, prefix, value, status, description } = req.body;

    if (typeof name === "string" && name.trim()) current.name = name.trim();
    if (prefix !== undefined)
      current.prefix = prefix ? String(prefix).trim().toUpperCase() : null;
    if (value !== undefined) current.value = value;
    if (status !== undefined)
      current.status = parseBool(status, current.status === 1) ? 1 : 0;
    if (description !== undefined)
      current.description = description ? String(description).trim() : null;

    await current.save({ transaction: t });
    await t.commit();

    (req.log || console).info?.({ idService: id }, "services.update OK");
    return res.json(current);
  } catch (error) {
    if (t.finished !== "commit") await t.rollback();
    (req.log || console).error?.({ err: error, id: req.params?.id }, "services.update error");
    return next(error);
  }
};

// DELETE /api/services/:id
exports.delete = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const deleted = await Service.destroy({ where: { idService: id } });
    if (!deleted) throw new ApiError("Servicio no encontrado", 404);

    (req.log || console).info?.({ idService: id }, "services.delete OK");
    return res.json({ deleted: true });
  } catch (error) {
    (req.log || console).error?.({ err: error, id: req.params?.id }, "services.delete error");
    return next(error);
  }
};
