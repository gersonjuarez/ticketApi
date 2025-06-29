// Routes for Service
const { Router } = require('express');
const controller = require('../controllers/service.controller');

const router = Router();

router.get('/services', controller.findAll);
router.get('/services/:id', controller.findById);
router.post('/services', controller.create);
router.put('/services/:id', controller.update);
router.delete('/services/:id', controller.delete);

module.exports = router;
