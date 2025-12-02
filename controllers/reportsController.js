// controllers/reports.controller.js
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

function toHHMMSS(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds || 0)));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const r = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${r}`;
}

// Normaliza fechas a [from 00:00:00, next day of to 00:00:00)
function buildDateBounds(from, to) {
  const fromDate = `${from} 00:00:00`;
  const toDate   = `${to} 00:00:00`;
  return { fromDate, toDate };
}

/**
 * GET /reports/attention-times?from=YYYY-MM-DD&to=YYYY-MM-DD&cashierId?=&serviceId?&page?=&limit?=
 * Devuelve:
 *  - items: agregado por cajero+servicio (incluye userNames vinculados a la ventanilla)
 *  - daily: agregado por día
 *  - byCashier: agregado por cajero
 *  - segments: detalle por attendance (con usuario que atendió y quien despachó el ticket) - CON PAGINACIÓN
 *  - byTicket: agregado por ticket (incluye ventanillas y usuarios que lo atendieron) - CON PAGINACIÓN
 */
exports.getAttentionTimes = async (req, res) => {
  try {
    const { from, to, serviceId, cashierId, page = 1, limit = 100 } = req.query;
    
    // Validar y convertir parámetros de paginación
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(1000, Math.max(10, parseInt(limit) || 100)); // Límite máximo de 1000
    const offset = (pageNum - 1) * limitNum;

    if (!from || !to) {
      return res.status(400).json({
        message: "Parámetros 'from' y 'to' son requeridos (YYYY-MM-DD).",
      });
    }

    const { fromDate, toDate } = buildDateBounds(from, to);

    // Filtros
    const where = [];
    const params = { fromDate, toDate };

    // rango: [from 00:00:00, to + 1 día 00:00:00)
    where.push(
      `ta.startedAt >= :fromDate AND ta.startedAt < DATE_ADD(:toDate, INTERVAL 1 DAY)`
    );

    if (serviceId) {
      where.push(`ta.idService = :serviceId`);
      params.serviceId = Number(serviceId);
    }
    if (cashierId) {
      where.push(`ta.idCashier = :cashierId`);
      params.cashierId = Number(cashierId);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // ---------- A) Agregado por cajero + servicio (incluye usuarios vinculados a ventanilla) ----------
    const rows = await sequelize.query(
      `
      SELECT
        ta.idCashier,
        COALESCE(c.name, CONCAT('Caja ', ta.idCashier)) AS cashier,
        ta.idService,
        COALESCE(s.name, CONCAT('Servicio ', ta.idService)) AS service,
        s.prefix AS prefix,
        COUNT(*) AS atenciones,
        SUM(TIMESTAMPDIFF(SECOND, ta.startedAt, COALESCE(ta.endedAt, NOW()))) AS totalSegundos,
        AVG(TIMESTAMPDIFF(SECOND, ta.startedAt, COALESCE(ta.endedAt, NOW()))) AS promedioSeg,
        GROUP_CONCAT(DISTINCT u.fullName ORDER BY u.fullName SEPARATOR ', ') AS userNames
      FROM ticketattendance ta
      LEFT JOIN cashiers  c ON c.idCashier = ta.idCashier
      LEFT JOIN services  s ON s.idService = ta.idService
      LEFT JOIN users     u ON u.idCashier = ta.idCashier AND u.status = 1
      ${whereSql}
      GROUP BY ta.idCashier, ta.idService, cashier, service, prefix
      ORDER BY cashier ASC, service ASC;
      `,
      { type: QueryTypes.SELECT, replacements: params }
    );

    const items = rows.map(r => ({
      idCashier: Number(r.idCashier),
      cashier: String(r.cashier),
      idService: Number(r.idService),
      service: String(r.service),
      prefix: r.prefix ? String(r.prefix) : '',
      atenciones: Number(r.atenciones || 0),
      totalSegundos: Number(r.totalSegundos || 0),
      totalHHMMSS: toHHMMSS(r.totalSegundos),
      promedioSeg: Math.round(Number(r.promedioSeg || 0)),
      promedioHHMMSS: toHHMMSS(r.promedioSeg),
      userNames: (r.userNames ? String(r.userNames).split(', ').filter(Boolean) : []),
    }));

    // ---------- B) Serie diaria ----------
    const dailyRows = await sequelize.query(
      `
      SELECT
        DATE(ta.startedAt) AS day,
        COUNT(*) AS atenciones,
        SUM(TIMESTAMPDIFF(SECOND, ta.startedAt, COALESCE(ta.endedAt, NOW()))) AS totalSegundos,
        AVG(TIMESTAMPDIFF(SECOND, ta.startedAt, COALESCE(ta.endedAt, NOW()))) AS promedioSeg
      FROM ticketattendance ta
      ${whereSql}
      GROUP BY day
      ORDER BY day ASC;
      `,
      { type: QueryTypes.SELECT, replacements: params }
    );

    const daily = dailyRows.map(r => ({
      day: String(r.day),
      atenciones: Number(r.atenciones || 0),
      totalSegundos: Number(r.totalSegundos || 0),
      promedioSeg: Math.round(Number(r.promedioSeg || 0)),
      totalHHMMSS: toHHMMSS(r.totalSegundos),
      promedioHHMMSS: toHHMMSS(r.promedioSeg),
    }));

    // ---------- C) Agregado por cajero ----------
    const byCashierRows = await sequelize.query(
      `
      SELECT
        ta.idCashier,
        COALESCE(c.name, CONCAT('Caja ', ta.idCashier)) AS cashier,
        COUNT(*) AS atenciones,
        SUM(TIMESTAMPDIFF(SECOND, ta.startedAt, COALESCE(ta.endedAt, NOW()))) AS totalSegundos,
        AVG(TIMESTAMPDIFF(SECOND, ta.startedAt, COALESCE(ta.endedAt, NOW()))) AS promedioSeg
      FROM ticketattendance ta
      LEFT JOIN cashiers c ON c.idCashier = ta.idCashier
      ${whereSql}
      GROUP BY ta.idCashier, cashier
      ORDER BY cashier ASC;
      `,
      { type: QueryTypes.SELECT, replacements: params }
    );

    const byCashier = byCashierRows.map(r => ({
      idCashier: Number(r.idCashier),
      cashier: String(r.cashier),
      atenciones: Number(r.atenciones || 0),
      totalSegundos: Number(r.totalSegundos || 0),
      promedioSeg: Math.round(Number(r.promedioSeg || 0)),
      totalHHMMSS: toHHMMSS(r.totalSegundos),
      promedioHHMMSS: toHHMMSS(r.promedioSeg),
    }));

    // ---------- D) Detalle de segmentos por ticket (con usuario que atendió y quien despachó) ----------
    // Primero obtenemos el conteo total
    const [segmentCountResult] = await sequelize.query(
      `
      SELECT COUNT(*) as totalSegments
      FROM ticketattendance ta
      LEFT JOIN ticketregistrations tr ON tr.idTicketRegistration = ta.idTicket
      LEFT JOIN cashiers c ON c.idCashier = ta.idCashier
      LEFT JOIN services s ON s.idService = ta.idService
      LEFT JOIN users u  ON u.idCashier = ta.idCashier AND u.status = 1
      LEFT JOIN users du ON du.idUser   = tr.dispatchedByUser
      ${whereSql};
      `,
      { type: QueryTypes.SELECT, replacements: params }
    );
    
    const totalSegments = segmentCountResult.totalSegments || 0;
    
    // Luego obtenemos los datos paginados
    const segmentRows = await sequelize.query(
      `
      SELECT
        ta.idAttendance,
        ta.idTicket,
        tr.correlativo               AS ticketLabel,
        ta.idCashier,
        COALESCE(c.name, CONCAT('Caja ', ta.idCashier)) AS cashier,
        ta.idService,
        COALESCE(s.name, CONCAT('Servicio ', ta.idService)) AS service,
        u.idUser,
        u.fullName                   AS userName,           -- usuario asociado a la ventanilla
        tr.dispatchedByUser,
        du.fullName                  AS dispatchedByName,   -- quien despachó el ticket
        ta.startedAt,
        ta.endedAt,
        TIMESTAMPDIFF(SECOND, ta.startedAt, COALESCE(ta.endedAt, NOW())) AS seconds
      FROM ticketattendance ta
      LEFT JOIN ticketregistrations tr ON tr.idTicketRegistration = ta.idTicket
      LEFT JOIN cashiers c ON c.idCashier = ta.idCashier
      LEFT JOIN services s ON s.idService = ta.idService
      LEFT JOIN users u  ON u.idCashier = ta.idCashier AND u.status = 1
      LEFT JOIN users du ON du.idUser   = tr.dispatchedByUser
      ${whereSql}
      ORDER BY ta.idTicket ASC, ta.startedAt ASC
      LIMIT :limitNum OFFSET :offset;
      `,
      { type: QueryTypes.SELECT, replacements: { ...params, limitNum, offset } }
    );

    const segments = segmentRows.map(r => ({
      idAttendance: Number(r.idAttendance),
      idTicket: Number(r.idTicket),
      ticketLabel: String(r.ticketLabel || r.idTicket),
      idCashier: Number(r.idCashier),
      cashier: String(r.cashier),
      idService: Number(r.idService),
      service: String(r.service),
      idUser: r.idUser ? Number(r.idUser) : null,
      userName: r.userName ? String(r.userName) : null,
      dispatchedByUser: r.dispatchedByUser ? Number(r.dispatchedByUser) : null,
      dispatchedByName: r.dispatchedByName ? String(r.dispatchedByName) : null,
      startedAt: String(r.startedAt),
      endedAt: r.endedAt ? String(r.endedAt) : null,
      seconds: Number(r.seconds || 0),
      hhmmss: toHHMMSS(r.seconds),
    }));

    // ---------- E) Agregado por ticket (incluye ventanillas y usuarios que atendieron) ----------
    const byTicketMap = new Map();
    for (const seg of segments) {
      if (!byTicketMap.has(seg.idTicket)) {
        byTicketMap.set(seg.idTicket, {
          idTicket: seg.idTicket,
          ticketLabel: seg.ticketLabel,
          segments: 0,
          totalSeconds: 0,
          firstStartedAt: seg.startedAt,
          lastEndedAt: seg.endedAt,
          cashierNames: new Set(),
          userNames: new Set(),
        });
      }
      const acc = byTicketMap.get(seg.idTicket);
      acc.segments += 1;
      acc.totalSeconds += seg.seconds;
      if (seg.startedAt < acc.firstStartedAt) acc.firstStartedAt = seg.startedAt;
      if (!acc.lastEndedAt || (seg.endedAt && seg.endedAt > acc.lastEndedAt)) acc.lastEndedAt = seg.endedAt;
      acc.cashierNames.add(seg.cashier);
      if (seg.userName) acc.userNames.add(seg.userName);
    }

    const byTicket = Array.from(byTicketMap.values()).map(t => {
      const avg = t.segments ? Math.round(t.totalSeconds / t.segments) : 0;
      return {
        idTicket: t.idTicket,
        ticketLabel: t.ticketLabel,
        segments: t.segments,
        totalSeconds: t.totalSeconds,
        totalHHMMSS: toHHMMSS(t.totalSeconds),
        avgSeconds: avg,
        avgHHMMSS: toHHMMSS(avg),
        firstStartedAt: t.firstStartedAt,
        lastEndedAt: t.lastEndedAt,
        cashierNames: Array.from(t.cashierNames.values()).sort(),
        userNames: Array.from(t.userNames.values()).sort(),
      };
    });

    const count = items.reduce((acc, it) => acc + (it.atenciones || 0), 0);
    const totalPages = Math.ceil(totalSegments / limitNum);

    return res.json({
      from,
      to,
      count,
      items,
      daily,
      byCashier,
      segments: {
        data: segments,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalSegments,
          totalPages,
          hasNextPage: pageNum < totalPages,
          hasPrevPage: pageNum > 1
        }
      },
      byTicket,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      message: 'Error generando reporte',
      error: String(err?.message || err),
    });
  }
};

/**
 * GET /reports/ticket-times?from=YYYY-MM-DD&to=YYYY-MM-DD&cashierId?=&serviceId?&pageSegments?=&limitSegments?=&pageByTicket?=&limitByTicket?=
 * Devuelve:
 *  - segments: una fila por attendance (qué ticket fue, cuánto duró, ventanilla y usuario) - CON PAGINACIÓN INDEPENDIENTE
 *  - byTicket: agregado por ticket (total, promedio, primeras/últimas marcas) - CON PAGINACIÓN INDEPENDIENTE
 */
exports.getTicketTimes = async (req, res) => {
  try {
    const { 
      from, to, serviceId, cashierId,
      pageSegments = 1, limitSegments = 10,
      pageByTicket = 1, limitByTicket = 10
    } = req.query;
    
    // Validar y convertir parámetros de paginación para SEGMENTOS
    const pageNumSegments = Math.max(1, parseInt(pageSegments) || 1);
    const limitNumSegments = Math.min(1000, Math.max(5, parseInt(limitSegments) || 10));
    const offsetSegments = (pageNumSegments - 1) * limitNumSegments;

    // Validar y convertir parámetros de paginación para BY TICKET
    const pageNumByTicket = Math.max(1, parseInt(pageByTicket) || 1);
    const limitNumByTicket = Math.min(1000, Math.max(5, parseInt(limitByTicket) || 10));
    const offsetByTicket = (pageNumByTicket - 1) * limitNumByTicket;

    if (!from || !to) {
      return res.status(400).json({
        message: "Parámetros 'from' y 'to' son requeridos (YYYY-MM-DD).",
      });
    }

    const { fromDate, toDate } = buildDateBounds(from, to);

    const where = [];
    const params = { fromDate, toDate };

    where.push(
      `ta.startedAt >= :fromDate AND ta.startedAt < DATE_ADD(:toDate, INTERVAL 1 DAY)`
    );

    if (serviceId) { where.push(`ta.idService = :serviceId`); params.serviceId = Number(serviceId); }
    if (cashierId) { where.push(`ta.idCashier = :cashierId`); params.cashierId = Number(cashierId); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    // 1) Obtener conteo total de segmentos
    const [segCountResult] = await sequelize.query(
      `
      SELECT COUNT(*) as totalSegments
      FROM ticketattendance ta
      LEFT JOIN ticketregistrations tr ON tr.idTicketRegistration = ta.idTicket
      LEFT JOIN cashiers  c ON c.idCashier  = ta.idCashier
      LEFT JOIN services  s ON s.idService  = ta.idService
      LEFT JOIN users     u ON u.idCashier  = ta.idCashier AND u.status = 1
      LEFT JOIN users    du ON du.idUser    = tr.dispatchedByUser
      ${whereSql};
      `,
      { type: QueryTypes.SELECT, replacements: params }
    );
    
    const totalSegments = segCountResult.totalSegments || 0;

    // 2) Segmentos por attendance (incluye usuario que atendió y quien despachó) - PAGINADO
    const segRows = await sequelize.query(
      `
      SELECT
        ta.idAttendance,
        ta.idTicket,
        tr.correlativo               AS ticketLabel,
        ta.idCashier,
        COALESCE(c.name, CONCAT('Caja ', ta.idCashier)) AS cashier,
        ta.idService,
        COALESCE(s.name, CONCAT('Servicio ', ta.idService)) AS service,
        s.prefix AS prefix,
        u.idUser,
        u.fullName                   AS userName,
        tr.dispatchedByUser,
        du.fullName                  AS dispatchedByName,
        ta.startedAt,
        ta.endedAt,
        TIMESTAMPDIFF(SECOND, ta.startedAt, COALESCE(ta.endedAt, NOW())) AS durationSeconds
      FROM ticketattendance ta
      LEFT JOIN ticketregistrations tr ON tr.idTicketRegistration = ta.idTicket
      LEFT JOIN cashiers  c ON c.idCashier  = ta.idCashier
      LEFT JOIN services  s ON s.idService  = ta.idService
      LEFT JOIN users     u ON u.idCashier  = ta.idCashier AND u.status = 1
      LEFT JOIN users    du ON du.idUser    = tr.dispatchedByUser
      ${whereSql}
      ORDER BY ta.startedAt ASC, ta.idAttendance ASC
      LIMIT :limitNumSegments OFFSET :offsetSegments;
      `,
      { type: QueryTypes.SELECT, replacements: { ...params, limitNumSegments, offsetSegments } }
    );

    const segments = segRows.map(r => {
      const idTicket = Number(r.idTicket);
      const ticketLabel = r.ticketLabel
        ? String(r.ticketLabel)
        : (r.prefix ? `${String(r.prefix)}-${idTicket}` : `T-${idTicket}`);
      const durationSeconds = Number(r.durationSeconds || 0);
      const avgHH = toHHMMSS(durationSeconds);

      return {
        idAttendance: Number(r.idAttendance),
        idTicket,
        ticketLabel,
        idCashier: Number(r.idCashier),
        cashier: String(r.cashier || `Caja ${r.idCashier}`),
        idService: Number(r.idService),
        service: String(r.service || `Servicio ${r.idService}`),
        prefix: r.prefix ? String(r.prefix) : '',
        idUser: r.idUser ? Number(r.idUser) : null,
        userName: r.userName ? String(r.userName) : null,
        dispatchedByUser: r.dispatchedByUser ? Number(r.dispatchedByUser) : null,
        dispatchedByName: r.dispatchedByName ? String(r.dispatchedByName) : null,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        durationSeconds,
        durationHHMMSS: avgHH,
      };
    });

    // 3) Conteo total de tickets únicos
    const [ticketCountResult] = await sequelize.query(
      `
      SELECT COUNT(DISTINCT ta.idTicket) as totalTickets
      FROM ticketattendance ta
      LEFT JOIN services s ON s.idService = ta.idService
      LEFT JOIN ticketregistrations tr ON tr.idTicketRegistration = ta.idTicket
      ${whereSql};
      `,
      { type: QueryTypes.SELECT, replacements: params }
    );
    
    const totalTickets = ticketCountResult.totalTickets || 0;

    // 4) Agregado por ticket - PAGINADO
    const aggRows = await sequelize.query(
      `
      SELECT
        ta.idTicket,
        COUNT(*) AS segments,
        SUM(TIMESTAMPDIFF(SECOND, ta.startedAt, COALESCE(ta.endedAt, NOW()))) AS totalSeconds,
        AVG(TIMESTAMPDIFF(SECOND, ta.startedAt, COALESCE(ta.endedAt, NOW()))) AS avgSeconds,
        MIN(ta.startedAt) AS firstStartedAt,
        MAX(ta.endedAt)   AS lastEndedAt,
        MAX(s.prefix)     AS prefix,
        MAX(tr.correlativo) AS ticketLabel
      FROM ticketattendance ta
      LEFT JOIN services s ON s.idService = ta.idService
      LEFT JOIN ticketregistrations tr ON tr.idTicketRegistration = ta.idTicket
      ${whereSql}
      GROUP BY ta.idTicket
      ORDER BY firstStartedAt ASC, ta.idTicket ASC
      LIMIT :limitNumByTicket OFFSET :offsetByTicket;
      `,
      { type: QueryTypes.SELECT, replacements: { ...params, limitNumByTicket, offsetByTicket } }
    );

    const byTicket = aggRows.map(r => {
      const idTicket = Number(r.idTicket);
      const explicitLabel = r.ticketLabel ? String(r.ticketLabel) : null;
      const fallbackLabel =
        r.prefix ? `${String(r.prefix)}-${idTicket}` : `T-${idTicket}`;
      const ticketLabel = explicitLabel || fallbackLabel;

      const totalSeconds = Number(r.totalSeconds || 0);
      const avgSeconds = Math.round(Number(r.avgSeconds || 0));

      return {
        idTicket,
        ticketLabel,
        segments: Number(r.segments || 0),
        totalSeconds,
        totalHHMMSS: toHHMMSS(totalSeconds),
        avgSeconds,
        avgHHMMSS: toHHMMSS(avgSeconds),
        firstStartedAt: r.firstStartedAt,
        lastEndedAt: r.lastEndedAt,
      };
    });

    const totalPagesSegments = Math.ceil(totalSegments / limitNumSegments);
    const totalPagesTickets = Math.ceil(totalTickets / limitNumByTicket);

    return res.json({
      from,
      to,
      filters: {
        serviceId: serviceId ? Number(serviceId) : undefined,
        cashierId: cashierId ? Number(cashierId) : undefined,
      },
      segments: {
        data: segments,
        pagination: {
          page: pageNumSegments,
          limit: limitNumSegments,
          total: totalSegments,
          totalPages: totalPagesSegments,
          hasNextPage: pageNumSegments < totalPagesSegments,
          hasPrevPage: pageNumSegments > 1
        }
      },
      byTicket: {
        data: byTicket,
        pagination: {
          page: pageNumByTicket,
          limit: limitNumByTicket,
          total: totalTickets,
          totalPages: totalPagesTickets,
          hasNextPage: pageNumByTicket < totalPagesTickets,
          hasPrevPage: pageNumByTicket > 1
        }
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      message: 'Error generando reporte de tiempos por ticket',
      error: String(err?.message || err),
    });
  }
};
