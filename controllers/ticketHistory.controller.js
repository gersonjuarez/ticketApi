// controllers/ticketHistory.controller.js
const { Op, literal } = require('sequelize');
const db = require('../models');
const { TicketHistory, TicketRegistration, User } = db;

const isDev = process.env.NODE_ENV !== 'production';

// Mapa de columnas válidas para ordenar (usa tableName real)
const ORDER_MAP = {
  timestamp: 'tickethistories.timestamp',
  createdAt: 'tickethistories.createdAt',
  idTicket: 'tickethistories.idTicket',
  fromStatus: 'tickethistories.fromStatus',
  toStatus: 'tickethistories.toStatus',
  changedByUser: 'tickethistories.changedByUser',
};

/**
 * GET /api/ticket-history
 */
module.exports.list = async (req, res, next) => {
  try {
    // -------- Paginación
    const page = Number.parseInt(req.query.page, 10) > 0 ? Number.parseInt(req.query.page, 10) : 1;
    const pageSizeRaw = Number.parseInt(req.query.pageSize, 10);
    const pageSize = Number.isInteger(pageSizeRaw) ? Math.min(Math.max(pageSizeRaw, 1), 1000) : 10;
    const offset = (page - 1) * pageSize;

    // -------- Orden cualificado
    const sortByReq = String(req.query.sortBy || '').trim();
    const sortKey = ORDER_MAP[sortByReq] || ORDER_MAP.timestamp || ORDER_MAP.createdAt;
    const sortDir = String(req.query.sortDir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const order = [[literal(sortKey), sortDir]];

    // -------- Filtros
    const where = {};
    if (req.query.userId) where.changedByUser = Number(req.query.userId);
    if (req.query.idTicket) where.idTicket = Number(req.query.idTicket);

    const csvToIntArray = (v) =>
      String(v)
        .split(',')
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter(Number.isInteger);

    if (req.query.fromStatus) {
      const arr = csvToIntArray(req.query.fromStatus);
      if (arr.length) where.fromStatus = arr.length > 1 ? { [Op.in]: arr } : arr[0];
    }
    if (req.query.toStatus) {
      const arr = csvToIntArray(req.query.toStatus);
      if (arr.length) where.toStatus = arr.length > 1 ? { [Op.in]: arr } : arr[0];
    }

    // -------- Rango de fechas sobre 'timestamp'
    const parseDateSafe = (d) => {
      if (!d) return null;
      const dt = new Date(d);
      return isNaN(dt.getTime()) ? null : dt;
    };
    const from = parseDateSafe(req.query.dateFrom);
    const to = parseDateSafe(req.query.dateTo);
    if (from || to) {
      const range = {};
      if (from) range[Op.gte] = from;
      if (to) { to.setHours(23, 59, 59, 999); range[Op.lte] = to; }
      where.timestamp = range; // tu modelo sí tiene 'timestamp'
    }

    // -------- Include (sin alias personalizados)
    const include = [
      {
        model: TicketRegistration,
        attributes: ['idTicketRegistration', 'turnNumber', 'idService', 'prefix', 'correlativo'],
        required: false,
        where: {},
      },
      {
        model: User,
        attributes: ['id', 'name', 'email'],
        required: false,
      },
    ];

    if (req.query.serviceId) {
      include[0].where.idService = Number(req.query.serviceId);
      include[0].required = true;
    }
    if (req.query.q) {
      const q = String(req.query.q).trim();
      include[0].where = {
        ...(include[0].where || {}),
        [Op.or]: [
          { prefix: { [Op.like]: `%${q}%` } },
          { correlativo: { [Op.like]: `%${q}%` } },
          Number.isInteger(Number(q)) ? { turnNumber: Number(q) } : null,
        ].filter(Boolean),
      };
      include[0].required = true;
    }

    const { rows, count } = await TicketHistory.findAndCountAll({
      where,
      include,
      order,
      offset,
      limit: pageSize,
      distinct: true,
      subQuery: false,
      // logging: console.log, // descomenta si quieres ver el SQL en consola
    });

    res.json({
      data: rows,
      pagination: {
        page,
        pageSize,
        total: count,
        totalPages: Math.ceil(count / pageSize),
        sortBy: sortByReq || (ORDER_MAP.timestamp ? 'timestamp' : 'createdAt'),
        sortDir,
      },
      filters: { ...req.query },
    });
  } catch (err) {
    if (isDev) {
      console.error('[TicketHistory:list] error:', {
        name: err?.name,
        message: err?.message,
        sql: err?.sql || err?.parent?.sql,
        sqlMessage: err?.parent?.sqlMessage || err?.original?.sqlMessage,
        sqlState: err?.parent?.sqlState,
        stack: err?.stack,
      });
    }
    next(err);
  }
};
