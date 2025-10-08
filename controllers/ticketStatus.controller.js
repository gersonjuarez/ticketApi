// controllers/ticketStatus.controller.js
const { Op } = require("sequelize");
const { TicketStatus, sequelize } = require("../models");
const { ApiError } = require("../middlewares/errorHandler");

/* =========================
   Constantes de estados
========================= */
const STATUS = {
  PENDIENTE: 1,
  EN_ATENCION: 2,
  COMPLETADO: 3,
  CANCELADO: 4,
  TRASLADO: 5, // 👈 nuevo estado
};

/* =========================================================
   Helpers comunes de parseo y utilidades de este controlador
========================================================= */
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
  const allowed = new Set(["idTicketStatus", "name", "status", "createdAt", "updatedAt"]);
  const by = allowed.has(String(sortBy)) ? String(sortBy) : "idTicketStatus";
  const dir = String(sortDir || "ASC").toUpperCase() === "DESC" ? "DESC" : "ASC";
  return [by, dir];
};

/* =========================================================
   Helper para asegurar/obtener el estado "Traslado"
   - Útil para ser llamado desde otros controladores (transfer)
========================================================= */
async function findOrCreateTransferStatus(transaction = null) {
  let st = await TicketStatus.findByPk(STATUS.TRASLADO, { transaction });
  if (!st) {
    st = await TicketStatus.create(
      {
        idTicketStatus: STATUS.TRASLADO,
        name: "Traslado",
        status: 1,
      },
      { transaction }
    );
  } else if (st.status !== 1 || st.name.toLowerCase() !== "traslado") {
    st.status = 1;
    st.name = "Traslado";
    await st.save({ transaction });
  }
  return st;
}

/* =========================================================
   GET /api/ticket-status  (paginado)
========================================================= */
exports.findAll = async (req, res, next) => {
  const log = req.log || console;
  try {
    const page = parsePage(req.query.page);
    const pageSize = parsePageSize(req.query.pageSize);
    const q = (req.query.q || "").toString().trim();
    const [sortBy, sortDir] = parseSort(req.query.sortBy, req.query.sortDir);

    const where = {};
    if (q) where[Op.or] = [{ name: { [Op.like]: `%${q}%` } }];
    if (req.query.status !== undefined) {
      const s = parseBool(req.query.status, null);
      if (s !== null) where.status = s ? 1 : 0;
    }

    const { rows, count } = await TicketStatus.findAndCountAll({
      where,
      limit: pageSize,
      offset: page * pageSize,
      order: [[sortBy, sortDir]],
    });

    log.info(
      { route: "GET /api/ticket-status", page, pageSize, q, sortBy, sortDir, total: count },
      "TicketStatus list"
    );

    return res.json({
      items: rows,
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
    log.error({ err: error, route: "GET /api/ticket-status" }, "TicketStatus list error");
    return next(error instanceof ApiError ? error : new ApiError(error.message || "Error listando estados", 500));
  }
};

/* =========================================================
   GET /api/ticket-status/:id
========================================================= */
exports.findById = async (req, res, next) => {
  const log = req.log || console;
  try {
    const id = parseId(req.params.id);
    const status = await TicketStatus.findByPk(id);
    if (!status) throw new ApiError("Estado no encontrado", 404);
    log.info({ route: "GET /api/ticket-status/:id", id }, "TicketStatus get");
    res.json(status);
  } catch (error) {
    log.error({ err: error, route: "GET /api/ticket-status/:id" }, "TicketStatus get error");
    return next(error instanceof ApiError ? error : new ApiError(error.message || "Error obteniendo estado", 500));
  }
};

/* =========================================================
   POST /api/ticket-status
========================================================= */
exports.create = async (req, res, next) => {
  const log = req.log || console;
  const t = await sequelize.transaction();
  try {
    const name = String(req.body?.name ?? "").trim();
    const status = parseBool(req.body?.status, true) ? 1 : 0;

    if (!name) throw new ApiError("El nombre es requerido", 400);

    const created = await TicketStatus.create({ name, status }, { transaction: t });
    await t.commit();

    log.info({ route: "POST /api/ticket-status", id: created.idTicketStatus }, "TicketStatus created");
    res.status(201).json(created);
  } catch (error) {
    if (t.finished !== "commit") await t.rollback();
    log.error({ err: error, route: "POST /api/ticket-status" }, "TicketStatus create error");
    return next(error instanceof ApiError ? error : new ApiError(error.message || "Error creando estado", 400));
  }
};

/* =========================================================
   PUT /api/ticket-status/:id
   - Protegemos nombres base por defecto (opcional)
========================================================= */
exports.update = async (req, res, next) => {
  const log = req.log || console;
  const t = await sequelize.transaction();
  try {
    const id = parseId(req.params.id);
    const current = await TicketStatus.findByPk(id, { transaction: t });
    if (!current) throw new ApiError("Estado no encontrado", 404);

    const name = typeof req.body?.name === "string" ? req.body.name.trim() : undefined;
    const status =
      req.body?.status !== undefined ? (parseBool(req.body.status, current.status === 1) ? 1 : 0) : undefined;

    // Opcional: evita renombrar estados base
    const protectedIds = new Set([
      STATUS.PENDIENTE,
      STATUS.EN_ATENCION,
      STATUS.COMPLETADO,
      STATUS.CANCELADO,
      STATUS.TRASLADO,
    ]);
    if (protectedIds.has(id) && name !== undefined && !name.toLowerCase().includes(current.name.toLowerCase())) {
      // Permitimos actualizar estado (activo/inactivo), pero no renombrar radicalmente los core.
      throw new ApiError("Este estado base no puede ser renombrado", 400);
    }

    if (name !== undefined) {
      if (!name) throw new ApiError("El nombre no puede estar vacío", 400);
      current.name = name;
    }
    if (status !== undefined) current.status = status;

    await current.save({ transaction: t });
    await t.commit();

    log.info({ route: "PUT /api/ticket-status/:id", id }, "TicketStatus updated");
    res.json(current);
  } catch (error) {
    if (t.finished !== "commit") await t.rollback();
    log.error({ err: error, route: "PUT /api/ticket-status/:id" }, "TicketStatus update error");
    return next(error instanceof ApiError ? error : new ApiError(error.message || "Error actualizando estado", 400));
  }
};

/* =========================================================
   DELETE /api/ticket-status/:id
   - Evita borrar los estados base
========================================================= */
exports.delete = async (req, res, next) => {
  const log = req.log || console;
  try {
    const id = parseId(req.params.id);

    const protectedIds = new Set([
      STATUS.PENDIENTE,
      STATUS.EN_ATENCION,
      STATUS.COMPLETADO,
      STATUS.CANCELADO,
      STATUS.TRASLADO,
    ]);
    if (protectedIds.has(id)) {
      throw new ApiError("No se puede eliminar un estado base del sistema", 400);
    }

    const deleted = await TicketStatus.destroy({ where: { idTicketStatus: id } });
    if (!deleted) throw new ApiError("Estado no encontrado", 404);
    log.info({ route: "DELETE /api/ticket-status/:id", id }, "TicketStatus deleted");
    res.json({ ok: true, deleted: id });
  } catch (error) {
    log.error({ err: error, route: "DELETE /api/ticket-status/:id" }, "TicketStatus delete error");
    return next(error instanceof ApiError ? error : new ApiError(error.message || "Error eliminando estado", 500));
  }
};

/* =========================================================
   POST /api/ticket-status/ensure-defaults
   - Si faltan, crea los estados base incluyendo TRASLADO
========================================================= */
exports.ensureDefaults = async (req, res, next) => {
  const log = req.log || console;
  const t = await sequelize.transaction();
  try {
    const wanted = [
      { idTicketStatus: STATUS.PENDIENTE, name: "Pendiente" },
      { idTicketStatus: STATUS.EN_ATENCION, name: "En Atencion" },
      { idTicketStatus: STATUS.COMPLETADO, name: "Completado" },
      { idTicketStatus: STATUS.CANCELADO, name: "Cancelado" },
      { idTicketStatus: STATUS.TRASLADO, name: "Traslado" },
    ];

    const createdOrUpdated = [];
    for (const w of wanted) {
      const found = await TicketStatus.findByPk(w.idTicketStatus, { transaction: t });
      if (!found) {
        const c = await TicketStatus.create(
          { idTicketStatus: w.idTicketStatus, name: w.name, status: 1 },
          { transaction: t }
        );
        createdOrUpdated.push({ id: c.idTicketStatus, name: c.name, op: "created" });
      } else {
        // normaliza nombre y activa
        const needsSave =
          (found.name !== w.name) ||
          (found.status !== 1);
        if (needsSave) {
          found.name = w.name;
          found.status = 1;
          await found.save({ transaction: t });
          createdOrUpdated.push({ id: found.idTicketStatus, name: found.name, op: "updated" });
        }
      }
    }

    await t.commit();
    log.info({ route: "POST /api/ticket-status/ensure-defaults", changed: createdOrUpdated }, "Defaults ensured");
    res.json({ ok: true, changed: createdOrUpdated, STATUS });
  } catch (error) {
    if (t.finished !== "commit") await t.rollback();
    log.error({ err: error, route: "POST /api/ticket-status/ensure-defaults" }, "Ensure defaults error");
    return next(error instanceof ApiError ? error : new ApiError(error.message || "Error asegurando defaults", 500));
  }
};

/* =========================================================
   Exports auxiliares para usar en otros módulos
   - STATUS: mapa de IDs
   - findOrCreateTransferStatus: para garantizar existencia de TRASLADO
========================================================= */
exports.STATUS = STATUS;
exports.findOrCreateTransferStatus = findOrCreateTransferStatus;
