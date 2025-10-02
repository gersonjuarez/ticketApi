// controllers/auth.controller.js
const { Op } = require('sequelize');
const db = require('../models');
const { ApiError } = require('../middlewares/errorHandler');

const { Role, Module, RoleModule } = db;
const isDev = process.env.NODE_ENV !== 'production';

const logErr = (scope, err) => {
  if (!isDev) return;
  console.error(`[auth:${scope}]`, {
    name: err?.name,
    message: err?.message,
    stack: err?.stack,
    sql: err?.parent?.sql,
    sqlMessage: err?.parent?.sqlMessage,
  });
};

const toInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
};

module.exports = {
  /**
   * GET /api/auth/permissions
   * Devuelve módulos ACTIVOS (status=1) asignados al rol del usuario autenticado.
   */
  myPermissions: async (req, res, next) => {
    try {
      // req.user debe venir de tu middleware de autenticación (ej: JWT)
      if (!req.user || req.user.role == null) {
        throw new ApiError('Usuario no autenticado', 401);
      }

      const idRole = toInt(req.user.role);
      if (!Number.isInteger(idRole) || idRole <= 0) {
        throw new ApiError('Rol inválido', 400);
      }

      const role = await Role.findByPk(idRole, {
        attributes: ['idRole', 'name', 'status'],
      });
      if (!role) throw new ApiError('Rol no encontrado', 404);

      // módulos asignados al rol (pueden venir duplicados por mala data → deduplicamos)
      const assigned = await RoleModule.findAll({
        where: { idRole },
        attributes: ['idModule'],
        order: [['idModule', 'ASC']],
      });

      const ids = Array.from(new Set(assigned.map((a) => a.idModule))).filter(
        (x) => Number.isInteger(x) && x > 0
      );

      let modules = [];
      if (ids.length > 0) {
        modules = await Module.findAll({
          where: {
            idModule: { [Op.in]: ids },
            status: 1, // solo activos globalmente
          },
          attributes: ['idModule', 'name', 'route'],
          order: [['idModule', 'ASC']],
        });
      }

      return res.json({
        roleId: role.idRole,
        role: role.name,
        modules: modules.map((m) => ({
          idModule: m.idModule,
          name: m.name,
          route: m.route,
        })),
      });
    } catch (err) {
      logErr('myPermissions', err);
      return next(err instanceof ApiError ? err : new ApiError('No se pudieron obtener permisos', 500));
    }
  },
};
