// controllers/auth.controller.js
const db = require("../models");
const { ApiError } = require("../middlewares/errorHandler");
const { Role, Module, RoleModule } = db;

module.exports = {
  // GET /api/auth/permissions
  // Devuelve SOLO lo que el usuario puede ver:
  // módulos ASIGNADOS a su rol Y con status=1 (activos globalmente)
  myPermissions: async (req, res, next) => {
    try {
      if (req.user?.role == null)
        throw new ApiError("Usuario no autenticado", 401);

      const idRole = Number(req.user.role);
      if (!Number.isInteger(idRole) || idRole <= 0)
        throw new ApiError("Rol inválido", 400);

      const role = await Role.findByPk(idRole);
      if (!role) throw new ApiError("Rol no encontrado", 404);

      // ids de módulos asignados al rol
      const assigned = await RoleModule.findAll({
        where: { idRole },
        attributes: ["idModule"],
      });
      const ids = assigned.map((a) => a.idModule);

      let modules = [];
      if (ids.length) {
        // solo módulos activos y asignados
        modules = await Module.findAll({
          where: { idModule: ids, status: 1 },
          attributes: ["idModule", "name", "route"],
          order: [["idModule", "ASC"]],
        });
      }

      return res.json({
        role: role.name,
        modules: modules.map((m) => ({
          idModule: m.idModule,
          name: m.name,
          route: m.route,
        })),
      });
    } catch (err) {
      return next(err);
    }
  },
};
