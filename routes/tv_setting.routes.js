// routes/tv_setting.routes.js
const { Router } = require('express');
const controller = require('../controllers/tv_setting.controller');
const router = Router();

/**
 * @swagger
 * tags:
 *   - name: TvSettings
 *     description: Configuración de TV (marquee, etc.)
 */

/**
 * @swagger
 * /api/tv-settings/marquee:
 *   get:
 *     summary: Obtener texto del marquee
 *     tags: [TvSettings]
 *     responses:
 *       200: { description: OK }
 */
router.get('/tv-settings/marquee', controller.getMarquee);

/**
 * @swagger
 * /api/tv-settings/marquee:
 *   put:
 *     summary: Establecer texto del marquee
 *     tags: [TvSettings]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               value: { type: string }
 *     responses:
 *       200: { description: OK }
 */
router.put('/tv-settings/marquee', controller.setMarquee);

module.exports = router;
