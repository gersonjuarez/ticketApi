const {
  ValidationError,
  UniqueConstraintError,
  ForeignKeyConstraintError,
  DatabaseError,
} = require('sequelize');

class ApiError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
  }
}

function notFound(req, _res, next) {
  next(new ApiError(`Ruta no encontrada: ${req.method} ${req.originalUrl}`, 404));
}

function mapSequelizeError(err) {
  if (err instanceof ValidationError || err instanceof UniqueConstraintError) {
    return new ApiError('Error de validación', 400, err.errors?.map(e => ({ field: e.path, message: e.message })));
  }
  if (err instanceof ForeignKeyConstraintError) {
    return new ApiError('Violación de integridad referencial', 409, { table: err.table, fields: err.fields });
  }
  if (err instanceof DatabaseError) {
    return new ApiError('Error de base de datos', 500);
  }
  return null;
}

function errorHandler(err, req, res, _next) {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ ok:false, message: 'JSON inválido' });
  }
  const mapped = mapSequelizeError(err);
  const status = mapped?.statusCode || err.statusCode || 500;
  const message = mapped?.message || err.message || 'Error interno del servidor';
  const details = mapped?.details;

  console.error('[ERROR]', {
    url: req.originalUrl,
    method: req.method,
    status, message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    details
  });

  if (res.headersSent) return;
  res.status(status).json({ ok:false, message, ...(details ? { details } : {}) });
}

module.exports = { ApiError, notFound, errorHandler };
