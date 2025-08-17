// middlewares/authRequired.js
const jwt = require('jsonwebtoken');
const tokenBlacklist = require('../utils/tokenBlacklist');

function authRequired(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) {
      return res.status(401).json({ ok: false, message: 'No autorizado' });
    }
    const token = auth.slice(7);

    if (tokenBlacklist.has(token)) {
      return res.status(401).json({ ok: false, message: 'Token invalidado' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // opcional: adjuntar al request
    req.user = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
    };
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, message: 'Token inválido o expirado' });
  }
}

module.exports = authRequired;
