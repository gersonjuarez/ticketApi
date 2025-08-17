// utils/tokenBlacklist.js
// Blocklist en memoria (simple). Idealmente usa Redis/DB en producción.
const store = new Map(); // token -> expMs

function add(token, ttlSeconds = 3600) {
  if (!token) return;
  const exp = Date.now() + ttlSeconds * 1000;
  store.set(token, exp);
}

function has(token) {
  const exp = store.get(token);
  if (!exp) return false;
  if (Date.now() > exp) {
    store.delete(token);
    return false;
  }
  return true;
}

// Limpieza periódica
setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of store) {
    if (exp <= now) store.delete(t);
  }
}, 60 * 1000).unref();

module.exports = { add, has };
