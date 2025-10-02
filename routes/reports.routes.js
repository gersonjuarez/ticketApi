// routes/reports.routes.js
const router = require('express').Router();
const overviewCtrl = require('../controllers/cashierPauseOverview.controller');
const ReportsController = require('../controllers/reportsController');

// Dashboard consolidado de pausas:
// /reports/cashier-pauses/overview?from=2025-09-18&to=2025-09-22&statusType=PAUSE&limitTopUsers=5&limitLongest=10
router.get('/cashier-pauses/overview', overviewCtrl.getOverview);

// Reporte de tiempos de atención
// /reports/attention-times?from=2025-09-18&to=2025-09-22&serviceId=1&cashierId=2
router.get('/attention-times', ReportsController.getAttentionTimes);
// NUEVO: Detalle por ticket
router.get('/ticket-times', ReportsController.getTicketTimes);
module.exports = router;
