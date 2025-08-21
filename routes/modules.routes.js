// routes/modules.js
const { Router } = require('express');
const moduleCtrl = require('../controllers/module.controller');
const  auth  = require('../middlewares/authRequired');
const router = Router();
router.get('/modules', auth, moduleCtrl.list);           // GET    /api/modules
router.post('/modules', auth, moduleCtrl.create);        // POST   /api/modules
router.put('/modules/:id', auth, moduleCtrl.update);      // PUT    /api/modules/:id
router.delete('/modules/:id', auth, moduleCtrl.remove);   // DELETE /api/modules/:id
router.get('/modules/:id', auth, moduleCtrl.get); 

module.exports = router;
