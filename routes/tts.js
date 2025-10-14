// server/routes/tts.js
const express = require('express');
const router = express.Router();
const { getTtsMp3 } = require('../tts/gtts');

// Arma el texto tanto para GET (query) como POST (body)
function pickSource(req) {
  return req.method === 'GET' ? (req.query || {}) : (req.body || {});
}

function buildTextAndLang(src) {
  const {
    text,
    numero,        // "ATC-1"
    ventanilla,    // "Ventanilla 2"
    modulo,        // "2" (si no viene ventanilla)
    moduleName,    // "Atención al cliente"
    prefix,        // "ATC"
    lang
  } = src;

  let finalText = (typeof text === 'string' && text.trim()) ? text.trim() : '';

  // Normalizaciones
  const numeroSpoken = (numero ? String(numero) : '').replace(/-/g, ' ').trim();
  const windowLabel =
    (ventanilla && String(ventanilla).trim()) ||
    (modulo != null && modulo !== '' ? `Ventanilla ${modulo}` : '');
  const moduleSpoken =
    (moduleName && String(moduleName).trim()) ||
    (prefix && String(prefix).trim()) || '';

  if (!finalText) {
    const parts = [];
    if (numeroSpoken) parts.push(`Turno ${numeroSpoken}.`);
    if (windowLabel) parts.push(`Pase a ${windowLabel}.`);
    if (moduleSpoken) parts.push(`Módulo ${moduleSpoken}.`);
    finalText = parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  const langCode = (typeof lang === 'string' && lang.trim()) ? lang.trim() : 'es';
  return { finalText, langCode };
}

async function ttsHandler(req, res) {
  try {
    const src = pickSource(req);
    const { finalText, langCode } = buildTextAndLang(src);

    if (!finalText) {
      return res.status(400).json({ error: 'text o numero requerido' });
    }

    const mp3 = await getTtsMp3({ text: finalText, lang: langCode, cache: true });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(mp3);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[api/tts] error:', msg);
    res.status(500).json({ error: 'tts-failed', detail: msg });
  }
}

// Endpoints soportados
router.post('/', ttsHandler);       // POST /api/tts
router.get('/', ttsHandler);        // GET  /api/tts  (útil para TVs viejas que hacen GET)
router.post('/voice', ttsHandler);  // POST /api/tts/voice (alias para clientes legacy)

module.exports = router;
