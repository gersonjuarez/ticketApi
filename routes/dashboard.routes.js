// routes/dashboard.routes.js
const { Router } = require('express');
const ctrl = require('../controllers/dashboard.controller');
// const { verifyToken } = require('../middlewares/authJwt'); // si lo quieres privado

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Dashboard
 *     description: Métricas y agregados para el panel
 */

/**
 * @swagger
 * /api/dashboard/tickets/attended-today:
 *   get:
 *     summary: Tickets atendidos (hoy)
 *     tags: [Dashboard]
 *     responses:
 *       200:
 *         description: Conteo de tickets atendidos hoy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count: { type: integer, example: 7 }
 *       500: { description: Error del servidor }
 */
router.get('/tickets/attended-today', ctrl.getTicketsAttendedToday);

/**
 * @swagger
 * /api/dashboard/tickets/by-month:
 *   get:
 *     summary: Tickets por mes
 *     tags: [Dashboard]
 *     parameters:
 *       - in: query
 *         name: months
 *         schema: { type: integer, minimum: 1, maximum: 24, default: 12 }
 *       - in: query
 *         name: onlyAttended
 *         schema: { type: boolean, default: false }
 *     responses:
 *       200:
 *         description: Serie mensual
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   month: { type: string, example: "ago. 2025" }
 *                   count: { type: integer, example: 42 }
 *       500: { description: Error del servidor }
 */
router.get('/tickets/by-month', ctrl.getTicketsByMonth);

/**
 * @swagger
 * /api/dashboard/tickets/by-status:
 *   get:
 *     summary: Tickets por estado
 *     tags: [Dashboard]
 *     responses:
 *       200:
 *         description: Conteo agrupado por estado
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   idTicketStatus: { type: integer, example: 2 }
 *                   name: { type: string, example: "Atendido" }
 *                   count: { type: integer, example: 18 }
 *       500: { description: Error del servidor }
 */
router.get('/tickets/by-status', ctrl.getTicketsByStatus);

/**
 * @swagger
 * /api/dashboard/tickets/client/count:
 *   get:
 *     summary: Cantidad de clientes activos
 *     tags: [Dashboard]
 *     responses:
 *       200:
 *         description: Conteo de clientes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count: { type: integer, example: 120 }
 *       500: { description: Error del servidor }
 */
router.get('/tickets/client/count', ctrl.getClientsCount);

module.exports = router;
