// Routes for Cashier
const { Router } = require('express');
const controller = require('../controllers/cashier.controller');

const router = Router();

router.get('/cashiers', controller.findAll);
router.get('/cashiers/:id', controller.findById);
router.post('/cashiers', controller.create);
router.put('/cashiers/:id', controller.update);
router.delete('/cashiers/:id', controller.delete);

module.exports = router;
