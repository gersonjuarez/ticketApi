// controllers/cashier.controller.js
// CRUD + estado operativo + historial con paginación, logs y errores centralizados

const { Op } = require('sequelize');
const db = require('../models');
const { ApiError } = require('../middlewares/errorHandler');

const {
  Cashier,
  User,
  Service,
  CashierStatusLog, // historial de estado
  sequelize,
} = db;

/* =========================
 * Helpers
 * ========================= */
const parseId = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError('Id inválido', 400);
  return n;
};

const parseBool = (v, dflt = undefined) => {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1') return true;
  if (v === 0 || v === '0') return false;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === 'sí' || s === 'si') return true;
    if (s === 'false' || s === 'no') return false;
  }
  return dflt;
};

const parsePage = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : 0; // 0-based
};
const parsePageSize = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 10;
};
const parseSort = (sortBy, sortDir) => {
  const allowed = new Set([
    'idCashier',
    'name',
    'description',
    'status',
    'idService',
    'createdAt',
    'updatedAt',
  ]);
  const by = allowed.has(String(sortBy)) ? String(sortBy) : 'idCashier';
  const dir = String(sortDir || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  return [by, dir];
};

/* =========================
 * CRUD + Lista paginada
 * ========================= */

// GET /api/cashiers  (paginado + filtro + orden)
exports.findAll = async (req, res, next) => {
  try {
    const page = parsePage(req.query.page);
    const pageSize = parsePageSize(req.query.pageSize);
    const q = (req.query.q || '').toString().trim();
    const [sortBy, sortDir] = parseSort(req.query.sortBy, req.query.sortDir);

    const where = {};
    if (q) {
      where[Op.or] = [
        { name: { [Op.like]: `%${q}%` } },
        { description: { [Op.like]: `%${q}%` } },
      ];
    }
    if (req.query.status !== undefined) {
      const s = parseBool(req.query.status, null);
      if (s !== null) where.status = s;
    }
    if (req.query.idService !== undefined) {
      const n = Number(req.query.idService);
      if (Number.isInteger(n) && n > 0) where.idService = n;
    }

    const { rows, count } = await Cashier.findAndCountAll({
      where,
      limit: pageSize,
      offset: page * pageSize,
      order: [[sortBy, sortDir]],
    });

    req.log?.info(
      { route: 'GET /cashiers', page, pageSize, sortBy, sortDir, q, count },
      'cashiers:list'
    );

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
    req.log?.error({ err: error }, 'cashiers:list:error');
    return next(error);
  }
};

// GET /api/cashiers/:id
exports.findById = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const cashier = await Cashier.findByPk(id);
    if (!cashier) throw new ApiError('Ventanilla no encontrada', 404);
    res.json(cashier);
  } catch (error) {
    req.log?.warn({ err: error, id: req.params.id }, 'cashiers:get:error');
    return next(error);
  }
};

// POST /api/cashiers
exports.create = async (req, res, next) => {
  try {
    const {
      name,
      idService,
      status,
      description,
      allowTransfersIn,
      allowTransfersOut,
    } = req.body;

    if (!name || !String(name).trim()) {
      throw new ApiError('El nombre es obligatorio', 400);
    }

    const created = await Cashier.create({
      name: String(name).trim(),
      idService: idService ?? null,
      status: parseBool(status, true),
      description: description ?? null,
      ...(allowTransfersIn !== undefined ? { allowTransfersIn: !!allowTransfersIn } : {}),
      ...(allowTransfersOut !== undefined ? { allowTransfersOut: !!allowTransfersOut } : {}),
    });

    req.log?.info({ idCashier: created.idCashier }, 'cashiers:create:ok');
    res.status(201).json(created);
  } catch (error) {
    req.log?.error({ err: error, body: req.body }, 'cashiers:create:error');
    return next(error);
  }
};

// PUT /api/cashiers/:id
exports.update = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const {
      name,
      idService,
      status,
      description,
      allowTransfersIn,
      allowTransfersOut,
    } = req.body;

    const fields = {};
    if (name !== undefined) fields.name = String(name).trim() || undefined;
    if (idService !== undefined) fields.idService = idService;
    if (status !== undefined) fields.status = parseBool(status, undefined);
    if (description !== undefined) fields.description = description ?? null;
    if (allowTransfersIn !== undefined) fields.allowTransfersIn = !!allowTransfersIn;
    if (allowTransfersOut !== undefined) fields.allowTransfersOut = !!allowTransfersOut;

    const [updated] = await Cashier.update(fields, { where: { idCashier: id } });
    if (!updated) throw new ApiError('Ventanilla no encontrada', 404);

    const updatedCashier = await Cashier.findByPk(id);
    req.log?.info({ idCashier: id }, 'cashiers:update:ok');
    res.json(updatedCashier);
  } catch (error) {
    req.log?.error({ err: error, id: req.params.id }, 'cashiers:update:error');
    return next(error);
  }
};

// DELETE /api/cashiers/:id
exports.delete = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const deleted = await Cashier.destroy({ where: { idCashier: id } });
    if (!deleted) throw new ApiError('Ventanilla no encontrada', 404);
    req.log?.info({ idCashier: id }, 'cashiers:delete:ok');
    res.json({ deleted: true });
  } catch (error) {
    req.log?.error({ err: error, id: req.params.id }, 'cashiers:delete:error');
    return next(error);
  }
};

/* =========================
 * Extras del módulo
 * ========================= */

// PATCH /cashiers/:id/transfer-flags  { allowTransfersIn?, allowTransfersOut? }
exports.updateTransferFlags = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const fields = {};
    if (req.body.allowTransfersIn !== undefined)
      fields.allowTransfersIn = !!req.body.allowTransfersIn;
    if (req.body.allowTransfersOut !== undefined)
      fields.allowTransfersOut = !!req.body.allowTransfersOut;

    const [u] = await Cashier.update(fields, { where: { idCashier: id } });
    if (!u) throw new ApiError('Ventanilla no encontrada', 404);
    const cashier = await Cashier.findByPk(id);

    req.log?.info({ idCashier: id, fields }, 'cashiers:transfer-flags:ok');
    res.json(cashier);
  } catch (e) {
    req.log?.error({ err: e, id: req.params.id }, 'cashiers:transfer-flags:error');
    return next(e);
  }
};

// GET /cashiers/:id/assignment  → lista usuarios asignados a la ventanilla
exports.findAssignedUsers = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const cashier = await Cashier.findByPk(id);
    if (!cashier) throw new ApiError('Ventanilla no encontrada', 404);

    const users = await User.findAll({
      where: { idCashier: id },
      attributes: [
        'idUser',
        'fullName',
        'username',
        'email',
        'status',
        'idRole',
        'idCashier',
      ],
      order: [['fullName', 'ASC']],
    });

    res.json({ cashier, users });
  } catch (error) {
    req.log?.error({ err: error, id: req.params.id }, 'cashiers:assignment:error');
    return next(error);
  }
};

/* ==================================================
 * Asignación de ventanilla a usuario (con flags)
 * ================================================== */

// PATCH /users/:id/assign-cashier { idCashier, idService }
exports.assignCashier = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { id } = req.params; // id del usuario
    const { idCashier, idService } = req.body;

    if (!idCashier || !idService) {
      throw new ApiError('idCashier e idService son requeridos', 400);
    }

    // 1) Usuario
    const user = await User.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!user) {
      await t.rollback();
      throw new ApiError('Usuario no encontrado', 404);
    }
    if (user.status === false) {
      await t.rollback();
      throw new ApiError('Usuario inactivo', 400);
    }

    // 2) Ventanilla + su servicio
    const cashier = await Cashier.findByPk(idCashier, {
      include: [{ model: Service, attributes: ['idService', 'name', 'prefix'] }],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!cashier) {
      await t.rollback();
      throw new ApiError('Ventanilla no encontrada', 404);
    }
    if (cashier.status === false) {
      await t.rollback();
      throw new ApiError('Ventanilla inactiva', 400);
    }
    if (Number(cashier.idService) !== Number(idService)) {
      await t.rollback();
      throw new ApiError('La ventanilla no pertenece al servicio seleccionado', 400);
    }

    // bloquear asignación si está en pausa o fuera de servicio
    if (cashier.isOutOfService) {
      await t.rollback();
      throw new ApiError('La ventanilla está fuera de servicio', 400);
    }
    if (cashier.isPaused) {
      await t.rollback();
      throw new ApiError('La ventanilla está en pausa', 400);
    }

    // 3) ¿ya está ocupada por otro usuario?
    const alreadyTaken = await User.findOne({
      where: {
        idCashier: cashier.idCashier,
        idUser: { [Op.ne]: Number(id) },
      },
      attributes: ['idUser', 'username', 'fullName'],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (alreadyTaken) {
      await t.rollback();
      throw new ApiError(
        `La ventanilla ya está asignada a ${alreadyTaken.fullName || alreadyTaken.username}`,
        409
      );
    }

    // 4) Actualiza asignación
    await user.update({ idCashier: cashier.idCashier }, { transaction: t });

    await t.commit();
    req.log?.info({ userId: user.idUser, cashierId: cashier.idCashier }, 'cashiers:assign:ok');
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
    req.log?.error({ err: error, body: req.body, params: req.params }, 'cashiers:assign:error');
    return next(error);
  }
};

/* ==========================================
 * Historial y control de estado
 * ========================================== */

// GET /cashiers/:id/status-history?limit=50
exports.getStatusHistory = async (req, res, next) => {
  try {
    const idCashier = parseId(req.params.id);
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const cashier = await Cashier.findByPk(idCashier, {
      attributes: ['idCashier', 'name', 'isPaused', 'isOutOfService', 'lastStateComment', 'lastStateAt'],
    });
    if (!cashier) throw new ApiError('Ventanilla no encontrada', 404);

    const logs = await CashierStatusLog.findAll({
      where: { idCashier },
      include: [
        { model: db.User, as: 'performedBy', attributes: ['idUser', 'username', 'fullName'] },
        { model: db.User, as: 'closedBy', attributes: ['idUser', 'username', 'fullName'] },
      ],
      order: [['startedAt', 'DESC']],
      limit,
    });

    res.json({ cashier, logs });
  } catch (error) {
    req.log?.error({ err: error, id: req.params.id }, 'cashiers:history:error');
    return next(error);
  }
};

// POST /cashiers/:id/pause  { comment, performedByUserId }

exports.pause = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const idCashier = parseId(req.params.id);
    const { comment, performedByUserId } = req.body;

    if (!performedByUserId) {
      await t.rollback();
      throw new ApiError('performedByUserId es obligatorio', 400);
    }

    const normalizedComment = (comment ?? '').toString().trim() || null;

    const cashier = await Cashier.findByPk(idCashier, { transaction: t, lock: t.LOCK.UPDATE });
    if (!cashier) {
      await t.rollback();
      throw new ApiError('Ventanilla no encontrada', 404);
    }
    if (cashier.isOutOfService) {
      await t.rollback();
      throw new ApiError('La ventanilla está fuera de servicio', 400);
    }

    // Evitar doble pausa abierta
    const openPause = await CashierStatusLog.findOne({
      where: { idCashier, statusType: 'PAUSE', endedAt: null },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (openPause) {
      await t.rollback();
      throw new ApiError('Ya existe una pausa abierta', 409);
    }

    await Cashier.update(
      {
        isPaused: true,
        lastStateComment: normalizedComment, // <- permite null
        lastStateAt: new Date(),
      },
      { where: { idCashier }, transaction: t }
    );

    const log = await CashierStatusLog.create(
      {
        idCashier,
        statusType: 'PAUSE',
        comment: normalizedComment, // <- permite null
        startedAt: new Date(),
        endedAt: null,
        performedByUserId,
        closedByUserId: null,
      },
      { transaction: t }
    );

    await t.commit();
    req.log?.info({ idCashier, logId: log.id }, 'cashiers:pause:ok');
    return res.status(201).json({ ok: true, cashierId: idCashier, log });
  } catch (error) {
    if (t.finished !== 'commit') await t.rollback();
    req.log?.error({ err: error, id: req.params.id }, 'cashiers:pause:error');
    return next(error);
  }
};


// POST /cashiers/:id/out-of-service  { comment?, performedByUserId }
exports.outOfService = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const idCashier = parseId(req.params.id);
    const { comment, performedByUserId } = req.body;

    if (!performedByUserId) {
      await t.rollback();
      throw new ApiError('performedByUserId es obligatorio', 400);
    }

    const normalizedComment = (comment ?? '').toString().trim() || null;

    const cashier = await Cashier.findByPk(idCashier, { transaction: t, lock: t.LOCK.UPDATE });
    if (!cashier) {
      await t.rollback();
      throw new ApiError('Ventanilla no encontrada', 404);
    }

    // Si estaba en pausa, cerramos esa pausa antes de OOS
    const openPause = await CashierStatusLog.findOne({
      where: { idCashier, statusType: 'PAUSE', endedAt: null },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (openPause) {
      await openPause.update(
        { endedAt: new Date(), closedByUserId: performedByUserId },
        { transaction: t }
      );
      await Cashier.update({ isPaused: false }, { where: { idCashier }, transaction: t });
    }

    // Verificar que no exista OOS abierto
    const openOOS = await CashierStatusLog.findOne({
      where: { idCashier, statusType: 'OUT_OF_SERVICE', endedAt: null },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (openOOS) {
      await t.rollback();
      throw new ApiError('Ya está fuera de servicio', 409);
    }

    await Cashier.update(
      {
        isOutOfService: true,
        lastStateComment: normalizedComment, // <- permite null
        lastStateAt: new Date(),
      },
      { where: { idCashier }, transaction: t }
    );

    const log = await CashierStatusLog.create(
      {
        idCashier,
        statusType: 'OUT_OF_SERVICE',
        comment: normalizedComment, // <- permite null
        startedAt: new Date(),
        endedAt: null,
        performedByUserId,
        closedByUserId: null,
      },
      { transaction: t }
    );

    await t.commit();
    req.log?.info({ idCashier, logId: log.id }, 'cashiers:oos:ok');
    return res.status(201).json({ ok: true, cashierId: idCashier, log });
  } catch (error) {
    if (t.finished !== 'commit') await t.rollback();
    req.log?.error({ err: error, id: req.params.id }, 'cashiers:oos:error');
    return next(error);
  }
};


// POST /cashiers/:id/resume  { comment?, performedByUserId }
exports.resume = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const idCashier = parseId(req.params.id);
    const { comment, performedByUserId } = req.body;

    if (!performedByUserId) {
      await t.rollback();
      throw new ApiError('performedByUserId es obligatorio', 400);
    }

    const normalizedComment = (comment ?? '').toString().trim() || null;

    const cashier = await Cashier.findByPk(idCashier, { transaction: t, lock: t.LOCK.UPDATE });
    if (!cashier) {
      await t.rollback();
      throw new ApiError('Ventanilla no encontrada', 404);
    }

    // Cerrar cualquier intervalo abierto (PAUSE u OUT_OF_SERVICE)
    const openIntervals = await CashierStatusLog.findAll({
      where: {
        idCashier,
        endedAt: { [Op.is]: null },
        statusType: { [Op.in]: ['PAUSE', 'OUT_OF_SERVICE'] },
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    for (const it of openIntervals) {
      await it.update(
        { endedAt: new Date(), closedByUserId: performedByUserId },
        { transaction: t }
      );
    }

    // Resetear flags
    await Cashier.update(
      {
        isPaused: false,
        isOutOfService: false,
        lastStateComment: normalizedComment, // <- permite null
        lastStateAt: new Date(),
      },
      { where: { idCashier }, transaction: t }
    );

    await t.commit();
    req.log?.info({ idCashier, closed: openIntervals.length }, 'cashiers:resume:ok');
    return res.json({ ok: true, cashierId: idCashier, closedIntervals: openIntervals.length });
  } catch (error) {
    if (t.finished !== 'commit') await t.rollback();
    req.log?.error({ err: error, id: req.params.id }, 'cashiers:resume:error');
    return next(error);
  }
};

