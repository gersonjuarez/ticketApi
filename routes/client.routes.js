// Routes for Client
const { Router } = require('express');
const controller = require('../controllers/client.controller');

const router = Router();

router.get('/clients', controller.findAll);
router.get('/clients/:id', controller.findById);
router.post('/clients', controller.create);
router.put('/clients/:id', controller.update);
router.delete('/clients/:id', controller.delete);

module.exports = router;
