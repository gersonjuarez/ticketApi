// services/cashierPauseOverview.service.js
const { sequelize } = require("../models");

/* =========================
   Normalizar rango (Guatemala → UTC)
========================= */
function getRange(from, to) {
  const convertToUTC = (dateStr, endOfDay = false) => {
    const d = new Date(dateStr);

    if (endOfDay) {
      d.setHours(23, 59, 59, 999);
    } else {
      d.setHours(0, 0, 0, 0);
    }

    // Convertir fecha-hora local a UTC real
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  };

  const start = from
    ? convertToUTC(from)
    : new Date("1970-01-01T00:00:00Z");

  const end = to
    ? convertToUTC(to, true)
    : new Date("2999-12-31T23:59:59Z");

  return { start, end };
}

/* =========================
   OVERVIEW PRINCIPAL
========================= */
async function overview({
  from,
  to,
  statusType = "PAUSE",
  limitTopUsers = 10,
  limitLongest = 20,
}) {
  const { start, end } = getRange(from, to);

  /* ----------------------------------
     1) TOTALS
  ----------------------------------- */
  const [totalsRows] = await sequelize.query(
    `
    SELECT
      COUNT(*) AS total_pauses,
      COALESCE(SUM(duration_seconds),0) AS total_seconds,
      COALESCE(AVG(duration_seconds),0) AS avg_seconds
    FROM v_cashier_pause_log
    WHERE statusType = :statusType
      AND startedAt BETWEEN :start AND :end;
    `,
    { replacements: { statusType, start, end } }
  );

  const totals = totalsRows?.[0] ?? {
    total_pauses: 0,
    total_seconds: 0,
    avg_seconds: 0,
  };

  /* ----------------------------------
     2) OPEN NOW
  ----------------------------------- */
  const [openRows] = await sequelize.query(
    `
    SELECT
      idCashierStatusLog,
      idCashier,
      cashierName,
      performedByUserId,
      performedByName,
      comment,
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

  /* ----------------------------------
     3) TOP USERS (FIX LIMIT)
  ----------------------------------- */
  const [topUsers] = await sequelize.query(
    `
    SELECT
      performedByUserId,
      MIN(performedByName) AS performedByName,
      COUNT(*) AS pause_count,
      COALESCE(SUM(duration_seconds),0) AS total_seconds,
      COALESCE(AVG(duration_seconds),0) AS avg_seconds
    FROM v_cashier_pause_log
    WHERE statusType = :statusType
      AND startedAt BETWEEN :start AND :end
    GROUP BY performedByUserId
    ORDER BY pause_count DESC, total_seconds DESC
    LIMIT ${Number(limitTopUsers)};
    `,
    { replacements: { statusType, start, end } }
  );

  /* ----------------------------------
     4) BY CASHIER
  ----------------------------------- */
  const [byCashier] = await sequelize.query(
    `
    SELECT
      idCashier,
      MIN(cashierName) AS cashierName,
      COUNT(*) AS pause_count,
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

  /* ----------------------------------
     5) DAILY SERIES
  ----------------------------------- */
  const [daily] = await sequelize.query(
    `
    SELECT
      DATE(startedAt) AS day,
      COUNT(*) AS pause_count,
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

  /* ----------------------------------
     6) LONGEST PAUSES (FIX LIMIT)
  ----------------------------------- */
  const [longest] = await sequelize.query(
    `
    SELECT
      idCashierStatusLog,
      idCashier,
      cashierName,
      comment,
      startedAt,
      endedAt,
      performedByUserId,
      performedByName,
      closedByUserId,
      closedByName,
      duration_seconds
    FROM v_cashier_pause_log
    WHERE statusType = :statusType
      AND startedAt BETWEEN :start AND :end
    ORDER BY duration_seconds DESC
    LIMIT ${Number(limitLongest)};
    `,
    { replacements: { statusType, start, end } }
  );

  /* ----------------------------------
     RETURN
  ----------------------------------- */
  return {
    range: {
      from: from || null,
      to: to || null,
    },
    statusType,
    totals,
    openNow,
    topUsers,
    byCashier,
    daily,
    longest,
  };
}

module.exports = { overview };
