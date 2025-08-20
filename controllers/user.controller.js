// server/controllers/user.controller.js
const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');
 // <-- añadir
const { User, Role, Cashier } = require('../models');

/** Determina si un idRole corresponde a un rol "Cajero" (por nombre) */
const isCashierRole = async (idRole) => {
  if (!idRole) return false;
  const role = await Role.findByPk(idRole);
  return !!role && /cajero/i.test(role.name || '');
};

/** Normaliza query string a entero con default */
const toInt = (v, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};

/** GET /users - listado con búsqueda/paginación/filtros (sin password) */
exports.findAll = async (req, res) => {
  try {
    const {
      q,
      page = 1,
      pageSize = 20,
      idRole,
      status,
      orderBy = 'createdAt',
      orderDir = 'DESC',
    } = req.query;

    const where = {};

    if (q && q.trim()) {
      const term = `%${q.trim()}%`;
      where[Op.or] = [
        { fullName: { [Op.like]: term } },
        { username: { [Op.like]: term } },
        { email: { [Op.like]: term } },
      ];
    }

    if (idRole) {
      where.idRole = toInt(idRole, 0) || 0;
    }

    if (typeof status !== 'undefined') {
      if (String(status) === 'true') where.status = true;
      else if (String(status) === 'false') where.status = false;
    }

    const limit = Math.max(1, toInt(pageSize, 20));
    const pageN = Math.max(1, toInt(page, 1));
    const offset = (pageN - 1) * limit;

    const validCols = new Set([
      'createdAt',
      'updatedAt',
      'fullName',
      'username',
      'email',
      'idRole',
      'status',
    ]);
    const orderColumn = validCols.has(orderBy) ? orderBy : 'createdAt';
    const orderDirection = /^(ASC|DESC)$/i.test(orderDir) ? orderDir.toUpperCase() : 'DESC';

    const { rows, count } = await User.findAndCountAll({
      where,
      attributes: { exclude: ['password'] }, // <-- no exponer hash
      include: [
        { model: Role, attributes: ['idRole', 'name'] },
        { model: Cashier, attributes: ['idCashier', 'name'], required: false },
      ],
      order: [[orderColumn, orderDirection]],
      limit,
      offset,
    });

    res.json({
      data: rows,
      pagination: {
        page: pageN,
        pageSize: limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (err) {
    console.error('findAll users error:', err);
    res.status(500).json({ message: 'Error al obtener usuarios' });
  }
};

/** GET /users/:id (sin password) */
exports.findOne = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findByPk(id, {
      attributes: { exclude: ['password'] }, // <-- no exponer hash
      include: [
        { model: Role, attributes: ['idRole', 'name'] },
        { model: Cashier, attributes: ['idCashier', 'name'], required: false },
      ],
    });
    if (!user) return res.status(404).json({ message: 'Not found' });
    res.json(user);
  } catch (err) {
    console.error('findOne user error:', err);
    res.status(500).json({ message: 'Error al obtener usuario' });
  }
};

/** POST /users */
exports.create = async (req, res) => {
  try {
    let { fullName, username, email, idRole, status, idCashier, password } = req.body;

    if (!fullName || !username || !email || !idRole) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'fullName, username, email e idRole son requeridos.' });
    }
    if (!password || String(password).trim().length < 8) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'password es requerido y debe tener al menos 8 caracteres.' });
    }

    const existsUser = await User.findOne({ where: { username } });
    if (existsUser) return res.status(409).json({ error: 'USERNAME_TAKEN', message: 'Usuario ya existe' });

    const existsEmail = await User.findOne({ where: { email } });
    if (existsEmail) return res.status(409).json({ error: 'EMAIL_TAKEN', message: 'Email ya está en uso' });

    const cashierRole = await isCashierRole(idRole);

    if (cashierRole) {
      if (!idCashier) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'idCashier es requerido para usuarios con rol Cajero.' });
      }
      const cashier = await Cashier.findByPk(idCashier);
      if (!cashier) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Ventanilla (idCashier) no encontrada.' });
      }

      // 👇 VALIDACIÓN CLAVE: ¿ya está ocupada?
      const occupied = await User.findOne({
        where: { idCashier: cashier.idCashier },
        attributes: ['idUser', 'fullName', 'username'],
      });
      if (occupied) {
        return res.status(409).json({
          error: 'CASHIER_TAKEN',
          message: `La ventanilla ya está asignada a ${occupied.fullName || occupied.username}`,
        });
      }
    } else {
      idCashier = null; // fuerza null si no es rol cajero
    }

    const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);
    const hash = await bcrypt.hash(password, rounds);

    const created = await User.create({
      fullName,
      username,
      email,
      idRole,
      status: !!status,
      idCashier,
      password: hash,
    });

    const plain = created.get({ plain: true });
    delete plain.password;

    res.status(201).json(plain);
  } catch (err) {
    console.error('create user error:', err);
    // Si tienes índice único en DB, aquí puedes mapearlo:
    if (err?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'CASHIER_TAKEN', message: 'La ventanilla ya está asignada a otro usuario' });
    }
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Error al crear usuario' });
  }
};

/** PUT /users/:id */
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    let { fullName, username, email, idRole, status, idCashier, password } = req.body;

    const current = await User.findByPk(id);
    if (!current) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Usuario no encontrado' });
    }

    // Unicidad si cambian username / email
    if (username && username !== current.username) {
      const existsUser = await User.findOne({ where: { username } });
      if (existsUser) {
        return res.status(409).json({ error: 'USERNAME_TAKEN', message: 'Usuario ya existe' });
      }
    }
    if (email && email !== current.email) {
      const existsEmail = await User.findOne({ where: { email } });
      if (existsEmail) {
        return res.status(409).json({ error: 'EMAIL_TAKEN', message: 'Email ya está en uso' });
      }
    }

    // ¿Sigue/será rol "Cajero"?
    const cashierRole = await isCashierRole(idRole ?? current.idRole);

    if (cashierRole) {
      if (!idCashier) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'idCashier es requerido para usuarios con rol Cajero.' });
      }
      const cashier = await Cashier.findByPk(idCashier);
      if (!cashier) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Ventanilla (idCashier) no encontrada.' });
      }

      // 🚫 ¿Ventanilla ocupada por OTRO usuario?
      const occupied = await User.findOne({
        where: {
          idCashier: cashier.idCashier,
          idUser: { [Op.ne]: current.idUser },
        },
        attributes: ['idUser', 'fullName', 'username'],
      });
      if (occupied) {
        return res.status(409).json({
          error: 'CASHIER_TAKEN',
          message: `La ventanilla ya está asignada a ${occupied.fullName || occupied.username}`,
        });
      }
    } else {
      // Si ya no es cajero, forza a null
      idCashier = null;
    }

    // Password opcional (si viene, validar y hashear)
    const patch = {
      fullName: fullName ?? current.fullName,
      username: username ?? current.username,
      email: email ?? current.email,
      idRole: idRole ?? current.idRole,
      status: typeof status === 'boolean' ? status : current.status,
      idCashier,
    };

    if (typeof password === 'string' && password.trim().length > 0) {
      if (password.trim().length < 8) {
        return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'La nueva contraseña debe tener al menos 8 caracteres.' });
      }
      const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);
      patch.password = await bcrypt.hash(password, rounds);
    }

    await current.update(patch);

    const updated = await User.findByPk(id, {
      attributes: { exclude: ['password'] },
      include: [
        { model: Role, attributes: ['idRole', 'name'] },
        { model: Cashier, attributes: ['idCashier', 'name'], required: false },
      ],
    });

    return res.json(updated);
  } catch (err) {
    console.error('update user error:', err);
    // Si además tienes índice único en DB sobre users(idCashier), mapea el choque:
    if (err?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'CASHIER_TAKEN', message: 'La ventanilla ya está asignada a otro usuario' });
    }
    return res.status(500).json({ error: 'SERVER_ERROR', message: 'Error al actualizar usuario' });
  }
};

/** DELETE /users/:id */
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await User.destroy({ where: { idUser: id } });
    if (!deleted) return res.status(404).json({ message: 'Not found' });

    res.json({ deleted: true });
  } catch (err) {
    console.error('remove user error:', err);
    res.status(500).json({ message: 'Error al eliminar usuario' });
  }
};

/** GET /roles - listado simple de roles (para selects en UI) */
exports.roles = async (req, res) => {
  try {
    const roles = await Role.findAll({
      attributes: ['idRole', 'name', 'status'],
      order: [['name', 'ASC']],
    });
    res.json(roles);
  } catch (err) {
    console.error('roles error:', err);
    res.status(500).json({ message: 'Error al obtener roles' });
  }
};
