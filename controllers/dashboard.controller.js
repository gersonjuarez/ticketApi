// controllers/dashboard.controller.js
const { Op, fn, col, literal } = require('sequelize');
const { TicketRegistration, Client, TicketStatus, sequelize } = require('../models');

// ⚠️ IDs que representan "atendido/cerrado"
const ATTENDED_STATUS_IDS = [2];

// Campo de fecha a usar para los cálculos: 'updatedAt' o 'createdAt'
const DATE_FIELD = 'updatedAt';

// Helpers de fecha (basado en TZ del servidor)
function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d = new Date()) { const x = new Date(d); x.setHours(23,59,59,999); return x; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999); }
function addMonths(d, delta) { return new Date(d.getFullYear(), d.getMonth() + delta, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()); }

const fmtMonth = new Intl.DateTimeFormat('es-ES', { month: 'short', year: 'numeric' });

/**
 * GET /api/dashboard/tickets/attended-today
 * Respuesta: { count: number }
 * Cuenta tickets en estado “atendido” cuya fecha (DATE_FIELD) cayó HOY,
 * y que estén activos (status = true).
 */
exports.getTicketsAttendedToday = async (req, res) => {
  try {
    const from = startOfDay();
    const to = endOfDay();

    const where = {
      status: true, // ✅ solo activos
      idTicketStatus: { [Op.in]: ATTENDED_STATUS_IDS },
      [DATE_FIELD]: { [Op.between]: [from, to] },
    };

    const count = await TicketRegistration.count({ where });
    return res.json({ count });
  } catch (err) {
    console.error('getTicketsAttendedToday error:', err);
    return res.status(500).json({ error: 'Error al obtener tickets atendidos hoy' });
  }
};

/**
 * GET /api/dashboard/tickets/by-month?months=12
 * Respuesta: [{ month: 'ago. 2025', count: 10 }, ...]
 * Agrupa por mes usando DATE_FORMAT(DATE_FIELD, '%Y-%m') (MySQL).
 * Incluye solo registros activos (status = true).
 * (Si deseas solo atendidos, descomenta el filtro de idTicketStatus)
 */
exports.getTicketsByMonth = async (req, res) => {
  try {
    const months = Math.min(Math.max(parseInt(req.query.months || '12', 10), 1), 24);

    const now = new Date();
    const firstMonthDate = startOfMonth(addMonths(now, -(months - 1)));
    const lastMonthDate = endOfMonth(now);

    const ymExpr = fn('DATE_FORMAT', col(DATE_FIELD), '%Y-%m');

    const rows = await TicketRegistration.findAll({
      attributes: [
        [ymExpr, 'ym'],
        [fn('COUNT', literal('*')), 'count'],
      ],
      where: {
        status: true, // ✅ solo activos
        // Descomenta si quieres SOLO atendidos en la dona/barras:
        // idTicketStatus: { [Op.in]: ATTENDED_STATUS_IDS },
        [DATE_FIELD]: { [Op.between]: [firstMonthDate, lastMonthDate] },
      },
      group: [literal('ym')], // si tu MySQL no acepta alias, usa: group: [ymExpr]
      order: [literal('ym ASC')],
      raw: true,
    });

    const dbMap = new Map(rows.map(r => [r.ym, Number(r.count)]));

    const result = [];
    for (let i = 0; i < months; i++) {
      const d = addMonths(firstMonthDate, i);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      result.push({ month: fmtMonth.format(d), count: dbMap.get(ym) || 0 });
    }

    return res.json(result);
  } catch (err) {
    console.error('getTicketsByMonth error:', err);
    return res.status(500).json({ error: 'Error al obtener tickets por mes' });
  }
};

/**
 * GET /api/dashboard/tickets/by-status
 * Respuesta: [{ idTicketStatus: 1, name: 'Pendiente', count: 12 }, ...]
 * Cuenta tickets activos (status = true) agrupados por estado.
 */
exports.getTicketsByStatus = async (req, res) => {
  try {
    const rows = await TicketRegistration.findAll({
      attributes: [
        'idTicketStatus',
        [fn('COUNT', literal('*')), 'count'],
        [col('TicketStatus.name'), 'name'],
      ],
      where: { status: true }, // ✅ solo activos
      include: [
        {
          model: TicketStatus,
          attributes: [], // solo usamos el nombre vía columna
          required: false,
        },
      ],
      group: ['idTicketStatus',],
      order: [['idTicketStatus', 'ASC']],
      raw: true,
    });

    // Normalizamos tipos y nombres
    const result = rows.map(r => ({
      idTicketStatus: Number(r.idTicketStatus),
      name: r.name || String(r.idTicketStatus),
      count: Number(r.count || 0),
    }));

    return res.json(result);
  } catch (err) {
    console.error('getTicketsByStatus error:', err);
    return res.status(500).json({ error: 'Error al agrupar tickets por estado' });
  }
};

/**
 * GET /api/dashboard/clients/count
 * Respuesta: { count: number }
 * Solo clientes activos (status = true).
 */
exports.getClientsCount = async (req, res) => {
  try {
    const count = await Client.count({ where: { status: true } }); // ✅ solo activos
    return res.json({ count });
  } catch (err) {
    console.error('getClientsCount error:', err);
    return res.status(500).json({ error: 'Error al obtener cantidad de clientes' });
  }
};
