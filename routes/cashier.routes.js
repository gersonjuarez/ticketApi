// routes/cashier.routes.js
const { Router } = require('express');
const controller = require('../controllers/cashier.controller'); // ✔ coincide con el archivo
const auth = require('../middlewares/authRequired'); // si quieres proteger, descomenta en cada ruta

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Cashiers
 *     description: Ventanillas
 */

/**
 * @swagger
 * /api/cashiers:
 *   get:
 *     summary: Listar ventanillas
 *     tags: [Cashiers]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 0, default: 0 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 10 }
 *       - in: query
 *         name: q
 *         schema: { type: string, description: "Busca en name/description" }
 *       - in: query
 *         name: status
 *         schema: { type: boolean }
 *       - in: query
 *         name: idService
 *         schema: { type: integer }
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [idCashier, name, description, status, idService, createdAt, updatedAt]
 *           default: idCashier
 *       - in: query
 *         name: sortDir
 *         schema: { type: string, enum: [ASC, DESC], default: ASC }
 *     responses:
 *       200:
 *         description: Lista paginada
 */
router.get('/cashiers', /*auth,*/ controller.findAll);

/**
 * @swagger
 * /api/cashiers/{id}:
 *   get:
 *     summary: Obtener ventanilla por ID
 *     tags: [Cashiers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Not found }
 */
router.get('/cashiers/:id', /*auth,*/ controller.findById);

/**
 * @swagger
 * /api/cashiers:
 *   post:
 *     summary: Crear ventanilla
 *     tags: [Cashiers]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               idService: { type: integer, nullable: true }
 *               status: { type: boolean, default: true }
 *               description: { type: string, nullable: true }
 *               allowTransfersIn: { type: boolean }
 *               allowTransfersOut: { type: boolean }
 *     responses:
 *       201: { description: Creada }
 *       400: { description: Error de validación }
 */
router.post('/cashiers', /*auth,*/ controller.create);

/**
 * @swagger
 * /api/cashiers/{id}:
 *   put:
 *     summary: Actualizar ventanilla
 *     tags: [Cashiers]
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
 *               idService: { type: integer, nullable: true }
 *               status: { type: boolean }
 *               description: { type: string, nullable: true }
 *               allowTransfersIn: { type: boolean }
 *               allowTransfersOut: { type: boolean }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Not found }
 *       400: { description: Error de validación }
 */
router.put('/cashiers/:id', /*auth,*/ controller.update);

/**
 * @swagger
 * /api/cashiers/{id}:
 *   delete:
 *     summary: Eliminar ventanilla
 *     tags: [Cashiers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Eliminada }
 *       404: { description: Not found }
 */
router.delete('/cashiers/:id', /*auth,*/ controller.delete);

/**
 * @swagger
 * /api/cashiers/{id}/assignment:
 *   get:
 *     summary: Usuarios asignados a una ventanilla
 *     tags: [Cashiers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Not found }
 */
router.get('/cashiers/:id/assignment', /*auth,*/ controller.findAssignedUsers);

/**
 * @swagger
 * /api/users/{id}/assign-cashier:
 *   patch:
 *     summary: Asignar ventanilla a usuario
 *     tags: [Cashiers]
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
 *             required: [idCashier, idService]
 *             properties:
 *               idCashier: { type: integer }
 *               idService: { type: integer }
 *     responses:
 *       200: { description: OK }
 *       400: { description: Error de validación / ventanilla inoperativa }
 *       404: { description: No encontrado }
 *       409: { description: CASHIER_TAKEN }
 */
router.patch('/users/:id/assign-cashier', /*auth,*/ controller.assignCashier);

/**
 * @swagger
 * /api/cashiers/{id}/transfer-flags:
 *   patch:
 *     summary: Actualizar banderas de traslado (permitir recibir/enviar)
 *     tags: [Cashiers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               allowTransfersIn:  { type: boolean }
 *               allowTransfersOut: { type: boolean }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Not found }
 */
router.patch('/cashiers/:id/transfer-flags', /*auth,*/ controller.updateTransferFlags);

/* ===== Estado operativo e historial ===== */

/**
 * @swagger
 * /api/cashiers/{id}/status-history:
 *   get:
 *     summary: Historial de estados (pausas/OOS)
 *     tags: [Cashiers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, maximum: 200 }
 *     responses:
 *       200: { description: OK }
 *       404: { description: No encontrado }
 */
router.get('/cashiers/:id/status-history', /*auth,*/ controller.getStatusHistory);

/**
 * @swagger
 * /api/cashiers/{id}/pause:
 *   post:
 *     summary: Poner en pausa (comentario obligatorio)
 *     tags: [Cashiers]
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
 *             required: [comment, performedByUserId]
 *             properties:
 *               comment: { type: string }
 *               performedByUserId: { type: integer }
 *     responses:
 *       201: { description: Creado }
 *       400: { description: Comentario requerido / OOS }
 *       404: { description: No encontrado }
 *       409: { description: Pausa abierta existente }
 */
router.post('/cashiers/:id/pause', /*auth,*/ controller.pause);

/**
 * @swagger
 * /api/cashiers/{id}/out-of-service:
 *   post:
 *     summary: Marcar fuera de servicio (comentario obligatorio)
 *     tags: [Cashiers]
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
 *             required: [comment, performedByUserId]
 *             properties:
 *               comment: { type: string }
 *               performedByUserId: { type: integer }
 *     responses:
 *       201: { description: Creado }
 *       400: { description: Comentario requerido }
 *       404: { description: No encontrado }
 *       409: { description: Ya está OOS }
 */
router.post('/cashiers/:id/out-of-service', /*auth,*/ controller.outOfService);

/**
 * @swagger
 * /api/cashiers/{id}/resume:
 *   post:
 *     summary: Reanudar operación (cierra pausas/OOS abiertos)
 *     tags: [Cashiers]
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
 *             required: [comment, performedByUserId]
 *             properties:
 *               comment: { type: string }
 *               performedByUserId: { type: integer }
 *     responses:
 *       200: { description: OK }
 *       400: { description: Comentario requerido }
 *       404: { description: No encontrado }
 */
router.post('/cashiers/:id/resume', /*auth,*/ controller.resume);

// Compatibilidad con PATCH
router.patch('/cashiers/:id/resume', /*auth,*/ controller.resume);

module.exports = router;
