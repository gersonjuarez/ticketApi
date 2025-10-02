// services/cashierPauseOverview.service.js
const { sequelize } = require('../models');

/**
 * Normaliza rango [from, to] y asegura fin del día.
 */
function getRange(from, to) {
  const start = from ? new Date(from) : new Date('1970-01-01');
  const end = to ? new Date(to) : new Date('2999-12-31');
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

/**
 * Devuelve: totals, topUsers, byCashier, daily, longest, openNow
 */
async function overview({ from, to, statusType = 'PAUSE', limitTopUsers = 10, limitLongest = 20 }) {
  const { start, end } = getRange(from, to);

  // 1) Totales del periodo
  const [totals] = await sequelize.query(
    `
    SELECT
      COUNT(*)                    AS total_pauses,
      COALESCE(SUM(duration_seconds), 0) AS total_seconds,
      COALESCE(AVG(duration_seconds), 0) AS avg_seconds
    FROM v_cashier_pause_log
    WHERE statusType = :statusType
      AND startedAt BETWEEN :start AND :end;
    `,
    { replacements: { statusType, start, end } }
  );

  // 2) Pausas abiertas ahora (en general, y listado simple)
  const [openRows] = await sequelize.query(
    `
    SELECT
      idCashierStatusLog, idCashier, cashierName,
      performedByUserId, performedByName,
      startedAt,
      TIMESTAMPDIFF(SECOND, startedAt, NOW()) AS duration_seconds
    FROM v_cashier_pause_log
    WHERE statusType = :statusType
      AND endedAt IS NULL;
    `,
    { replacements: { statusType } }
  );
  const openNow = {
    count: openRows.length,
    rows: openRows,
  };

  // 3) Top usuarios por cantidad y duración (sin ANY_VALUE: usamos MIN() para el nombre)
  const [topUsers] = await sequelize.query(
    `
    SELECT
      performedByUserId,
      MIN(performedByName)               AS performedByName,
      COUNT(*)                           AS pause_count,
      COALESCE(SUM(duration_seconds),0)  AS total_seconds,
      COALESCE(AVG(duration_seconds),0)  AS avg_seconds
    FROM v_cashier_pause_log
    WHERE statusType = :statusType
      AND startedAt BETWEEN :start AND :end
    GROUP BY performedByUserId
    ORDER BY pause_count DESC, total_seconds DESC
    LIMIT :limitTopUsers;
    `,
    { replacements: { statusType, start, end, limitTopUsers: Number(limitTopUsers) } }
  );

  // 4) Resumen por cajero
  const [byCashier] = await sequelize.query(
    `
    SELECT
      idCashier,
      MIN(cashierName)                  AS cashierName,
      COUNT(*)                          AS pause_count,
      COALESCE(SUM(duration_seconds),0) AS total_seconds,
      COALESCE(AVG(duration_seconds),0) AS avg_seconds
    FROM v_cashier_pause_log
    WHERE statusType = :statusType
      AND startedAt BETWEEN :start AND :end
    GROUP BY idCashier
    ORDER BY total_seconds DESC;
    `,
    { replacements: { statusType, start, end } }
  );

  // 5) Serie diaria (para charts)
  const [daily] = await sequelize.query(
    `
    SELECT
      DATE(startedAt)                   AS day,
      COUNT(*)                          AS pause_count,
      COALESCE(SUM(duration_seconds),0) AS total_seconds,
      COALESCE(AVG(duration_seconds),0) AS avg_seconds
    FROM v_cashier_pause_log
    WHERE statusType = :statusType
      AND startedAt BETWEEN :start AND :end
    GROUP BY DATE(startedAt)
    ORDER BY day ASC;
    `,
    { replacements: { statusType, start, end } }
  );

  // 6) Pausas más largas
  const [longest] = await sequelize.query(
    `
    SELECT
      idCashierStatusLog,
      cashierName,
      performedByName,
      startedAt,
      endedAt,
      duration_seconds
    FROM v_cashier_pause_log
    WHERE statusType = :statusType
      AND startedAt BETWEEN :start AND :end
    ORDER BY duration_seconds DESC
    LIMIT :limitLongest;
    `,
    { replacements: { statusType, start, end, limitLongest: Number(limitLongest) } }
  );

  return {
    range: { from: start, to: end },
    statusType,
    totals: totals?.[0] ?? { total_pauses: 0, total_seconds: 0, avg_seconds: 0 },
    openNow,
    topUsers,
    byCashier,
    daily,
    longest,
  };
}

module.exports = { overview };
