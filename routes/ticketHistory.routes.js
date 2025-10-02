// routes/ticketHistory.routes.js
const router = require("express").Router();
const controller = require("../controllers/ticketHistory.controller");
const auth = require("../middlewares/authRequired");

/**
 * @swagger
 * tags:
 *   name: TicketHistory
 *   description: Historial de cambios de tickets
 *
 * components:
 *   schemas:
 *     TicketHistoryItem:
 *       type: object
 *       properties:
 *         id: { type: integer, example: 1024 }
 *         idTicket: { type: integer, example: 55 }
 *         fromStatus: { type: integer, example: 1 }
 *         toStatus: { type: integer, example: 2 }
 *         changedByUser: { type: integer, example: 7 }
 *         timestamp: { type: string, format: date-time }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *         TicketRegistration:
 *           type: object
 *           properties:
 *             idTicketRegistration: { type: integer }
 *             turnNumber: { type: integer }
 *             idService: { type: integer }
 *             correlativo: { type: string }
 *             Service:
 *               type: object
 *               properties:
 *                 idService: { type: integer }
 *                 prefix: { type: string }
 *         User:
 *           type: object
 *           properties:
 *             idUser: { type: integer }
 *             username: { type: string }
 *             fullName: { type: string }
 *             email: { type: string }
 *
 *     PagedTicketHistory:
 *       type: object
 *       properties:
 *         items:
 *           type: array
 *           items: { $ref: "#/components/schemas/TicketHistoryItem" }
 *         page: { type: integer, example: 0 }
 *         pageSize: { type: integer, example: 10 }
 *         totalItems: { type: integer, example: 245 }
 *         totalPages: { type: integer, example: 25 }
 *         hasNext: { type: boolean, example: true }
 *         hasPrev: { type: boolean, example: false }
 *         sort:
 *           type: object
 *           properties:
 *             by: { type: string, example: "timestamp" }
 *             dir: { type: string, example: "DESC" }
 *         q: { type: string, example: "ABC-2025-0001" }
 *         filters:
 *           type: object
 *           properties:
 *             userId: { type: integer, nullable: true }
 *             idTicket: { type: integer, nullable: true }
 *             fromStatus: { type: string, nullable: true, example: "1,2" }
 *             toStatus: { type: string, nullable: true, example: "3" }
 *             dateFrom: { type: string, nullable: true, example: "2025-09-01" }
 *             dateTo: { type: string, nullable: true, example: "2025-09-17" }
 *             serviceId: { type: integer, nullable: true }
 */

/**
 * @swagger
 * /api/ticket-history:
 *   get:
 *     summary: Lista historial de cambios de tickets (paginado, filtros y orden)
 *     tags: [TicketHistory]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 0, default: 0 }
 *         description: Página 0-based
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 10 }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [timestamp,idTicket,fromStatus,toStatus,changedByUser], default: timestamp }
 *       - in: query
 *         name: sortDir
 *         schema: { type: string, enum: [ASC, DESC], default: DESC }
 *       - in: query
 *         name: userId
 *         schema: { type: integer }
 *       - in: query
 *         name: idTicket
 *         schema: { type: integer }
 *       - in: query
 *         name: fromStatus
 *         schema: { type: string }
 *         description: CSV de estados de origen (ej. "1,2")
 *       - in: query
 *         name: toStatus
 *         schema: { type: string }
 *         description: CSV de estados destino (ej. "3")
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, pattern: "^\\d{4}-\\d{2}-\\d{2}$" }
 *         description: Fecha inicio (YYYY-MM-DD) inclusiva
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, pattern: "^\\d{4}-\\d{2}-\\d{2}$" }
 *         description: Fecha fin (YYYY-MM-DD) inclusiva
 *       - in: query
 *         name: serviceId
 *         schema: { type: integer }
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Busca por correlativo o turno exacto
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/PagedTicketHistory" }
 */
router.get("/ticket-history", auth, controller.list);

module.exports = router;
