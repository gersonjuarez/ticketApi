// middlewares/limiters.js
function loginLimiter(_req, _res, next) {
  // Stub sin dependencias; siempre permite.
  next();
}

module.exports = { loginLimiter };
