// controllers/client.controller.js
const { Op } = require('sequelize');
const { Client } = require('../models');

const isDev = process.env.NODE_ENV !== 'production';

/* ---------------- Helpers ---------------- */
const parseId = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Id inválido');
  return n;
};
const parsePage = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : 0; // 0-based
};
const parsePageSize = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 10;
};
const parseSort = (by, dir) => {
  const allowed = new Set(['idClient', 'name', 'dpi', 'createdAt', 'updatedAt']);
  const sortBy = allowed.has(String(by)) ? String(by) : 'idClient';
  const sortDir = String(dir || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  return [sortBy, sortDir];
};
const isValidDpi = (v) => /^\d{13}$/.test(String(v || '').trim());

/* ---------------- List paginado ---------------- */
/**
 * GET /api/clients
 * Query:
 *  - page (0-based), pageSize, q (busca en name/dpi), dpi (exacto 13 dígitos),
 *  - sortBy (idClient|name|dpi|createdAt|updatedAt), sortDir (ASC|DESC)
 */
exports.findAll = async (req, res) => {
  try {
    const page = parsePage(req.query.page);
    const pageSize = parsePageSize(req.query.pageSize);
    const q = (req.query.q || '').toString().trim();
    const [sortBy, sortDir] = parseSort(req.query.sortBy, req.query.sortDir);

    const where = {};
    if (q) {
      const term = `%${q}%`;
      where[Op.or] = [{ name: { [Op.like]: term } }, { dpi: { [Op.like]: term } }];
    }
    if (req.query.dpi && isValidDpi(req.query.dpi)) {
      where.dpi = String(req.query.dpi).trim();
    }

    const { rows, count } = await Client.findAndCountAll({
      where,
      limit: pageSize,
      offset: page * pageSize,
      order: [[sortBy, sortDir]],
    });

    return res.json({
      items: rows,
      page,
      pageSize,
      totalItems: count,
      totalPages: Math.ceil(count / pageSize),
      hasNext: (page + 1) * pageSize < count,
      hasPrev: page > 0,
      sort: { by: sortBy, dir: sortDir },
      q,
    });
  } catch (error) {
    if (isDev) {
      console.error('[clients.findAll] error:', {
        name: error?.name,
        message: error?.message,
        stack: error?.stack,
      });
    }
    res.status(500).json({ error: error.message || 'SERVER_ERROR' });
  }
};

/* ---------------- Obtener por ID ---------------- */
exports.findById = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const client = await Client.findByPk(id);
    if (!client) return res.status(404).json({ error: 'Not found' });
    res.json(client);
  } catch (error) {
    if (isDev) {
      console.error('[clients.findById] error:', error);
    }
    res.status(500).json({ error: error.message || 'SERVER_ERROR' });
  }
};

/* ---------------- Crear ---------------- */
exports.create = async (req, res) => {
  try {
    const { name, dpi, ...rest } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'El nombre es obligatorio' });
    }
    if (dpi !== undefined && dpi !== null) {
      if (!isValidDpi(dpi)) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'DPI inválido (13 dígitos)' });
      }
      // Chequeo de unicidad si aplica
      const exists = await Client.findOne({ where: { dpi: String(dpi).trim() } });
      if (exists) {
        return res.status(409).json({ error: 'DPI_TAKEN', message: 'El DPI ya está registrado' });
      }
    }

    const created = await Client.create({
      name: String(name).trim(),
      dpi: dpi ? String(dpi).trim() : null,
      ...rest,
    });

    res.status(201).json(created);
  } catch (error) {
    if (isDev) {
      console.error('[clients.create] error:', error);
    }
    res.status(400).json({ error: error.message || 'BAD_REQUEST' });
  }
};

/* ---------------- Actualizar ---------------- */
exports.update = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const current = await Client.findByPk(id);
    if (!current) return res.status(404).json({ error: 'Not found' });

    const { name, dpi, ...rest } = req.body || {};

    // Validaciones
    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'El nombre no puede estar vacío' });
    }
    if (dpi !== undefined && dpi !== null) {
      if (!isValidDpi(dpi)) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'DPI inválido (13 dígitos)' });
      }
      if (String(dpi).trim() !== (current.dpi || '')) {
        const exists = await Client.findOne({ where: { dpi: String(dpi).trim() } });
        if (exists) {
          return res.status(409).json({ error: 'DPI_TAKEN', message: 'El DPI ya está registrado' });
        }
      }
    }

    const patch = {
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(dpi !== undefined ? { dpi: dpi ? String(dpi).trim() : null } : {}),
      ...rest,
    };

    await current.update(patch);
    const updated = await Client.findByPk(id);
    res.json(updated);
  } catch (error) {
    if (isDev) {
      console.error('[clients.update] error:', error);
    }
    res.status(400).json({ error: error.message || 'BAD_REQUEST' });
  }
};

/* ---------------- Eliminar ---------------- */
exports.delete = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    const deleted = await Client.destroy({ where: { idClient: id } });
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (error) {
    if (isDev) {
      console.error('[clients.delete] error:', error);
    }
    res.status(500).json({ error: error.message || 'SERVER_ERROR' });
  }
};

/* ---------------- Buscar por DPI ---------------- */
exports.findByDpi = async (req, res) => {
  try {
    const { dpi } = req.params;
    if (!isValidDpi(dpi)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'DPI inválido (13 dígitos)' });
    }
    const client = await Client.findOne({ where: { dpi: String(dpi).trim() } });
    if (!client) return res.json(null);
    return res.json({
      idClient: client.idClient,
      name: client.name,
      dpi: client.dpi || null,
    });
  } catch (error) {
    if (isDev) {
      console.error('[clients.findByDpi] error:', error);
    }
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
};
