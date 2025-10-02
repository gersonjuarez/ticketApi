// routes/auth.js
const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const loginController = require('../controllers/loginController');
const authController = require('../controllers/auth.controller');
// const { verifyToken } = require('../middlewares/authJwt'); // activa si lo usas

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Auth
 *     description: Autenticación y permisos
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Registrar usuario
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, username, email, password]
 *             properties:
 *               fullName: { type: string }
 *               username: { type: string }
 *               email:    { type: string, format: email }
 *               password: { type: string, minLength: 8 }
 *     responses:
 *       201: { description: Usuario registrado }
 *       400: { description: Datos inválidos }
 *       409: { description: Conflicto (email/usuario) }
 */
router.post('/register', asyncHandler(loginController.register));

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Iniciar sesión
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username: { type: string }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Sesión iniciada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string, description: "JWT" }
 *       401: { description: Credenciales inválidas }
 */
router.post('/login', asyncHandler(loginController.login));

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Cerrar sesión
 *     tags: [Auth]
 *     responses:
 *       200: { description: Sesión cerrada }
 */
router.post('/logout', asyncHandler(loginController.logout));



module.exports = router;
