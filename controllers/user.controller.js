// server/controllers/user.controller.js
const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const { User, Role, Cashier, Service, sequelize } = require('../models');

/** Determina si un idRole corresponde a un rol "Cajero" (por nombre) */
const isCashierRole = async (idRole) => {
  if (!idRole) return false;
  const role = await Role.findByPk(idRole, { attributes: ['idRole', 'name'] });
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
      attributes: { exclude: ['password'] }, // no exponer hash
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
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Error al obtener usuarios' });
  }
};

/** GET /users/:id (sin password) */
exports.findOne = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findByPk(id, {
      attributes: { exclude: ['password'] }, // no exponer hash
      include: [
        { model: Role, attributes: ['idRole', 'name'] },
        { model: Cashier, attributes: ['idCashier', 'name'], required: false },
      ],
    });
    if (!user) return res.status(404).json({ error: 'NOT_FOUND', message: 'Usuario no encontrado' });
    res.json(user);
  } catch (err) {
    console.error('findOne user error:', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Error al obtener usuario' });
  }
};

/** POST /users */
exports.create = async (req, res) => {
  try {
    let { fullName, username, email, idRole, status, idCashier, password } = req.body;

    if (!fullName || !username || !email || !idRole) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'fullName, username, email e idRole son requeridos.',
      });
    }
    if (!password || String(password).trim().length < 8) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'password es requerido y debe tener al menos 8 caracteres.',
      });
    }

    const existsUser = await User.findOne({ where: { username } });
    if (existsUser) {
      return res.status(409).json({ error: 'USERNAME_TAKEN', message: 'Usuario ya existe' });
    }
    const existsEmail = await User.findOne({ where: { email } });
    if (existsEmail) {
      return res.status(409).json({ error: 'EMAIL_TAKEN', message: 'Email ya está en uso' });
    }

    const cashierRole = await isCashierRole(idRole);

    if (cashierRole) {


      // ¿ya está ocupada?
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
      // si no es cajero, no debe llevar ventanilla
      idCashier = null;
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

    return res.status(201).json(plain);
  } catch (err) {
    console.error('create user error:', err);
    if (err?.name === 'SequelizeUniqueConstraintError') {
      return res
        .status(409)
        .json({ error: 'CASHIER_TAKEN', message: 'La ventanilla ya está asignada a otro usuario' });
    }
    return res.status(500).json({ error: 'SERVER_ERROR', message: 'Error al crear usuario' });
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

    // Validar unicidad si cambian username/email
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
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'idCashier es requerido para usuarios con rol Cajero.',
        });
      }
      const cashier = await Cashier.findByPk(idCashier);
      if (!cashier) {
        return res.status(404).json({
          error: 'NOT_FOUND',
          message: 'Ventanilla (idCashier) no encontrada.',
        });
      }

      // ¿Ventanilla ocupada por otro usuario?
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
      // si ya no es cajero, forzar null
      idCashier = null;
    }

    // Construir patch; password opcional
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
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'La nueva contraseña debe tener al menos 8 caracteres.',
        });
      }
      const rounds = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);
      patch.password = await bcrypt.hash(password, rounds);
    }

    await current.update(patch);

    const updated = await User.findByPk(id, {
      attributes: { exclude: ['password'] }, // no exponer hash
      include: [
        { model: Role, attributes: ['idRole', 'name'] },
        { model: Cashier, attributes: ['idCashier', 'name'], required: false },
      ],
    });

    return res.json(updated);
  } catch (err) {
    console.error('update user error:', err);
    if (err?.name === 'SequelizeUniqueConstraintError') {
      return res
        .status(409)
        .json({ error: 'CASHIER_TAKEN', message: 'La ventanilla ya está asignada a otro usuario' });
    }
    return res.status(500).json({ error: 'SERVER_ERROR', message: 'Error al actualizar usuario' });
  }
};

/** PATCH /users/:id/assign-cashier */
exports.assignCashier = async (req, res) => {
  const { id } = req.params; // id del usuario
  const { idCashier, idService } = req.body;

  if (!idCashier || !idService) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'idCashier e idService son requeridos',
    });
  }

  const t = await sequelize.transaction();
  try {
    // 1) Usuario
    const user = await User.findByPk(id, { transaction: t });
    if (!user) {
      await t.rollback();
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Usuario no encontrado' });
    }
    if (user.status === false) {
      await t.rollback();
      return res.status(400).json({ error: 'USER_INACTIVE', message: 'Usuario inactivo' });
    }

    // 2) Ventanilla + su servicio
    const cashier = await Cashier.findByPk(idCashier, {
      include: [{ model: Service, attributes: ['idService', 'name', 'prefix'] }],
      transaction: t,
    });
    if (!cashier) {
      await t.rollback();
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Ventanilla no encontrada' });
    }
    if (cashier.status === false) {
      await t.rollback();
      return res.status(400).json({ error: 'CASHIER_INACTIVE', message: 'Ventanilla inactiva' });
    }
    if (Number(cashier.idService) !== Number(idService)) {
      await t.rollback();
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'La ventanilla no pertenece al servicio seleccionado',
      });
    }

    // 3) ¿ocupada por otro usuario?
    const occupied = await User.findOne({
      where: { idCashier: cashier.idCashier, idUser: { [Op.ne]: user.idUser } },
      transaction: t,
      attributes: ['idUser', 'fullName', 'username'],
    });
    if (occupied) {
      await t.rollback();
      return res.status(409).json({
        error: 'CASHIER_TAKEN',
        message: `La ventanilla ya está asignada a ${occupied.fullName || occupied.username}`,
      });
    }

    // 4) Actualiza asignación
    await user.update({ idCashier: cashier.idCashier }, { transaction: t });

    await t.commit();
    return res.json({
      ok: true,
      user: {
        idUser: user.idUser,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        idRole: user.idRole,
        idCashier: user.idCashier,
        status: user.status,
      },
      cashier: {
        idCashier: cashier.idCashier,
        name: cashier.name,
      },
      service: cashier.Service
        ? {
            idService: cashier.Service.idService,
            name: cashier.Service.name,
            prefix: cashier.Service.prefix,
          }
        : null,
    });
  } catch (error) {
    if (t.finished !== 'commit') await t.rollback();
    console.error('assignCashier error:', error);
    if (error?.name === 'SequelizeUniqueConstraintError') {
      return res
        .status(409)
        .json({ error: 'CASHIER_TAKEN', message: 'La ventanilla ya está asignada a otro usuario' });
    }
    return res.status(500).json({ error: 'SERVER_ERROR', message: 'No se pudo asignar la ventanilla' });
  }
};

/** DELETE /users/:id */
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await User.destroy({ where: { idUser: id } });
    if (!deleted) return res.status(404).json({ error: 'NOT_FOUND', message: 'Usuario no encontrado' });

    res.json({ deleted: true });
  } catch (err) {
    console.error('remove user error:', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Error al eliminar usuario' });
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
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Error al obtener roles' });
  }
};
