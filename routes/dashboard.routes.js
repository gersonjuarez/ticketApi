// routes/dashboard.routes.js
const { Router } = require('express');
const ctrl = require('../controllers/dashboard.controller');
// const { verifyToken } = require('../middlewares/authJwt'); // si proteges el dashboard

const router = Router();

// Si tu dashboard es privado, antepone verifyToken
router.get('/tickets/attended-today', ctrl.getTicketsAttendedToday);
router.get('/tickets/by-month', ctrl.getTicketsByMonth);
router.get('/tickets/client/count', ctrl.getClientsCount);
router.get('/tickets/by-status', ctrl.getTicketsByStatus);

module.exports = router;