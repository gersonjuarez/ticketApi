// utils/time.js
const LOCAL_TZ = process.env.APP_TZ || 'America/Guatemala';

/**
 * Devuelve fecha/hora en zona local como "YYYY-MM-DD HH:mm"
 * (se imprime en el ticket; NO se guarda en DB).
 */
function fmtLocalDateTime(d = new Date()) {
  // Intl nos da "07/10/2025 14:35" y lo normalizamos
  const s = new Intl.DateTimeFormat('es-GT', {
    timeZone: LOCAL_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d); // "07/10/2025 14:35"

  const [dd, mm, yyyy, hhmm] = s.replace(',', '').split(/[\/ ]/);
  return `${yyyy}-${mm}-${dd} ${hhmm}`;
}

module.exports = { fmtLocalDateTime, LOCAL_TZ };
