const Joi = require("joi");

const registerSchema = Joi.object({
  userName: Joi.string().min(3).max(50).required().messages({
    "string.empty": "El usuario es obligatorio",
    "string.min": "El usuario debe tener al menos 3 caracteres",
  }),
  fullName: Joi.string().min(1).max(120).required().messages({
    "string.empty": "El nombre completo es obligatorio",
  }),
  email: Joi.string().email().max(255).required().messages({
    "string.email": "Email inválido",
    "any.required": "El email es obligatorio",
  }),
  password: Joi.string().min(6).max(128).required().messages({
    "string.min": "La contraseña debe tener al menos 6 caracteres",
    "any.required": "La contraseña es obligatoria",
  }),
  idRole: Joi.number().integer().positive().required().messages({
    "number.base": "idRole debe ser numérico",
    "any.required": "idRole es obligatorio",
  }),
  idCashier: Joi.number().integer().positive().allow(null).messages({
    "number.base": "idCashier debe ser numérico",
  }),
});

const loginSchema = Joi.object({
  user: Joi.string().min(1).required().messages({
    "string.empty": "Usuario o email es obligatorio",
  }),
  password: Joi.string().min(1).required().messages({
    "string.empty": "La contraseña es obligatoria",
  }),
});

module.exports = { registerSchema, loginSchema };
