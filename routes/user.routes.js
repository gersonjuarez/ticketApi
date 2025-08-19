// server/routes/user.routes.js
const router = require('express').Router();
const ctrl = require('../controllers/user.controller');

router.get('/users', ctrl.findAll);
router.get('/users/:id', ctrl.findOne);
router.post('/users', ctrl.create);
router.put('/users/:id', ctrl.update);
router.delete('/users/:id', ctrl.remove);

router.get('/roles', ctrl.roles);


module.exports = router;
