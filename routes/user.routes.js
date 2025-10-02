// server/routes/user.routes.js
const router = require("express").Router();
const ctrl = require("../controllers/user.controller");
const auth = require("../middlewares/authRequired");

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: Gestión de usuarios
 *
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         idUser: { type: integer, example: 12 }
 *         username: { type: string, example: "jdoe" }
 *         fullName: { type: string, example: "John Doe" }
 *         email: { type: string, example: "jdoe@mail.com" }
 *         status: { type: boolean, example: true }
 *         idRole: { type: integer, example: 3 }
 *         idCashier: { type: integer, nullable: true, example: 5 }
 *         Role:
 *           type: object
 *           properties:
 *             idRole: { type: integer }
 *             name: { type: string }
 *             isCashier: { type: boolean }
 *         Cashier:
 *           type: object
 *           properties:
 *             idCashier: { type: integer }
 *             name: { type: string }
 *
 *     PagedUsers:
 *       type: object
 *       properties:
 *         data:
 *           type: array
 *           items: { $ref: "#/components/schemas/User" }
 *         pagination:
 *           type: object
 *           properties:
 *             page: { type: integer, example: 0 }
 *             pageSize: { type: integer, example: 20 }
 *             total: { type: integer, example: 128 }
 *             totalPages: { type: integer, example: 7 }
 *             sortBy: { type: string, example: "createdAt" }
 *             sortDir: { type: string, example: "DESC" }
 */

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Lista usuarios con paginación y búsqueda
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 0, default: 0 }
 *         description: Página 0-based
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 20 }
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Busca por fullName, username o email
 *       - in: query
 *         name: idRole
 *         schema: { type: integer }
 *       - in: query
 *         name: status
 *         schema:
 *           oneOf:
 *             - type: boolean
 *             - type: integer
 *             - type: string
 *       - in: query
 *         name: orderBy
 *         schema: { type: string, enum: [createdAt,updatedAt,fullName,username,email,idRole,status], default: createdAt }
 *       - in: query
 *         name: orderDir
 *         schema: { type: string, enum: [ASC, DESC], default: DESC }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/PagedUsers" }
 */
router.get("/users", auth, ctrl.findAll);

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Obtiene un usuario por id
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/User" }
 *       404: { description: No encontrado }
 */
router.get("/users/:id", auth, ctrl.findOne);

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Crea un usuario
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, username, email, idRole, password]
 *             properties:
 *               fullName: { type: string, maxLength: 100 }
 *               username: { type: string, maxLength: 30 }
 *               email: { type: string, maxLength: 100 }
 *               idRole: { type: integer }
 *               status:
 *                 oneOf: [{ type: boolean }, { type: integer }, { type: string }]
 *               idCashier: { type: integer, nullable: true }
 *               password: { type: string, minLength: 8 }
 *     responses:
 *       201:
 *         description: Creado
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/User" }
 *       400: { description: Error de validación }
 *       409: { description: Duplicado / ventanilla ocupada }
 */
router.post("/users", auth, ctrl.create);

/**
 * @swagger
 * /api/users/{id}:
 *   put:
 *     summary: Actualiza un usuario
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fullName: { type: string, maxLength: 100 }
 *               username: { type: string, maxLength: 30 }
 *               email: { type: string, maxLength: 100 }
 *               idRole: { type: integer }
 *               status:
 *                 oneOf: [{ type: boolean }, { type: integer }, { type: string }]
 *               idCashier: { type: integer, nullable: true }
 *               password: { type: string, minLength: 8 }
 *     responses:
 *       200:
 *         description: Actualizado
 *         content:
 *           application/json:
 *             schema: { $ref: "#/components/schemas/User" }
 *       400: { description: Error de validación }
 *       404: { description: No encontrado }
 *       409: { description: Duplicado / ventanilla ocupada }
 */
router.put("/users/:id", auth, ctrl.update);

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     summary: Elimina un usuario
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Eliminado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deleted: { type: boolean, example: true }
 *       404: { description: No encontrado }
 */
router.delete("/users/:id", auth, ctrl.remove);

/**
 * @swagger
 * /api/users/{id}/assign-cashier:
 *   patch:
 *     summary: Asigna una ventanilla a un usuario (para login diario)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [idCashier, idService]
 *             properties:
 *               idCashier: { type: integer }
 *               idService: { type: integer }
 *     responses:
 *       200: { description: OK }
 *       400: { description: Error de validación }
 *       404: { description: No encontrado }
 *       409: { description: Ventanilla ocupada }
 */
router.patch("/users/:id/assign-cashier", auth, ctrl.assignCashier);

/**
 * @swagger
 * /api/roles:
 *   get:
 *     summary: Lista de roles (para selects)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   idRole: { type: integer }
 *                   name: { type: string }
 *                   status: { type: boolean }
 *                   isCashier: { type: boolean }
 */
router.get("/roles", auth, ctrl.roles);

module.exports = router;
