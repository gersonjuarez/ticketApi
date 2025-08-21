// controllers/ticketHistory.controller.js
const { Op } = require('sequelize');
const db = require('../models');
const { TicketHistory, TicketRegistration, User } = db;

/**
 * GET /api/ticket-history
 * Query:
 *  - page, pageSize (default 1, 10)
 *  - sortBy (default 'timestamp'), sortDir ('ASC'|'DESC', default 'DESC')
 *  - userId (changedByUser)
 *  - fromStatus (1|2|3|4)  // Pendiente, Atendido, Cancelado, Finalizado (ajusta nombres a tu gusto)
 *  - toStatus   (opcional)
 *  - dateFrom (ISO o yyyy-mm-dd)
 *  - dateTo   (ISO o yyyy-mm-dd)  // inclusivo fin de día
 *  - idTicket (opcional: filtra por ticket específico)
 */
module.exports.list = async (req, res, next) => {
  try {
    const {
      page = '1',
      pageSize = '10',
      sortBy = 'timestamp',
      sortDir = 'DESC',
      userId,
      fromStatus,
      toStatus,
      dateFrom,
      dateTo,
      idTicket,
    } = req.query;

    // sanitizar básicos
    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 10));
    const order = [[sortBy, String(sortDir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC']];

    const where = {};

    if (userId) where.changedByUser = Number(userId);
    if (idTicket) where.idTicket = Number(idTicket);
    if (fromStatus) where.fromStatus = Number(fromStatus);
    if (toStatus) where.toStatus = Number(toStatus);

    // rango de fechas (timestamp)
    if (dateFrom || dateTo) {
      const range = {};
      if (dateFrom) range[Op.gte] = new Date(dateFrom);
      if (dateTo) {
        const to = new Date(dateTo);
        // incluir el final del día
        to.setHours(23, 59, 59, 999);
        range[Op.lte] = to;
      }
      where.timestamp = range;
    }

    const { rows, count } = await TicketHistory.findAndCountAll({
      where,
      include: [
        {
          model: TicketRegistration,
          attributes: ['idTicketRegistration', 'turnNumber', 'idService', 'prefix', 'correlativo'],
          foreignKey: 'idTicket',
        },
        {
          model: User,
          attributes: ['id', 'name', 'email'],
          foreignKey: 'changedByUser',
        },
      ],
      order,
      offset: (p - 1) * ps,
      limit: ps,
    });

    res.json({
      data: rows,
      pagination: {
        page: p,
        pageSize: ps,
        total: count,
        totalPages: Math.ceil(count / ps),
      },
    });
  } catch (err) {
    next(err);
  }
};
