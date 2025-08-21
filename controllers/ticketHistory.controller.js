// controllers/ticketHistory.controller.js
const { Op, literal } = require('sequelize');
const db = require('../models');
const { TicketHistory, TicketRegistration, User, Service } = db;

const isDev = process.env.NODE_ENV !== 'production';

// columnas válidas para ordenar (cualificadas con el tableName real)
const ORDER_MAP = {
  createdAt: 'tickethistories.createdAt',
  idTicket: 'tickethistories.idTicket',
  fromStatus: 'tickethistories.fromStatus',
  toStatus: 'tickethistories.toStatus',
  changedByUser: 'tickethistories.changedByUser',
};

module.exports.list = async (req, res, next) => {
  try {
    // -------- Paginación
    const page = Number.parseInt(req.query.page, 10) > 0 ? Number.parseInt(req.query.page, 10) : 1;
    const pageSizeRaw = Number.parseInt(req.query.pageSize, 10);
    const pageSize = Number.isInteger(pageSizeRaw) ? Math.min(Math.max(pageSizeRaw, 1), 1000) : 10;
    const offset = (page - 1) * pageSize;

    // -------- Orden (default createdAt DESC)
    const sortByReq = String(req.query.sortBy || 'createdAt').trim();
    const sortKey = ORDER_MAP[sortByReq] || ORDER_MAP.createdAt;
    const sortDir = String(req.query.sortDir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const order = [[literal(sortKey), sortDir]];

    // -------- Filtros raíz
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

    // -------- Rango de fechas sobre createdAt (NO timestamp)
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
      where.createdAt = range;
    }

    // -------- Include
    // Nota: 'prefix' se obtiene desde Service, no desde TicketRegistration
    const include = [
      {
        model: TicketRegistration,
        attributes: ['idTicketRegistration', 'turnNumber', 'idService', 'correlativo'], // <-- sin 'prefix'
        required: false,
        where: {},
        include: [
          {
            model: Service,
            attributes: ['prefix'], // <-- aquí está 'prefix'
            required: false,
          },
        ],
      },
      {
        model: User,
        attributes: ['id', 'name', 'email'],
        required: false,
      },
    ];

    if (req.query.serviceId) {
      include[0].where.idService = Number(req.query.serviceId);
      include[0].required = true; // INNER JOIN si filtras por servicio
    }

    if (req.query.q) {
      const q = String(req.query.q).trim();
      include[0].where = {
        ...(include[0].where || {}),
        [Op.or]: [
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
      // logging: console.log,
    });

    res.json({
      data: rows,
      pagination: {
        page,
        pageSize,
        total: count,
        totalPages: Math.ceil(count / pageSize),
        sortBy: 'createdAt',
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
