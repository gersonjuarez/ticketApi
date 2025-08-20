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

    // Validaciones mínimas
    if (!fullName || !username || !email || !idRole) {
      return res.status(400).json({ message: 'fullName, username, email e idRole son requeridos.' });
    }
    if (!password || String(password).trim().length < 8) {
      return res.status(400).json({ message: 'password es requerido y debe tener al menos 8 caracteres.' });
    }

    const existsUser = await User.findOne({ where: { username } });
    if (existsUser) return res.status(409).json({ message: 'Usuario ya existe' });

    const existsEmail = await User.findOne({ where: { email } });
    if (existsEmail) return res.status(409).json({ message: 'Email ya está en uso' });

    const cashierRole = await isCashierRole(idRole);

    if (cashierRole) {
      if (!idCashier) {
        return res.status(400).json({ message: 'idCashier es requerido para usuarios con rol Cajero.' });
      }
      const cashier = await Cashier.findByPk(idCashier);
      if (!cashier) {
        return res.status(404).json({ message: 'Ventanilla (idCashier) no encontrada.' });
      }
    } else {
      idCashier = null; // fuerza a null para roles no cajeros
    }

    // Hash de contraseña
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

    // Devuelve sin password
    const plain = created.get({ plain: true });
    delete plain.password;

    res.status(201).json(plain);
  } catch (err) {
    console.error('create user error:', err);
    res.status(500).json({ message: 'Error al crear usuario' });
  }
};

/** PUT /users/:id */
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    let { fullName, username, email, idRole, status, idCashier, password } = req.body;

    const current = await User.findByPk(id);
    if (!current) return res.status(404).json({ message: 'Not found' });

    // Reglas de unicidad (si cambian)
    if (username && username !== current.username) {
      const existsUser = await User.findOne({ where: { username } });
      if (existsUser) return res.status(409).json({ message: 'Usuario ya existe' });
    }
    if (email && email !== current.email) {
      const existsEmail = await User.findOne({ where: { email } });
      if (existsEmail) return res.status(409).json({ message: 'Email ya está en uso' });
    }

    const cashierRole = await isCashierRole(idRole ?? current.idRole);

    if (cashierRole) {
      if (!idCashier) {
        return res.status(400).json({ message: 'idCashier es requerido para usuarios con rol Cajero.' });
      }
      const cashier = await Cashier.findByPk(idCashier);
      if (!cashier) {
        return res.status(404).json({ message: 'Ventanilla (idCashier) no encontrada.' });
      }
    } else {
      idCashier = null; // si cambió de rol a NO cajero
    }

    // Si envían password, hashearla; si no, conservar la actual
    let newPasswordHash = current.password;
    if (typeof password === 'string' && password.trim().length > 0) {
      if (password.trim().length < 8) {
        return res.status(400).json({ message: 'La nueva contraseña debe tener al menos 8 caracteres.' });
      }
      const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);
      newPasswordHash = await bcrypt.hash(password, rounds);
    }

    await User.update(
      {
        fullName: fullName ?? current.fullName,
        username: username ?? current.username,
        email: email ?? current.email,
        idRole: idRole ?? current.idRole,
        status: typeof status === 'boolean' ? status : current.status,
        idCashier,
        password: newPasswordHash,
      },
      { where: { idUser: id } }
    );

    const updated = await User.findByPk(id, {
      attributes: { exclude: ['password'] }, // <-- no exponer hash
      include: [
        { model: Role, attributes: ['idRole', 'name'] },
        { model: Cashier, attributes: ['idCashier', 'name'], required: false },
      ],
    });

    res.json(updated);
  } catch (err) {
    console.error('update user error:', err);
    res.status(500).json({ message: 'Error al actualizar usuario' });
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
