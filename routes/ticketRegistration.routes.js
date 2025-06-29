// Routes for TicketRegistration
const { Router } = require('express');
const controller = require('../controllers/ticketRegistration.controller');

const router = Router();

router.get('/ticket-registration', controller.findAll);
router.get('/ticket-registration/:id', controller.findById);
router.post('/ticket-registration', controller.create);
router.put('/ticket-registration/:id', controller.update);
router.delete('/ticket-registration/:id', controller.delete);

module.exports = router;
