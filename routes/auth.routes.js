// routes/auth.js
const router = require('express').Router();
const asyncHandler = require('../utils/asyncHandler');
const loginController = require('../controllers/loginController');

router.post('/register', asyncHandler(loginController.register));
router.post('/login',    asyncHandler(loginController.login));
router.post('/logout',   asyncHandler(loginController.logout));

module.exports = router;
