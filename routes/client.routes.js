// routes/client.routes.js
const { Router } = require('express');
const controller = require('../controllers/client.controller');
const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Clients
 *     description: Clientes
 */

/**
 * @swagger
 * /api/clients:
 *   get:
 *     summary: Listar clientes (paginado)
 *     tags: [Clients]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 0, default: 0 }
 *         description: Página 0-based
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 10 }
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Busca en nombre y DPI (LIKE)
 *       - in: query
 *         name: dpi
 *         schema: { type: string, pattern: "^[0-9]{13}$" }
 *         description: Filtro exacto por DPI
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [idClient, name, dpi, createdAt, updatedAt], default: idClient }
 *       - in: query
 *         name: sortDir
 *         schema: { type: string, enum: [ASC, DESC], default: ASC }
 *     responses:
 *       200:
 *         description: OK
 */
router.get('/clients', controller.findAll);

/**
 * @swagger
 * /api/clients/{id}:
 *   get:
 *     summary: Obtener cliente por ID
 *     tags: [Clients]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Not found }
 */
router.get('/clients/:id', controller.findById);

/**
 * @swagger
 * /api/clients:
 *   post:
 *     summary: Crear cliente
 *     tags: [Clients]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               dpi:  { type: string, pattern: "^[0-9]{13}$", nullable: true }
 *             additionalProperties: true
 *     responses:
 *       201: { description: Creado }
 *       400: { description: Error de validación }
 *       409: { description: DPI_TAKEN }
 */
router.post('/clients', controller.create);

/**
 * @swagger
 * /api/clients/{id}:
 *   put:
 *     summary: Actualizar cliente
 *     tags: [Clients]
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
 *               dpi:  { type: string, pattern: "^[0-9]{13}$", nullable: true }
 *             additionalProperties: true
 *     responses:
 *       200: { description: OK }
 *       400: { description: Error de validación }
 *       404: { description: Not found }
 *       409: { description: DPI_TAKEN }
 */
router.put('/clients/:id', controller.update);

/**
 * @swagger
 * /api/clients/{id}:
 *   delete:
 *     summary: Eliminar cliente
 *     tags: [Clients]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Eliminado }
 *       404: { description: Not found }
 */
router.delete('/clients/:id', controller.delete);

/**
 * @swagger
 * /api/clients/by-dpi/{dpi}:
 *   get:
 *     summary: Buscar cliente por DPI exacto (13 dígitos)
 *     tags: [Clients]
 *     parameters:
 *       - in: path
 *         name: dpi
 *         required: true
 *         schema: { type: string, pattern: "^[0-9]{13}$" }
 *     responses:
 *       200: { description: OK }
 *       400: { description: DPI inválido }
 */
router.get('/clients/by-dpi/:dpi', controller.findByDpi);

module.exports = router;
