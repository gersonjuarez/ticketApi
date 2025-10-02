// routes/ticket-registration.routes.js
const { Router } = require('express');
const controller = require('../controllers/ticketRegistration.controller'); // usa tu controlador actual

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Tickets
 *     description: Registro, consulta, actualización y traslado de tickets
 */

/**
 * @swagger
 * /api/ticket-registration/live:
 *   get:
 *     summary: Listado “en vivo” por estados (1,2) y/o prefijo
 *     tags:
 *       - Tickets
 *     parameters:
 *       - in: query
 *         name: prefix
 *         schema:
 *           type: string
 *       - in: query
 *         name: statuses
 *         description: Coma-separado (ej. "1,2")
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: OK
 */
router.get('/ticket-registration/live', controller.findAllLive);

/**
 * @swagger
 * /api/ticket-registration:
 *   get:
 *     summary: Listar tickets pendientes (status=1)
 *     tags:
 *       - Tickets
 *     parameters:
 *       - in: query
 *         name: prefix
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: OK
 */
router.get('/ticket-registration', controller.findAll);

/**
 * @swagger
 * /api/ticket-registration/despachados:
 *   get:
 *     summary: Listar tickets en atención (status=2)
 *     tags:
 *       - Tickets
 *     parameters:
 *       - in: query
 *         name: prefix
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: OK
 */
router.get('/ticket-registration/despachados', controller.findAllDispatched);

/**
 * @swagger
 * /api/ticket-registration/cashier:
 *   get:
 *     summary: Tickets para un cajero (cola exclusiva + ticket actual)
 *     tags:
 *       - Tickets
 *     parameters:
 *       - in: query
 *         name: prefix
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: idUser
 *         required: true
 *         schema:
 *           type: integer
 *           format: int32
 *       - in: query
 *         name: idCashier
 *         required: true
 *         schema:
 *           type: integer
 *           format: int32
 *     responses:
 *       '200':
 *         description: OK
 */
router.get('/ticket-registration/cashier', controller.getTicketsForCashier);

/**
 * @swagger
 * /api/ticket-registration/prefix/{prefix}:
 *   get:
 *     summary: Listar tickets pendientes por prefijo (status=1)
 *     tags:
 *       - Tickets
 *     parameters:
 *       - in: path
 *         name: prefix
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: OK
 *       '404':
 *         description: Servicio no encontrado
 */
router.get('/ticket-registration/prefix/:prefix', controller.getTicketsByPrefix);

/**
 * @swagger
 * /api/ticket-registration/{id}:
 *   get:
 *     summary: Obtener detalle de ticket
 *     tags:
 *       - Tickets
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *           format: int32
 *     responses:
 *       '200':
 *         description: OK
 *       '404':
 *         description: Not found
 */
router.get('/ticket-registration/:id', controller.findById);

/**
 * @swagger
 * /api/ticket-registration:
 *   post:
 *     summary: Crear ticket
 *     tags:
 *       - Tickets
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - idService
 *             properties:
 *               name:
 *                 type: string
 *               dpi:
 *                 type: string
 *                 nullable: true
 *                 description: "13 dígitos"
 *               idService:
 *                 type: integer
 *                 format: int32
 *               locationId:
 *                 type: string
 *                 nullable: true
 *                 description: "Para impresión"
 *     responses:
 *       '201':
 *         description: Creado
 *       '400':
 *         description: Error de validación
 *       '404':
 *         description: Servicio no encontrado
 */
router.post('/ticket-registration', controller.create);

/**
 * @swagger
 * /api/ticket-registration/{id}:
 *   put:
 *     summary: Actualizar estado/atributos del ticket
 *     tags:
 *       - Tickets
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *           format: int32
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               idCashier:
 *                 type: integer
 *                 format: int32
 *                 nullable: true
 *               idTicketStatus:
 *                 type: integer
 *                 enum: [1, 2, 3, 4]
 *               observations:
 *                 type: string
 *                 nullable: true
 *               changedByUser:
 *                 type: integer
 *                 format: int32
 *                 description: "Usuario que cambia el estado"
 *     responses:
 *       '200':
 *         description: OK
 *       '400':
 *         description: Error de validación
 *       '404':
 *         description: Not found
 *       '409':
 *         description: Conflicto de atención
 */
router.put('/ticket-registration/:id', controller.update);

/**
 * @swagger
 * /api/ticket-registration/{id}:
 *   delete:
 *     summary: Eliminar ticket
 *     tags:
 *       - Tickets
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *           format: int32
 *     responses:
 *       '200':
 *         description: Eliminado
 *       '404':
 *         description: Not found
 */
router.delete('/ticket-registration/:id', controller.delete);

/**
 * @swagger
 * /api/tickets/status:
 *   get:
 *     summary: Listar tickets por estado (1 ó 2)
 *     tags:
 *       - Tickets
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: integer
 *           enum: [1, 2]
 *           default: 1
 *     responses:
 *       '200':
 *         description: OK
 */
router.get('/tickets/status', controller.getPendingTickets);

/**
 * @swagger
 * /api/ticket-registration/{id}/transfer:
 *   post:
 *     summary: Trasladar ticket a otra ventanilla (cola exclusiva opcional)
 *     tags:
 *       - Tickets
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *           format: int32
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - toCashierId
 *               - performedByUserId
 *             properties:
 *               toCashierId:
 *                 type: integer
 *                 format: int32
 *                 description: "Ventanilla destino"
 *               performedByUserId:
 *                 type: integer
 *                 format: int32
 *                 description: "Usuario que realiza el traslado"
 *               comment:
 *                 type: string
 *                 nullable: true
 *               autoAssignIfFree:
 *                 type: boolean
 *                 default: true
 *                 description: "Si el destino no está ocupado, asignar inmediato"
 *               fromCashierId:
 *                 type: integer
 *                 format: int32
 *                 nullable: true
 *                 description: "Ventanilla origen (opcional, se infiere del ticket)"
 *     responses:
 *       '200':
 *         description: OK
 *       '400':
 *         description: Error de validación
 *       '403':
 *         description: Prohibido por reglas de cola/flags
 *       '404':
 *         description: No encontrado
 *       '409':
 *         description: Conflicto de atención
 */
router.post('/ticket-registration/:id/transfer', controller.transfer);

module.exports = router;
