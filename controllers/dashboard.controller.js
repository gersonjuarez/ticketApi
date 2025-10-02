// controllers/dashboard.controller.js
const { Op, fn, col, literal } = require('sequelize');
const { TicketRegistration, Client, TicketStatus, sequelize } = require('../models');

// ⚠️ estados que cuentan como "atendido"
const ATTENDED_STATUS_IDS = [2];

// Campo base de fecha
const DATE_FIELD = 'updatedAt';

// Ambiente
const isDev = process.env.NODE_ENV !== 'production';

// Helpers fecha
function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d = new Date())   { const x = new Date(d); x.setHours(23,59,59,999); return x; }
function startOfMonth(d)            { return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0); }
function endOfMonth(d)              { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999); }
function addMonths(d, delta)        { return new Date(d.getFullYear(), d.getMonth() + delta, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()); }

const fmtMonth = new Intl.DateTimeFormat('es-ES', { month: 'short', year: 'numeric' });

// Helpers genéricos
const parseIntClamp = (v, def, min, max) => {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
};
const parseBool = (v, dflt = false) => {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1') return true;
  if (v === 0 || v === '0') return false;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true','sí','si','yes'].includes(s)) return true;
    if (['false','no'].includes(s)) return false;
  }
  return dflt;
};
const logErr = (scope, err) => {
  if (!isDev) return;
  console.error(`[dashboard:${scope}]`, {
    name: err?.name,
    message: err?.message,
    sql: err?.sql || err?.parent?.sql,
    sqlMessage: err?.parent?.sqlMessage || err?.original?.sqlMessage,
    sqlState: err?.parent?.sqlState,
    stack: err?.stack,
  });
};

/**
 * GET /api/dashboard/tickets/attended-today
 * Respuesta: { count: number }
 */
exports.getTicketsAttendedToday = async (req, res) => {
  try {
    const from = startOfDay();
    const to = endOfDay();

    const where = {
      status: true, // solo activos
      idTicketStatus: { [Op.in]: ATTENDED_STATUS_IDS },
      [DATE_FIELD]: { [Op.between]: [from, to] },
    };

    const count = await TicketRegistration.count({ where /*, logging: console.log*/ });
    return res.json({ count });
  } catch (err) {
    logErr('attended-today', err);
    return res.status(500).json({ error: 'Error al obtener tickets atendidos hoy' });
  }
};

/**
 * GET /api/dashboard/tickets/by-month?months=12&onlyAttended=false
 * Respuesta: [{ month: 'ago. 2025', count: 10 }, ...]
 * Agrupa por mes del DATE_FIELD e incluye solo status=true.
 */
exports.getTicketsByMonth = async (req, res) => {
  try {
    const months = parseIntClamp(req.query.months ?? '12', 12, 1, 24);
    const onlyAttended = parseBool(req.query.onlyAttended, false);

    const now = new Date();
    const firstMonthDate = startOfMonth(addMonths(now, -(months - 1)));
    const lastMonthDate = endOfMonth(now);

    // DATE_FORMAT(field, '%Y-%m')
    const ymExpr = fn('DATE_FORMAT', col(`TicketRegistration.${DATE_FIELD}`), '%Y-%m');

    const where = {
      status: true,
      [DATE_FIELD]: { [Op.between]: [firstMonthDate, lastMonthDate] },
      ...(onlyAttended ? { idTicketStatus: { [Op.in]: ATTENDED_STATUS_IDS } } : {}),
    };

    const rows = await TicketRegistration.findAll({
      attributes: [
        [ymExpr, 'ym'],
        [fn('COUNT', literal('*')), 'count'],
      ],
      where,
      group: [ymExpr],             // ✅ compatible con ONLY_FULL_GROUP_BY
      order: [[ymExpr, 'ASC']],
      raw: true,
      // logging: console.log,
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
    logErr('by-month', err);
    return res.status(500).json({ error: 'Error al obtener tickets por mes' });
  }
};

/**
 * GET /api/dashboard/tickets/by-status
 * Respuesta: [{ idTicketStatus, name, count }]
 * Cuenta tickets activos agrupados por estado.
 */
exports.getTicketsByStatus = async (req, res) => {
  try {
    const rows = await TicketRegistration.findAll({
      attributes: [
        'idTicketStatus',
        [fn('COUNT', literal('*')), 'count'],
        [col('TicketStatus.name'), 'name'],
      ],
      where: { status: true },
      include: [
        {
          model: TicketStatus,
          attributes: [],
          required: false,
        },
      ],
      group: [
        col('TicketRegistration.idTicketStatus'),
        col('TicketStatus.name'), // ✅ evita ONLY_FULL_GROUP_BY
      ],
      order: [[col('TicketRegistration.idTicketStatus'), 'ASC']],
      raw: true,
      // logging: console.log,
    });

    const result = rows.map(r => ({
      idTicketStatus: Number(r.idTicketStatus),
      name: r.name || String(r.idTicketStatus),
      count: Number(r.count || 0),
    }));

    return res.json(result);
  } catch (err) {
    logErr('by-status', err);
    return res.status(500).json({ error: 'Error al agrupar tickets por estado' });
  }
};

/**
 * GET /api/dashboard/tickets/client/count
 * Respuesta: { count: number }
 * Solo clientes activos (status = true).
 */
exports.getClientsCount = async (req, res) => {
  try {
    const count = await Client.count({ where: { status: true } /*, logging: console.log*/ });
    return res.json({ count });
  } catch (err) {
    logErr('clients-count', err);
    return res.status(500).json({ error: 'Error al obtener cantidad de clientes' });
  }
};
