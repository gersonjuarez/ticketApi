// middlewares/errorHandler.js
const {
  ValidationError,
  UniqueConstraintError,
  ForeignKeyConstraintError,
  DatabaseError,
} = require('sequelize');
const { logger } = require('../logger');

class ApiError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true; // útil para métricas/alarms
  }
}

function notFound(req, _res, next) {
  next(new ApiError(`Ruta no encontrada: ${req.method} ${req.originalUrl}`, 404));
}

function mapSequelizeError(err) {
  if (err instanceof ValidationError || err instanceof UniqueConstraintError) {
    return new ApiError(
      'Error de validación',
      400,
      err.errors?.map(e => ({ field: e.path, message: e.message }))
    );
  }
  if (err instanceof ForeignKeyConstraintError) {
    return new ApiError(
      'Violación de integridad referencial',
      409,
      { table: err.table, fields: err.fields, index: err.index }
    );
  }
  if (err instanceof DatabaseError) {
    const sqlInfo = {
      sql: err.sql || err.parent?.sql,
      sqlMessage: err.parent?.sqlMessage || err.original?.sqlMessage,
      sqlState: err.parent?.sqlState || err.original?.sqlState,
      code: err.parent?.code || err.original?.code,
    };
    return new ApiError('Error de base de datos', 500, sqlInfo);
  }
  return null;
}

// Sanitiza cuerpo/query para evitar loguear secretos
function sanitize(obj) {
  const SENSITIVE_KEYS = ['password', 'pass', 'token', 'authorization', 'auth', 'appkey', 'apptoken', 'secret', 'client_secret'];
  try {
    const clone = JSON.parse(JSON.stringify(obj || {}));
    const lowerKeys = (o) => {
      Object.keys(o).forEach(k => {
        const v = o[k];
        if (SENSITIVE_KEYS.includes(String(k).toLowerCase())) {
          o[k] = '[REDACTED]';
        } else if (v && typeof v === 'object') {
          lowerKeys(v);
        }
      });
    };
    lowerKeys(clone);
    return clone;
  } catch {
    return {};
  }
}

function errorHandler(err, req, res, _next) {
  // JSON malformado
  if (err instanceof SyntaxError && 'body' in err) {
    req.log ? req.log.warn('JSON inválido', { requestId: req.id }) : logger.warn('JSON inválido', { requestId: req.id });
    return res.status(400).json({ ok: false, message: 'JSON inválido' });
  }

  const mapped = mapSequelizeError(err);
  const status = mapped?.statusCode || err.statusCode || 500;
  const message = mapped?.message || err.message || 'Error interno del servidor';
  const details = mapped?.details;

  // Payload para logging (sanitizado)
  const logPayload = {
    requestId: req.id,
    url: req.originalUrl,
    method: req.method,
    status,
    message,
    ip: req.ip,
    user: req.user ? { id: req.user.id, email: req.user.email } : undefined,
    body: sanitize(req.body),
    query: sanitize(req.query),
    params: sanitize(req.params),
  };

  // En dev incluimos stack, en prod no (para no filtrar info)
  if (process.env.NODE_ENV !== 'production' && err.stack) {
    logPayload.stack = err.stack;
  }
  if (details) logPayload.details = details;

  // Loguea con request logger si existe, si no, global
  const log = req.log || logger;
  if (status >= 500) log.error('Unhandled error', logPayload);
  else if (status >= 400) log.warn('Handled client error', logPayload);
  else log.info('Non-error path in errorHandler', logPayload);

  if (res.headersSent) return;
  res.status(status).json({ ok: false, message, ...(details ? { details } : {}) });
}

module.exports = { ApiError, notFound, errorHandler };
