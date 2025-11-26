const express = require("express");
const router = express.Router();
const { cancelPendingTickets } = require("../services/autoCancelTickets.service");

/**
 * @swagger
 * /api/tickets/auto-cancel:
 *   post:
 *     summary: Cancelar manualmente todos los tickets pendientes
 *     description: Ejecuta la cancelación automática de tickets pendientes manualmente (para testing)
 *     tags: [Tickets]
 *     responses:
 *       200:
 *         description: Tickets cancelados exitosamente
 *       500:
 *         description: Error al cancelar tickets
 */
router.post("/tickets/auto-cancel", async (req, res) => {
  try {
    const result = await cancelPendingTickets();
    res.json({
      ok: true,
      message: `${result.cancelled} tickets cancelados automáticamente`,
      ...result,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

module.exports = router;
