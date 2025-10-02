// routes/roles.js
const { Router } = require("express");
const roleCtrl = require("../controllers/role.controller");
const auth = require("../middlewares/authRequired");
const router = Router();

/**
 * @swagger
 * tags:
 *   name: Roles
 *   description: Gestión de roles y permisos (módulos)
 *
 * components:
 *   schemas:
 *     Role:
 *       type: object
 *       properties:
 *         idRole: { type: integer, example: 3 }
 *         name: { type: string, example: "Administrador" }
 *         status: { type: boolean, example: true }
 *         isCashier: { type: boolean, example: false }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *
 *     RoleCreate:
 *       type: object
 *       required: [name]
 *       properties:
 *         name: { type: string, maxLength: 20 }
 *         status:
 *           oneOf:
 *             - type: boolean
 *             - type: integer
 *             - type: string
 *           example: true
 *         isCashier:
 *           oneOf:
 *             - type: boolean
 *             - type: integer
 *             - type: string
 *           example: false
 *
 *     RoleUpdate:
 *       type: object
 *       properties:
 *         name: { type: string, maxLength: 20 }
 *         status:
 *           oneOf:
 *             - type: boolean
 *             - type: integer
 *             - type: string
 *         isCashier:
 *           oneOf:
 *             - type: boolean
 *             - type: integer
 *             - type: string
 *
 *     PagedRoles:
 *       type: object
 *       properties:
 *         items:
 *           type: array
 *           items: { $ref: "#/components/schemas/Role" }
 *         page: { type: integer, example: 0 }
 *         pageSize: { type: integer, example: 10 }
 *         totalItems: { type: integer, example: 128 }
 *         totalPages: { type: integer, example: 13 }
 *         hasNext: { type: boolean, example: true }
 *         hasPrev: { type: boolean, example: false }
 *         sort:
 *           type: object
 *           properties:
 *             by: { type: string, example: "idRole" }
 *             dir: { type: string, example: "ASC" }
 *         q: { type: string, example: "adm" }
 */

/**
 * @swagger
 * /api/roles:
 *   get:
 *     summary: Lista roles con paginación, búsqueda y orden
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 0, default: 0 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 10 }
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Busca por nombre del rol
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [idRole,name,status,isCashier,createdAt,updatedAt], default: idRole }
 *       - in: query
 *         name: sortDir
 *         schema: { type: string, enum: [ASC, DESC], default: ASC }
 *       - in: query
 *         name: status
 *         schema:
 *           oneOf:
 *             - type: boolean
 *             - type: integer
 *             - type: string
 *           example: true
 *       - in: query
 *         name: isCashier
 *         schema:
 *           oneOf:
 *             - type: boolean
 *             - type: integer
 *             - type: string
 *           example: false
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/PagedRoles" }
 */
router.get("/roles", auth, roleCtrl.list);

/**
 * @swagger
 * /api/roles/{id}:
 *   get:
 *     summary: Obtiene un rol por id
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/Role" }
 *       404: { description: No encontrado }
 */
router.get("/roles/:id", auth, roleCtrl.get);

/**
 * @swagger
 * /api/roles:
 *   post:
 *     summary: Crea un rol
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/RoleCreate" }
 *     responses:
 *       201:
 *         description: Creado
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/Role" }
 *       400: { description: Error de validación }
 *       409: { description: Duplicado / integridad referencial }
 */
router.post("/roles", auth, roleCtrl.create);

/**
 * @swagger
 * /api/roles/{id}:
 *   put:
 *     summary: Actualiza un rol
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/RoleUpdate" }
 *     responses:
 *       200:
 *         description: Actualizado
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/Role" }
 *       400: { description: Error de validación }
 *       404: { description: No encontrado }
 *       409: { description: Duplicado / integridad referencial }
 */
router.put("/roles/:id", auth, roleCtrl.update);

/**
 * @swagger
 * /api/roles/{id}:
 *   delete:
 *     summary: Elimina un rol por id (si no está en uso)
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Eliminado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean, example: true }
 *                 deleted: { type: integer, example: 7 }
 *       400: { description: Rol en uso }
 *       404: { description: No encontrado }
 */
router.delete("/roles/:id", auth, roleCtrl.remove);

/**
 * @swagger
 * /api/roles/{id}/modules:
 *   get:
 *     summary: Lista módulos disponibles y si están asignados al rol
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   idModule: { type: integer }
 *                   name: { type: string }
 *                   route: { type: string }
 *                   status: { type: boolean }
 *                   selected: { type: boolean }
 *       404: { description: Rol no encontrado }
 */
router.get("/roles/:id/modules", auth, roleCtrl.getModules);

/**
 * @swagger
 * /api/roles/{id}/modules:
 *   put:
 *     summary: Reemplaza los módulos asignados a un rol
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               modules:
 *                 type: array
 *                 items: { type: integer }
 *             example:
 *               modules: [1, 2, 5]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok: { type: boolean, example: true }
 *                 assigned:
 *                   type: array
 *                   items: { type: integer }
 *       400: { description: Petición inválida }
 *       404: { description: Rol no encontrado }
 */
router.put("/roles/:id/modules", auth, roleCtrl.setModules);

module.exports = router;
