// routes/auth.js
const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const loginController = require('../controllers/loginController');
const router = Router();

router.post('/register', asyncHandler(loginController.register));
router.post('/login',    asyncHandler(loginController.login));
router.post('/logout',   asyncHandler(loginController.logout));


module.exports = router;
