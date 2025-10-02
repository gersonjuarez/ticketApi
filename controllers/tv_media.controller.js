// controllers/tv_media.controller.js
const path = require('path');
const { Op } = require('sequelize');
const { TvMedia } = require('../models');

// ⚠️ SIN YOUTUBE
const ALLOWED_TYPES = ['image', 'video', 'presentation'];
const isDev = process.env.NODE_ENV !== 'production';

/* ---------------- Sockets (helpers mínimos) ---------------- */
const getIo = () => {
  try { return require('../server/socket').getIo?.(); } catch { return null; }
};
const emitPlaylistDirty = () => {
  try {
    const io = getIo();
    if (io) io.to('tv').emit('tv-playlist-dirty', { at: Date.now() });
  } catch {}
};

/* ---------------- Helpers ---------------- */
const parseId = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Id inválido');
  return n;
};
const parsePage = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : 0;
};
const parsePageSize = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 10;
};
const parseSort = (by, dir) => {
  const allowed = new Set(['idMedia', 'title', 'orderIndex', 'createdAt', 'updatedAt']);
  const sortBy = allowed.has(String(by)) ? String(by) : 'orderIndex';
  const sortDir = String(dir || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  return [sortBy, sortDir];
};

const nowUtc = () => new Date();

// Embed sólo para presentaciones (PDF/PPTX) — NADA DE YT
const buildPresentationEmbed = (url) => {
  const lower = String(url || '').toLowerCase();
  if (lower.endsWith('.pdf')) {
    return `https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(url)}`;
  }
  if (lower.endsWith('.pptx')) {
    return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
  }
  // Si ya es un embed (Google Slides publish to web), lo dejamos tal cual:
  return url || null;
};

/* ---------------- List paginado ---------------- */
exports.findAll = async (req, res) => {
  try {
    const page = parsePage(req.query.page);
    const pageSize = parsePageSize(req.query.pageSize);
    const q = (req.query.q || '').toString().trim();
    const type = (req.query.type || '').toString().trim().toLowerCase();
    const active = req.query.active;
    const [sortBy, sortDir] = parseSort(req.query.sortBy, req.query.sortDir);

    const where = {};
    if (q) {
      const term = `%${q}%`;
      where[Op.or] = [{ title: { [Op.like]: term } }, { description: { [Op.like]: term } }];
    }
    if (type && ALLOWED_TYPES.includes(type)) where.type = type;
    if (active === 'true') where.isActive = true;
    if (active === 'false') where.isActive = false;

    // Jamás devolvemos youtube aunque esté en DB
    where.type = where.type
      ? where.type
      : { [Op.in]: ALLOWED_TYPES };

    const { rows, count } = await TvMedia.findAndCountAll({
      where,
      limit: pageSize,
      offset: page * pageSize,
      order: [[sortBy, sortDir], ['idMedia', 'ASC']],
    });

    return res.json({
      items: rows,
      page,
      pageSize,
      totalItems: count,
      totalPages: Math.ceil(count / pageSize),
      sort: { by: sortBy, dir: sortDir },
      filters: { q, type: where.type || null, active: active ?? null },
    });
  } catch (error) {
    if (isDev) console.error('[tv-media.findAll] error:', error);
    res.status(500).json({ error: error.message || 'SERVER_ERROR' });
  }
};

/* ---------------- Playlist activa ---------------- */
exports.findActivePlaylist = async (req, res) => {
  try {
    const now = nowUtc();

    let items = await TvMedia.findAll({
      where: {
        isActive: true,
        type: { [Op.in]: ALLOWED_TYPES }, // <- sin youtube
        [Op.and]: [
          { [Op.or]: [{ startAt: null }, { startAt: { [Op.lte]: now } }] },
          { [Op.or]: [{ endAt: null }, { endAt: { [Op.gte]: now } }] },
        ],
      },
      order: [['orderIndex', 'ASC'], ['idMedia', 'ASC']],
    });

    const payload = items.map((m) => {
      const json = m.toJSON();
      if (json.type === 'presentation') {
        json.embedUrl = buildPresentationEmbed(json.url);
      } else {
        json.embedUrl = null;
      }
      return json;
    });

    return res.json(payload);
  } catch (error) {
    if (isDev) console.error('[tv-media.findActivePlaylist] error:', error);
    res.status(500).json({ error: error.message || 'SERVER_ERROR' });
  }
};

/* ---------------- Obtener por ID ---------------- */
exports.findById = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const media = await TvMedia.findByPk(id);
    if (!media) return res.status(404).json({ error: 'Not found' });

    const json = media.toJSON();
    if (json.type === 'presentation') {
      json.embedUrl = buildPresentationEmbed(json.url);
    } else {
      json.embedUrl = null;
    }
    res.json(json);
  } catch (error) {
    if (isDev) console.error('[tv-media.findById] error:', error);
    res.status(500).json({ error: error.message || 'SERVER_ERROR' });
  }
};

/* ---------------- Crear por JSON (sin subir archivo) ---------------- */
exports.create = async (req, res) => {
  try {
    const body = req.body || {};
    const type = String(body.type || '').toLowerCase();

    if (!ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: `type inválido (${ALLOWED_TYPES.join(', ')})` });
    }
    if (!body.url || !String(body.url).trim()) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'url es obligatoria' });
    }

    const created = await TvMedia.create({
      type,
      title: body.title ? String(body.title).trim() : null,
      description: body.description ? String(body.description).trim() : null,
      url: String(body.url).trim(),
      thumbUrl: body.thumbUrl ? String(body.thumbUrl).trim() : null,
      durationSec: Number.isInteger(body.durationSec) ? Math.min(Math.max(body.durationSec, 3), 600) : (type === 'image' ? 10 : 30),
      isActive: body.isActive === false ? false : true,
      orderIndex: Number.isInteger(body.orderIndex) ? body.orderIndex : 0,
      startAt: body.startAt ? new Date(body.startAt) : null,
      endAt: body.endAt ? new Date(body.endAt) : null,
    });

    // 🔔 Notificar TVs
    emitPlaylistDirty();

    res.status(201).json(created);
  } catch (error) {
    if (isDev) console.error('[tv-media.create] error:', error);
    res.status(400).json({ error: error.message || 'BAD_REQUEST' });
  }
};

/* ---------------- Actualizar ---------------- */
exports.update = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const current = await TvMedia.findByPk(id);
    if (!current) return res.status(404).json({ error: 'Not found' });

    const body = req.body || {};
    const patch = {};

    if (body.type !== undefined) {
      const t = String(body.type || '').toLowerCase();
      if (!ALLOWED_TYPES.includes(t)) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: `type inválido (${ALLOWED_TYPES.join(', ')})` });
      }
      patch.type = t;
    }
    if (body.url !== undefined) {
      if (!body.url || !String(body.url).trim()) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'url no puede estar vacía' });
      }
      patch.url = String(body.url).trim();
    }

    if (body.title !== undefined) patch.title = body.title ? String(body.title).trim() : null;
    if (body.description !== undefined) patch.description = body.description ? String(body.description).trim() : null;
    if (body.thumbUrl !== undefined) patch.thumbUrl = body.thumbUrl ? String(body.thumbUrl).trim() : null;
    if (body.durationSec !== undefined) {
      const n = Number(body.durationSec);
      if (!Number.isInteger(n) || n < 3 || n > 600) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'durationSec debe estar entre 3 y 600' });
      }
      patch.durationSec = n;
    }
    if (body.isActive !== undefined) patch.isActive = !!body.isActive;
    if (body.orderIndex !== undefined) {
      const oi = Number(body.orderIndex);
      if (!Number.isInteger(oi)) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'orderIndex inválido' });
      patch.orderIndex = oi;
    }
    if (body.startAt !== undefined) patch.startAt = body.startAt ? new Date(body.startAt) : null;
    if (body.endAt !== undefined) patch.endAt = body.endAt ? new Date(body.endAt) : null;

    await current.update(patch);
    // 🔔 Notificar TVs
    emitPlaylistDirty();

    const updated = await TvMedia.findByPk(id);
    res.json(updated);
  } catch (error) {
    if (isDev) console.error('[tv-media.update] error:', error);
    res.status(400).json({ error: error.message || 'BAD_REQUEST' });
  }
};

/* ---------------- Eliminar ---------------- */
exports.delete = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const deleted = await TvMedia.destroy({ where: { idMedia: id } });
    if (!deleted) return res.status(404).json({ error: 'Not found' });

    // 🔔 Notificar TVs
    emitPlaylistDirty();

    res.json({ deleted: true });
  } catch (error) {
    if (isDev) console.error('[tv-media.delete] error:', error);
    res.status(500).json({ error: error.message || 'SERVER_ERROR' });
  }
};

/* ---------------- Activar/Desactivar ---------------- */
exports.activate = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const current = await TvMedia.findByPk(id);
    if (!current) return res.status(404).json({ error: 'Not found' });

    const isActive = req.body?.isActive !== false;
    await current.update({ isActive });

    // 🔔 Notificar TVs
    emitPlaylistDirty();

    res.json({ idMedia: id, isActive });
  } catch (error) {
    if (isDev) console.error('[tv-media.activate] error:', error);
    res.status(400).json({ error: error.message || 'BAD_REQUEST' });
  }
};

/* ---------------- Reordenar ---------------- */
exports.reorder = async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'ids vacío' });

  const tx = await TvMedia.sequelize.transaction();
  try {
    let idx = 0;
    for (const rawId of ids) {
      const id = parseId(rawId);
      await TvMedia.update({ orderIndex: idx++ }, { where: { idMedia: id }, transaction: tx });
    }
    await tx.commit();

    // 🔔 Notificar TVs
    emitPlaylistDirty();

    res.json({ ok: true, reordered: ids.length });
  } catch (error) {
    await tx.rollback();
    if (isDev) console.error('[tv-media.reorder] error:', error);
    res.status(400).json({ error: error.message || 'BAD_REQUEST' });
  }
};

/* ---------------- Subir archivo (imagen/video/pdf/pptx) ---------------- */
exports.upload = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta file' });

    // Detectar tipo
    let type = 'image';
    if (/^video\//i.test(req.file.mimetype)) type = 'video';
    if (/^application\/pdf$/i.test(req.file.mimetype) || /presentation/i.test(req.file.mimetype)) {
      type = 'presentation';
    }
    if (!ALLOWED_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Tipo no soportado' });
    }

    const origin = `${req.protocol}://${req.get('host')}`;
    const url = `${origin}/uploads/${req.file.filename}`;

    const durationSec = Number.isInteger(+req.body?.durationSec)
      ? Math.min(Math.max(+req.body.durationSec, 3), 600)
      : (type === 'image' ? 10 : 30);

    const row = await TvMedia.create({
      type,
      url,
      title: req.body?.title?.trim() || null,
      description: req.body?.description?.trim() || null,
      thumbUrl: req.body?.thumbUrl?.trim() || null,
      durationSec,
      isActive: req.body?.isActive === 'false' ? false : true,
      orderIndex: Number.isInteger(+req.body?.orderIndex) ? +req.body.orderIndex : 0,
      startAt: req.body?.startAt ? new Date(req.body.startAt) : null,
      endAt: req.body?.endAt ? new Date(req.body.endAt) : null,
    });

    // 🔔 Notificar TVs
    emitPlaylistDirty();

    const json = row.toJSON();
    if (json.type === 'presentation') {
      json.embedUrl = buildPresentationEmbed(json.url);
    } else {
      json.embedUrl = null;
    }

    res.json(json);
  } catch (error) {
    if (isDev) console.error('[tv-media.upload] error:', error);
    res.status(500).json({ error: error.message || 'UPLOAD_FAILED' });
  }
};
