// utils/turnNumbers.js
const { sequelize } = require('../models');

function padN(n, width = 3) {
  return String(n).padStart(width, "0");
}


async function getNextTurnNumber(serviceId, t) {
  // Fecha de hoy en Guatemala (sin hora)
  const tzDateSql = `DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-06:00'))`;

  const [rows] = await sequelize.query(
    `SELECT next_number
       FROM service_turn_counters
      WHERE service_id = ? AND turn_date = ${tzDateSql}
      FOR UPDATE`,
    { replacements: [serviceId], transaction: t }
  );

  if (rows.length === 0) {
    await sequelize.query(
      `INSERT INTO service_turn_counters (service_id, turn_date, next_number)
       VALUES (?, ${tzDateSql}, 1)`,
      { replacements: [serviceId], transaction: t }
    );
    return 1;
  }

  const assigned = Number(rows[0].next_number) + 1;
  await sequelize.query(
    `UPDATE service_turn_counters
        SET next_number = ?
      WHERE service_id = ? AND turn_date = ${tzDateSql}`,
    { replacements: [assigned, serviceId], transaction: t }
  );

  return assigned;
}

module.exports = { getNextTurnNumber, padN };
