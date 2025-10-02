const { Router } = require('express');
const controller = require('../controllers/ticketStatus.controller');
// Si quieres proteger con auth: const auth = require('../middlewares/authRequired');

const router = Router();

/**
 * @swagger
 * tags:
 *   name: TicketStatus
 *   description: CRUD de estados de ticket
 */

/**
 * @swagger
 * /api/ticket-status:
 *   get:
 *     summary: Listar estados (paginado)
 *     tags: [TicketStatus]
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
 *         description: Buscar por nombre
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [idTicketStatus, name, status, createdAt, updatedAt], default: idTicketStatus }
 *       - in: query
 *         name: sortDir
 *         schema: { type: string, enum: [ASC, DESC], default: ASC }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: ["true","false","1","0"] }
 *         description: Filtrar por activo/inactivo
 *     responses:
 *       200:
 *         description: OK
 */
router.get('/ticket-status', controller.findAll);

/**
 * @swagger
 * /api/ticket-status/{id}:
 *   get:
 *     summary: Obtener estado por id
 *     tags: [TicketStatus]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Estado no encontrado }
 */
router.get('/ticket-status/:id', controller.findById);

/**
 * @swagger
 * /api/ticket-status:
 *   post:
 *     summary: Crear estado
 *     tags: [TicketStatus]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: "Pendiente" }
 *               status: { oneOf: [{type: boolean},{type: integer},{type: string}], example: true }
 *     responses:
 *       201: { description: Creado }
 *       400: { description: Error de validación }
 */
router.post('/ticket-status', controller.create);

/**
 * @swagger
 * /api/ticket-status/{id}:
 *   put:
 *     summary: Actualizar estado
 *     tags: [TicketStatus]
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
 *               status: { oneOf: [{type: boolean},{type: integer},{type: string}] }
 *     responses:
 *       200: { description: OK }
 *       400: { description: Error de validación }
 *       404: { description: Estado no encontrado }
 */
router.put('/ticket-status/:id', controller.update);

/**
 * @swagger
 * /api/ticket-status/{id}:
 *   delete:
 *     summary: Eliminar estado
 *     tags: [TicketStatus]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Estado no encontrado }
 */
router.delete('/ticket-status/:id', controller.delete);

module.exports = router;
