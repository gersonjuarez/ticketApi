// controllers/ticketHistory.controller.js
const { Op } = require('sequelize');
const db = require('../models');
const { TicketHistory, TicketRegistration, User } = db;

/**
 * GET /api/ticket-history
 * Query:
 *  - page, pageSize (default 1, 10)
 *  - sortBy (timestamp|idTicket|fromStatus|toStatus|changedByUser) default 'timestamp'
 *  - sortDir ('ASC'|'DESC', default 'DESC')
 *  - userId (changedByUser)
 *  - fromStatus (número o CSV: 1,2,3,4)
 *  - toStatus   (número o CSV)
 *  - dateFrom (ISO o yyyy-mm-dd)
 *  - dateTo   (ISO o yyyy-mm-dd)  // inclusivo fin de día
 *  - idTicket (filtra por ticket específico)
 *  - serviceId (filtra por servicio del ticket)
 *  - q (búsqueda por prefix/correlativo/turnNumber)
 */
module.exports.list = async (req, res, next) => {
  try {
    // ---- Paginación segura
    const page = Number.parseInt(req.query.page, 10) > 0 ? Number.parseInt(req.query.page, 10) : 1;
    const pageSizeRaw = Number.parseInt(req.query.pageSize, 10);
    const pageSize = Number.isInteger(pageSizeRaw) ? Math.min(Math.max(pageSizeRaw, 1), 100) : 10;
    const offset = (page - 1) * pageSize;

    // ---- Ordenamiento con whitelist
    const SORT_WHITELIST = new Set(['timestamp', 'idTicket', 'fromStatus', 'toStatus', 'changedByUser']);
    const sortBy = SORT_WHITELIST.has(req.query.sortBy) ? req.query.sortBy : 'timestamp';
    const sortDir = String(req.query.sortDir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const order = [[sortBy, sortDir]];

    // ---- Filtros
    const where = {};

    // userId / idTicket
    if (req.query.userId) where.changedByUser = Number(req.query.userId);
    if (req.query.idTicket) where.idTicket = Number(req.query.idTicket);

    // fromStatus / toStatus: aceptan CSV
    const csvToIntArray = (v) =>
      String(v)
        .split(',')
        .map(s => Number.parseInt(s.trim(), 10))
        .filter(n => Number.isInteger(n));

    if (req.query.fromStatus) {
      const arr = csvToIntArray(req.query.fromStatus);
      if (arr.length > 0) where.fromStatus = arr.length > 1 ? { [Op.in]: arr } : arr[0];
    }
    if (req.query.toStatus) {
      const arr = csvToIntArray(req.query.toStatus);
      if (arr.length > 0) where.toStatus = arr.length > 1 ? { [Op.in]: arr } : arr[0];
    }

    // dateFrom / dateTo sobre 'timestamp'
    const parseDateSafe = (d) => {
      const dt = new Date(d);
      return isNaN(dt.getTime()) ? null : dt;
    };
    const { dateFrom, dateTo } = req.query;
    if (dateFrom || dateTo) {
      const range = {};
      const from = parseDateSafe(dateFrom);
      const to = parseDateSafe(dateTo);
      if (from) range[Op.gte] = from;
      if (to) {
        // Incluir fin de día local
        to.setHours(23, 59, 59, 999);
        range[Op.lte] = to;
      }
      if (Object.keys(range).length) where.timestamp = range;
    }

    // Filtros a nivel del TicketRegistration (serviceId y/o búsqueda simple)
    const include = [
      {
        model: TicketRegistration,
        attributes: ['idTicketRegistration', 'turnNumber', 'idService', 'prefix', 'correlativo'],
        // No hace falta foreignKey aquí si la asociación está definida en los modelos
        where: {},
        required: false, // que no excluya si no hay registro (ajústalo a tu necesidad)
      },
      {
        model: User,
        attributes: ['id', 'name', 'email'],
        required: false,
      },
    ];

    if (req.query.serviceId) {
      include[0].where.idService = Number(req.query.serviceId);
    }

    if (req.query.q) {
      const q = String(req.query.q).trim();
      // Búsqueda simple por prefix/correlativo/turnNumber
      include[0].where[Op.or] = [
        { prefix: { [Op.like]: `%${q}%` } },
        { correlativo: { [Op.like]: `%${q}%` } },
        // si turnNumber es numérico:
        Number.isInteger(Number(q)) ? { turnNumber: Number(q) } : null,
      ].filter(Boolean);
    }

    const { rows, count } = await TicketHistory.findAndCountAll({
      where,
      include,
      order,
      offset,
      limit: pageSize,
      distinct: true, // importante para que count sea correcto con LEFT JOINs
    });

    res.json({
      data: rows,
      pagination: {
        page,
        pageSize,
        total: count,
        totalPages: Math.ceil(count / pageSize),
        sortBy,
        sortDir,
      },
      filters: {
        userId: req.query.userId ?? null,
        idTicket: req.query.idTicket ?? null,
        fromStatus: req.query.fromStatus ?? null,
        toStatus: req.query.toStatus ?? null,
        dateFrom: dateFrom ?? null,
        dateTo: dateTo ?? null,
        serviceId: req.query.serviceId ?? null,
        q: req.query.q ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
};
