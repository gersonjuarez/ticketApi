// controllers/ticketHistory.controller.js
const { Op, col, where: whereFn, fn } = require('sequelize');
const db = require('../models');
const { TicketHistory, TicketRegistration, User, Service } = db;

const isDev = process.env.NODE_ENV !== 'production';

const ORDER_MAP = {
  timestamp: col('TicketHistory.timestamp'),
  idTicket: col('TicketHistory.idTicket'),
  fromStatus: col('TicketHistory.fromStatus'),
  toStatus: col('TicketHistory.toStatus'),
  changedByUser: col('TicketHistory.changedByUser'),
};

module.exports.list = async (req, res, next) => {
  try {
    // Paginación
    const page = Number.parseInt(req.query.page, 10) > 0 ? Number.parseInt(req.query.page, 10) : 1;
    const pageSizeRaw = Number.parseInt(req.query.pageSize, 10);
    const pageSize = Number.isInteger(pageSizeRaw) ? Math.min(Math.max(pageSizeRaw, 1), 1000) : 10;
    const offset = (page - 1) * pageSize;

    // Orden (por defecto timestamp DESC) usando alias del modelo
    const sortByReq = String(req.query.sortBy || 'timestamp').trim();
    const sortCol = ORDER_MAP[sortByReq] || ORDER_MAP.timestamp;
    const sortDir = String(req.query.sortDir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const order = [[sortCol, sortDir]];

    // Filtros raíz
    const where = {};
    if (req.query.userId) where.changedByUser = Number(req.query.userId);
    if (req.query.idTicket) where.idTicket = Number(req.query.idTicket);

    const csvToIntArray = (v) =>
      String(v).split(',').map(s => Number.parseInt(s.trim(), 10)).filter(Number.isInteger);

    if (req.query.fromStatus) {
      const arr = csvToIntArray(req.query.fromStatus);
      if (arr.length) where.fromStatus = arr.length > 1 ? { [Op.in]: arr } : arr[0];
    }
    if (req.query.toStatus) {
      const arr = csvToIntArray(req.query.toStatus);
      if (arr.length) where.toStatus = arr.length > 1 ? { [Op.in]: arr } : arr[0];
    }

    // ✅ Rango de fechas por DIA calendario (evita TZ)
    const { dateFrom, dateTo } = req.query;
    if (dateFrom || dateTo) {
      const start = (dateFrom || '1970-01-01').trim();
      const end   = (dateTo   || '2999-12-31').trim();

      const dateOnly = fn('DATE', col('TicketHistory.timestamp'));
      const dateFilter = whereFn(dateOnly, { [Op.between]: [start, end] });

      if (!where[Op.and]) where[Op.and] = [];
      where[Op.and].push(dateFilter);
    }

    // Include (User = idUser/fullName; prefix viene de Service)
    const include = [
      {
        model: TicketRegistration,
        attributes: ['idTicketRegistration', 'turnNumber', 'idService', 'correlativo'],
        required: false,
        where: {},
        include: [
          {
            model: Service,
            attributes: ['idService', 'prefix'],
            required: false,
          },
        ],
      },
      {
        model: User,
        attributes: ['idUser', 'username', 'fullName', 'email'],
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
        page, pageSize, total: count, totalPages: Math.ceil(count / pageSize),
        sortBy: sortByReq, sortDir,
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
