// utils/turnNumbers.js
const { sequelize, ServiceTurnCounter } = require('../models');

// Guatemala no tiene DST: UTC-6 todo el año.
// Aun así usamos Intl con timeZone para que quede correcto
function todayGuatemalaDateString(d = new Date()) {
  const parts = new Intl.DateTimeFormat('es-GT', {
    timeZone: 'America/Guatemala',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t) => parts.find(x => x.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`; // YYYY-MM-DD
}

const padN = (n, width = 3) => String(n).padStart(width, '0'); // 001, 002, ...

/**
 * Devuelve el siguiente número de turno (atómico, transaccional) para el día GT.
 * - Crea el registro del día si no existe (seed = 0)
 * - Lo bloquea con FOR UPDATE y aumenta en 1
 */
async function getNextTurnNumber(serviceId, t, day = todayGuatemalaDateString()) {
  // 1) Seed (si no existe)
  await ServiceTurnCounter.findOrCreate({
    where: { service_id: serviceId, turn_date: day },
    defaults: { next_number: 0 },
    transaction: t,
  });

  // 2) Lock de la fila del día
  const row = await ServiceTurnCounter.findOne({
    where: { service_id: serviceId, turn_date: day },
    transaction: t,
    lock: t.LOCK.UPDATE,
  });

  const assigned = Number(row.next_number) + 1;

  // 3) Persistir incremento
  await ServiceTurnCounter.update(
    { next_number: assigned },
    { where: { service_id: serviceId, turn_date: day }, transaction: t }
  );

  return assigned;
}

module.exports = { getNextTurnNumber, padN, todayGuatemalaDateString };
