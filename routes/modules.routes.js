// routes/modules.js
const { Router } = require("express");
const moduleCtrl = require("../controllers/module.controller");
const auth = require("../middlewares/authRequired");
const router = Router();

/**
 * @swagger
 * tags:
 *   name: Modules
 *   description: CRUD de módulos y listado paginado
 *
 * components:
 *   schemas:
 *     Module:
 *       type: object
 *       properties:
 *         idModule: { type: integer, example: 12 }
 *         name: { type: string, example: "Usuarios" }
 *         route: { type: string, example: "/admin/users" }
 *         description: { type: string, nullable: true, example: "Gestión de usuarios" }
 *         status: { type: boolean, example: true }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *
 *     ModuleCreate:
 *       type: object
 *       required: [name, route]
 *       properties:
 *         name: { type: string, maxLength: 50 }
 *         route: { type: string, maxLength: 100 }
 *         description: { type: string, nullable: true }
 *         status: { oneOf: [{ type: boolean }, { type: integer, enum: [0,1] }, { type: string, enum: ["0","1","true","false","si","sí","no"] }] }
 *
 *     ModuleUpdate:
 *       type: object
 *       properties:
 *         name: { type: string, maxLength: 50 }
 *         route: { type: string, maxLength: 100 }
 *         description: { type: string, nullable: true }
 *         status: { oneOf: [{ type: boolean }, { type: integer, enum: [0,1] }, { type: string, enum: ["0","1","true","false","si","sí","no"] }] }
 *
 *     PagedModules:
 *       type: object
 *       properties:
 *         items:
 *           type: array
 *           items: { $ref: "#/components/schemas/Module" }
 *         page: { type: integer, example: 0 }
 *         pageSize: { type: integer, example: 10 }
 *         totalItems: { type: integer, example: 128 }
 *         totalPages: { type: integer, example: 13 }
 *         hasNext: { type: boolean, example: true }
 *         hasPrev: { type: boolean, example: false }
 *         sort:
 *           type: object
 *           properties:
 *             by: { type: string, example: "idModule" }
 *             dir: { type: string, example: "ASC" }
 *         q: { type: string, example: "admin" }
 */

/**
 * @swagger
 * /api/modules:
 *   get:
 *     summary: Lista módulos con paginación, búsqueda y orden
 *     tags: [Modules]
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
 *         description: Busca en name y route
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [idModule,name,route,status,createdAt,updatedAt], default: idModule }
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
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/PagedModules" }
 */
router.get("/modules", auth, moduleCtrl.list);

/**
 * @swagger
 * /api/modules:
 *   post:
 *     summary: Crea un módulo
 *     tags: [Modules]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: "#/components/schemas/ModuleCreate" }
 *     responses:
 *       201:
 *         description: Creado
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/Module" }
 *       400: { description: Error de validación }
 *       409: { description: Duplicado / integridad referencial }
 */
router.post("/modules", auth, moduleCtrl.create);

/**
 * @swagger
 * /api/modules/{id}:
 *   put:
 *     summary: Actualiza un módulo
 *     tags: [Modules]
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
 *           schema: { $ref: "#/components/schemas/ModuleUpdate" }
 *     responses:
 *       200:
 *         description: Actualizado
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/Module" }
 *       400: { description: Error de validación }
 *       404: { description: No encontrado }
 *       409: { description: Duplicado / integridad referencial }
 */
router.put("/modules/:id", auth, moduleCtrl.update);

/**
 * @swagger
 * /api/modules/{id}:
 *   delete:
 *     summary: Elimina un módulo por id
 *     tags: [Modules]
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
 *                 deleted: { type: integer, example: 12 }
 *       404: { description: No encontrado }
 */
router.delete("/modules/:id", auth, moduleCtrl.remove);

/**
 * @swagger
 * /api/modules/{id}:
 *   get:
 *     summary: Obtiene un módulo por id
 *     tags: [Modules]
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
 *             schema: { $ref: "#/components/schemas/Module" }
 *       404: { description: No encontrado }
 */
router.get("/modules/:id", auth, moduleCtrl.get);

module.exports = router;
