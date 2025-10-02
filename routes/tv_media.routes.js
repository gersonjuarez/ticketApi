// routes/tv_media.routes.js
const { Router } = require('express');
const controller = require('../controllers/tv_media.controller');
const router = Router();

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ====== Configurable por ENV ======
const MAX_MB = Number(process.env.TV_UPLOAD_MAX_MB || 500); // default 500 MB

// ====== Carpeta de uploads ======
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ====== Multer ======
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const safe = (file.originalname || 'file').replace(/[^\w.\-]+/g, '_');
    cb(null, `${ts}_${safe}`);
  }
});

const fileFilter = (_req, file, cb) => {
  const ok = /^(image\/|video\/|application\/pdf|application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation)/i.test(file.mimetype);
  if (!ok) return cb(new Error('Tipo no soportado. Sube imagen, video, PDF o PPTX.'));
  cb(null, true);
};

const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter,
});

// ====== Rutas ======

// Listado paginado
router.get('/tv-media', controller.findAll);

// Playlist activa (sin YouTube)
router.get('/tv-media/playlist', controller.findActivePlaylist);

// Obtener por ID
router.get('/tv-media/:id', controller.findById);

// Crear por JSON (sin subir)
router.post('/tv-media', controller.create);

// Subir archivo y crear item — envuelve el middleware para capturar errores de Multer
const uploadSingle = upload.single('file');
router.post('/tv-media/upload', (req, res, next) => {
  uploadSingle(req, res, (err) => {
    if (err) {
      // Errores propios de Multer
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            error: 'FILE_TOO_LARGE',
            message: `El archivo supera el límite permitido de ${MAX_MB} MB.`,
            maxMB: MAX_MB,
          });
        }
        return res.status(400).json({
          error: 'UPLOAD_REJECTED',
          code: err.code,
          message: err.message || 'Subida rechazada por el servidor.',
        });
      }

      // Errores no-Multer (fileFilter u otros)
      return res.status(400).json({
        error: 'UPLOAD_FAILED',
        message: err?.message || 'Error subiendo el archivo.',
      });
    }

    // Sin errores -> pasa al controller
    controller.upload(req, res, next);
  });
});

// Actualizar
router.put('/tv-media/:id', controller.update);

// Eliminar
router.delete('/tv-media/:id', controller.delete);

// Activar/Desactivar
router.patch('/tv-media/:id/activate', controller.activate);

// Reordenar
router.patch('/tv-media/reorder', controller.reorder);

module.exports = router;
