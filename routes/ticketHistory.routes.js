// routes/ticketHistory.routes.js
const router = require('express').Router();
const controller = require('../controllers/ticketHistory.controller');

// GET /api/ticket-history
router.get('/ticket-history', controller.list);

module.exports = router;
