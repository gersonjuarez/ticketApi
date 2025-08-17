// middlewares/validate.js
const { ApiError } = require("./errorHandler");

/**
 * Valida req.body contra un schema de Joi.
 * - stripUnknown: quita campos no permitidos
 * - abortEarly: junta todos los errores
 */
function validateBody(joiSchema) {
  return (req, _res, next) => {
    const { error, value } = joiSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const details = error.details.map(d => ({
        path: Array.isArray(d.path) ? d.path.join(".") : String(d.path),
        message: d.message,
        type: d.type,
      }));
      return next(new ApiError("Error de validación", 400, details));
    }

    req.body = value;
    next();
  };
}

/** (Opcional) valida req.params */
function validateParams(joiSchema) {
  return (req, _res, next) => {
    const { error, value } = joiSchema.validate(req.params, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });
    if (error) {
      const details = error.details.map(d => ({
        path: Array.isArray(d.path) ? d.path.join(".") : String(d.path),
        message: d.message,
        type: d.type,
      }));
      return next(new ApiError("Error de validación en params", 400, details));
    }
    req.params = value;
    next();
  };
}

/** (Opcional) valida req.query */
function validateQuery(joiSchema) {
  return (req, _res, next) => {
    const { error, value } = joiSchema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });
    if (error) {
      const details = error.details.map(d => ({
        path: Array.isArray(d.path) ? d.path.join(".") : String(d.path),
        message: d.message,
        type: d.type,
      }));
      return next(new ApiError("Error de validación en query", 400, details));
    }
    req.query = value;
    next();
  };
}

module.exports = { validateBody, validateParams, validateQuery };
