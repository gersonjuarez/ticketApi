
const { Router } = require('express');
const authCtrl = require('../controllers/auth.controller');
const authRequired = require('../middlewares/authRequired');
const router = Router();

router.get('/permissions', authRequired, authCtrl.myPermissions);


module.exports = router;
