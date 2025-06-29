// Routes for TicketStatus
const { Router } = require('express');
const controller = require('../controllers/ticketStatus.controller');

const router = Router();

router.get('/ticket-status', controller.findAll);
router.get('/ticket-status/:id', controller.findById);
router.post('/ticket-status', controller.create);
router.put('/ticket-status/:id', controller.update);
router.delete('/ticket-status/:id', controller.delete);

module.exports = router;
