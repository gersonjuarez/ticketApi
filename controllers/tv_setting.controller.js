// controllers/tv_setting.controller.js
const { TvSetting } = require('../models');
const isDev = process.env.NODE_ENV !== 'production';

const KEY_MARQUEE = 'marqueeText';

/* ---------------- Sockets (helpers mínimos) ---------------- */
const getIo = () => {
  try { return require('../server/socket').getIo?.(); } catch { return null; }
};
const emitMarqueeUpdated = (value) => {
  try {
    const io = getIo();
    if (io) io.to('tv').emit('tv-marquee-updated', { value, at: Date.now() });
  } catch {}
};

/** GET /api/tv-settings/marquee */
exports.getMarquee = async (_req, res) => {
  try {
    const row = await TvSetting.findOne({ where: { key: KEY_MARQUEE } });
    const value = row?.value ?? '';
    res.json({ key: KEY_MARQUEE, value });
  } catch (error) {
    if (isDev) console.error('[tv-setting.getMarquee] error:', error);
    res.status(500).json({ error: error.message || 'SERVER_ERROR' });
  }
};

/** PUT /api/tv-settings/marquee  Body: { value: string } */
exports.setMarquee = async (req, res) => {
  try {
    const value = String(req.body?.value ?? '');
    const [row, created] = await TvSetting.findOrCreate({
      where: { key: KEY_MARQUEE },
      defaults: { value },
    });
    if (!created) {
      await row.update({ value });
    }

    // 🔔 Notificar TVs
    emitMarqueeUpdated(value);

    res.json({ key: KEY_MARQUEE, value });
  } catch (error) {
    if (isDev) console.error('[tv-setting.setMarquee] error:', error);
    res.status(400).json({ error: error.message || 'BAD_REQUEST' });
  }
};
