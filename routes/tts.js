// server/routes/tts.js
const express = require('express');
const router = express.Router();
const { getTtsMp3 } = require('../tts/gtts');

/**
 * POST /api/tts
 * body:
 *  - text?: string     // texto ya armado (opcional)
 *  - numero?: string   // ej: "ATC-1"
 *  - modulo?: string   // ej: "2"
 *  - lang?: string     // 'es', 'es-us', 'es-es'
 */
router.post('/', async (req, res) => {
  try {
    const { text, numero, modulo, lang } = req.body || {};

    // Si no viene "text", lo armamos con numero/modulo
    let finalText = (typeof text === 'string' && text.trim()) ? text.trim() : undefined;
    if (!finalText && typeof numero === 'string') {
      finalText = `Ticket ${numero} a ventanilla ${typeof modulo === 'string' ? modulo : '—'}`;
    }
    if (!finalText) {
      return res.status(400).json({ error: 'text o numero requerido' });
    }

    const langCode = (typeof lang === 'string' && lang.trim()) ? lang.trim() : 'es';

    const mp3 = await getTtsMp3({ text: finalText, lang: langCode, cache: true });
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(mp3);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[api/tts] error:', msg);
    res.status(500).json({ error: 'tts-failed', detail: msg });
  }
});

module.exports = router;
