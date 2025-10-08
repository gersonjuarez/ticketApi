// controllers/ticketHistory.controller.js
const { Op, col, where: whereFn, fn } = require("sequelize");
const db = require("../models");
const { ApiError } = require("../middlewares/errorHandler");

const { TicketHistory, TicketRegistration, User, Service } = db;

/* ===========================
   Estados (diccionario)
   =========================== */
const STATUS_NAMES = {
  1: "Pendiente",
  2: "En Atención",
  3: "Completado",
  4: "Cancelado",
  5: "Traslado", // 👈 nuevo estado soportado
};

/* ===========================
   Helpers
   =========================== */
const parseIntSafe = (v, dflt = null) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : dflt;
};

const parsePage = (v) => {
  const n = Number(v);
  // 0-based
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

const parsePageSize = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 200) : 10;
};

const ORDER_MAP = {
  timestamp: col("TicketHistory.timestamp"),
  idTicket: col("TicketHistory.idTicket"),
  fromStatus: col("TicketHistory.fromStatus"),
  toStatus: col("TicketHistory.toStatus"),
  changedByUser: col("TicketHistory.changedByUser"),
};

const csvToIntArray = (v) =>
  String(v)
    .split(",")
    .map((s) => {
      const n = Number(s.trim());
      return Number.isInteger(n) ? n : NaN;
    })
    .filter((n) => Number.isInteger(n));

/* ===========================
   Controller
   =========================== */
module.exports.list = async (req, res, next) => {
  try {
    // ------- Paginación (0-based) -------
    const page = parsePage(req.query.page);
    const pageSize = parsePageSize(req.query.pageSize);
    const offset = page * pageSize;

    // ------- Orden -------
    const sortByReq = String(req.query.sortBy || "timestamp").trim();
    const sortCol = ORDER_MAP[sortByReq] || ORDER_MAP.timestamp;
    const sortDir = String(req.query.sortDir || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
    const order = [[sortCol, sortDir]];

    // ------- Filtros raíz -------
    const where = {};
    const userId = parseIntSafe(req.query.userId);
    const idTicket = parseIntSafe(req.query.idTicket);
    if (userId !== null) where.changedByUser = userId;
    if (idTicket !== null) where.idTicket = idTicket;

    // Soporta múltiples valores (incluye ahora el 5 = Traslado)
    if (req.query.fromStatus) {
      const arr = csvToIntArray(req.query.fromStatus);
      if (arr.length) where.fromStatus = arr.length > 1 ? { [Op.in]: arr } : arr[0];
    }
    if (req.query.toStatus) {
      const arr = csvToIntArray(req.query.toStatus);
      if (arr.length) where.toStatus = arr.length > 1 ? { [Op.in]: arr } : arr[0];
    }

    // ------- Rango de fechas (YYYY-MM-DD) -------
    const { dateFrom, dateTo } = req.query;
    if (dateFrom || dateTo) {
      const start = (dateFrom || "1970-01-01").trim();
      const end = (dateTo || "2999-12-31").trim();
      const reDate = /^\d{4}-\d{2}-\d{2}$/;
      if ((dateFrom && !reDate.test(start)) || (dateTo && !reDate.test(end))) {
        throw new ApiError("Formato de fecha inválido (use YYYY-MM-DD)", 400);
      }
      const dateOnly = fn("DATE", col("TicketHistory.timestamp"));
      const dateFilter = whereFn(dateOnly, { [Op.between]: [start, end] });
      if (!where[Op.and]) where[Op.and] = [];
      where[Op.and].push(dateFilter);
    }

    // ------- Include (TicketRegistration + Service, User) -------
    const include = [
      {
        model: TicketRegistration,
        attributes: ["idTicketRegistration", "turnNumber", "idService", "correlativo"],
        required: false,
        where: {},
        include: [
          {
            model: Service,
            attributes: ["idService", "prefix"],
            required: false,
          },
        ],
      },
      {
        model: User,
        attributes: ["idUser", "username", "fullName", "email"],
        required: false,
      },
    ];

    // Filtro por servicio
    const serviceId = parseIntSafe(req.query.serviceId);
    if (serviceId !== null) {
      include[0].where.idService = serviceId;
      include[0].required = true;
    }

    // Búsqueda (correlativo / turnNumber)
    if (req.query.q) {
      const q = String(req.query.q).trim();
      const maybeTurn = parseIntSafe(q);
      include[0].where = {
        ...(include[0].where || {}),
        [Op.or]: [
          { correlativo: { [Op.like]: `%${q}%` } },
          Number.isInteger(maybeTurn) ? { turnNumber: maybeTurn } : null,
        ].filter(Boolean),
      };
      include[0].required = true;
    }

    // ------- Query principal -------
    const { rows, count } = await TicketHistory.findAndCountAll({
      where,
      include,
      order,
      offset,
      limit: pageSize,
      distinct: true, // por includes
      subQuery: false,
    });

    // ------- Log -------
    req.log?.info("TicketHistory list", {
      page,
      pageSize,
      sortBy: sortByReq,
      sortDir,
      total: count,
      filters: {
        userId: userId ?? undefined,
        idTicket: idTicket ?? undefined,
        fromStatus: req.query.fromStatus,
        toStatus: req.query.toStatus,
        dateFrom,
        dateTo,
        serviceId: serviceId ?? undefined,
        q: req.query.q,
      },
    });

    // ------- Respuesta (interface FE) -------
    // Nota: devolvemos los rows tal cual y además un diccionario de nombres de estado,
    // incluyendo "Traslado" (5). Así no rompemos el contrato existente.
    return res.json({
      data: rows,
      pagination: {
        page,
        pageSize,
        total: count,
        totalPages: Math.ceil(count / pageSize),
        sortBy: sortByReq,
        sortDir,
      },
      filters: {
        userId: userId ?? null,
        idTicket: idTicket ?? null,
        fromStatus: req.query.fromStatus || null,
        toStatus: req.query.toStatus || null,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        serviceId: serviceId ?? null,
        q: req.query.q || null,
      },
      // 👇 útil para pintar etiquetas en UI sin hardcode
      statusNames: STATUS_NAMES,
    });
  } catch (err) {
    req.log?.error("TicketHistory list error", {
      message: err.message,
      name: err.name,
      sql: err?.sql || err?.parent?.sql,
      sqlMessage: err?.parent?.sqlMessage || err?.original?.sqlMessage,
      sqlState: err?.parent?.sqlState,
    });
    return next(err);
  }
};
