// routes/services.routes.js
const { Router } = require("express");
const controller = require("../controllers/service.controller");

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Services
 *     description: Gestión de servicios
 */

/**
 * @swagger
 * /api/services:
 *   get:
 *     summary: Listar servicios (paginado)
 *     tags: [Services]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 0, default: 0 }
 *         description: Página (0-based)
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 10 }
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Busca por name/prefix/description
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [true,false,1,0,"true","false","1","0","si","sí","no"] }
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [idService,name,prefix,value,status,createdAt,updatedAt]
 *           default: idService
 *       - in: query
 *         name: sortDir
 *         schema: { type: string, enum: [ASC, DESC], default: ASC }
 *     responses:
 *       200:
 *         description: Paginado de servicios
 */
router.get("/services", controller.findAll);

/**
 * @swagger
 * /api/services/{id}:
 *   get:
 *     summary: Obtener servicio por ID
 *     tags: [Services]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Servicio no encontrado }
 */
router.get("/services/:id", controller.findById);

/**
 * @swagger
 * /api/services:
 *   post:
 *     summary: Crear servicio
 *     tags: [Services]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               prefix: { type: string, nullable: true }
 *               value: { type: number }
 *               status: { type: boolean, default: true }
 *               description: { type: string, nullable: true }
 *     responses:
 *       201: { description: Creado }
 *       400: { description: Error de validación }
 */
router.post("/services", controller.create);

/**
 * @swagger
 * /api/services/{id}:
 *   put:
 *     summary: Actualizar servicio
 *     tags: [Services]
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
 *               name: { type: string }
 *               prefix: { type: string, nullable: true }
 *               value: { type: number }
 *               status: { type: boolean }
 *               description: { type: string, nullable: true }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Servicio no encontrado }
 *       400: { description: Error de validación }
 */
router.put("/services/:id", controller.update);

/**
 * @swagger
 * /api/services/{id}:
 *   delete:
 *     summary: Eliminar servicio
 *     tags: [Services]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Eliminado }
 *       404: { description: Servicio no encontrado }
 */
router.delete("/services/:id", controller.delete);

module.exports = router;
