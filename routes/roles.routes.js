// routes/roles.js
const { Router } = require('express');
const roleCtrl = require('../controllers/role.controller');
const  auth  = require('../middlewares/authRequired');
const router = Router();
// CRUD de roles
router.get('/roles', auth, roleCtrl.list);           // GET    /api/roles
router.get('/roles/:id', auth, roleCtrl.get);         // GET    /api/roles/:id
router.post('/roles', auth, roleCtrl.create);        // POST   /api/roles
router.put('/roles/:id', auth, roleCtrl.update);      // PUT    /api/roles/:id
router.delete('/roles/:id', auth, roleCtrl.remove);   // DELETE /api/roles/:id

// Permisos (módulos) por rol
router.get('/roles/:id/modules', auth, roleCtrl.getModules);    // GET /api/roles/:id/modules
router.put('/roles/:id/modules', auth, roleCtrl.setModules);    // PUT /api/roles/:id/modules

module.exports = router;
