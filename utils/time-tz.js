// utils/time-tz.js

// Zona horaria oficial de Guatemala
const GT_TZ = 'America/Guatemala';

/**
 * Formatea un Date a la zona horaria de Guatemala
 * en formato YYYY-MM-DD HH:mm
 */
function fmtGuatemalaYYYYMMDDHHmm(date = new Date()) {
  const parts = new Intl.DateTimeFormat('es-GT', {
    timeZone: GT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type) => parts.find((x) => x.type === type)?.value || '';

  // Ojo: month y day ya vienen con 2 dígitos
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

module.exports = {
  GT_TZ,
  fmtGuatemalaYYYYMMDDHHmm,
};
