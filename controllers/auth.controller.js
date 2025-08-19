// controllers/auth.controller.js
const db = require("../models");
const { ApiError } = require("../middlewares/errorHandler");
const { Role, Module } = db;

module.exports = {
  myPermissions: async (req, res, next) => {
    try {
      // usar 'role' que setea el middleware
      if (req.user?.role == null) throw new ApiError("Usuario no autenticado", 401);

      // normaliza a número si viene como string
      const idRole = Number(req.user.role);
      if (!Number.isInteger(idRole) || idRole <= 0) throw new ApiError("Rol inválido", 400);

      const role = await Role.findByPk(idRole, {
        include: [{ model: Module, through: { attributes: [] } }],
      });
      if (!role) throw new ApiError("Rol no encontrado", 404);

      const modules = role.Modules.map(m => ({
        idModule: m.idModule,
        name: m.name,
        route: m.route,
      }));

      return res.json({ role: role.name, modules });
    } catch (err) {
      return next(err);
    }
  },
};
