const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const gTTS = require('gtts');

// Carpeta de caché (usa /tmp por compatibilidad con Render)
const CACHE_DIR = process.env.TTS_CACHE_DIR || path.join('/tmp', 'tts-cache');

function safeMkdir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}

function keyFor(text, lang) {
  const h = createHash('sha1').update(`${lang}|${text}`).digest('hex');
  return `${lang}-${h}.mp3`;
}

function synthesizeGtts(text, lang = 'es') {
  return new Promise((resolve, reject) => {
    try {
      const tts = new gTTS(text, lang);
      const chunks = [];
      const stream = tts.stream();

      stream.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', (err) => reject(err));
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Genera/lee MP3 de TTS.
 * @param {{text: string, lang?: string, cache?: boolean}} opts
 * lang: 'es' (genérico), 'es-us' (acento “neutral” US), 'es-es' (España)
 */
async function getTtsMp3({ text, lang = 'es', cache = true }) {
  if (!text || typeof text !== 'string') throw new Error('text requerido');

  safeMkdir(CACHE_DIR);
  const file = path.join(CACHE_DIR, keyFor(text, lang));

  if (cache && fs.existsSync(file)) {
    return fs.promises.readFile(file);
  }

  const buf = await synthesizeGtts(text, lang);
  if (cache) await fs.promises.writeFile(file, buf);
  return buf;
}

module.exports = { getTtsMp3 };
