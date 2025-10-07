// controllers/ticketRegistration.controller.js
const { Op } = require('sequelize');
const {
  TicketRegistration,
  TicketAttendance,
  TicketHistory,
  TicketTransferLog,
  Client,
  Service,
  Cashier,
  PrintOutbox,
  sequelize,
} = require('../models');
const Attendance = require('../services/attendance.service');

// Helpers nuevos (asegúrate de tener los archivos en utils/)
const { getNextTurnNumber, padN } = require('../utils/turnNumbers');
const { fmtGuatemalaYYYYMMDDHHmm } = require('../utils/time-tz');

/* ============================
   Helpers locales ligeros
============================ */
const s = (v, def = '') => (v === null || v === undefined ? def : String(v));

async function getServiceByPrefix(prefix) {
  if (!prefix) return null;
  return Service.findOne({
    where: sequelize.where(
      sequelize.fn('upper', sequelize.col('prefix')),
      String(prefix).toUpperCase()
    ),
  });
}

const isUniqueError = (err) => {
  if (!err) return false;
  const msg = String(err.message || '').toLowerCase();
  return (
    err.name === 'SequelizeUniqueConstraintError' ||
    msg.includes('unique') ||
    msg.includes('duplicate') ||
    msg.includes('duplicada') ||
    msg.includes('duplicado')
  );
};

/** Clausula de visibilidad por servicio respetando la “bandera” forcedToCashierId */
const addForcedVisibilityClause = (baseWhere, idCashierQ, respectForced) => {
  if (!respectForced) return baseWhere;
  if (!idCashierQ) {
    return { ...baseWhere, forcedToCashierId: null };
  }
  const orForced = { [Op.or]: [{ forcedToCashierId: null }, { forcedToCashierId: idCashierQ }] };
  return baseWhere[Op.and]
    ? { ...baseWhere, [Op.and]: [...baseWhere[Op.and], orForced] }
    : { ...baseWhere, [Op.and]: [orForced] };
};

const toTicketPayload = (ticket, client = null, service = null) => ({
  idTicketRegistration: ticket.idTicketRegistration,
  turnNumber: ticket.turnNumber,
  correlativo: ticket.correlativo,
  prefix: (service?.prefix ?? ticket.Service?.prefix) || undefined,
  usuario: (client?.name ?? ticket.Client?.name) || 'Sin cliente',
  modulo: (service?.name ?? ticket.Service?.name) || '—',
  createdAt: ticket.createdAt,
  updatedAt: ticket.updatedAt,
  idTicketStatus: ticket.idTicketStatus,
  idCashier: ticket.idCashier,
  dispatchedByUser: ticket.dispatchedByUser,
  idService: ticket.idService,
  idClient: ticket.idClient,
  status: ticket.status,
  forcedToCashierId: ticket.forcedToCashierId ?? null,
});

const toCreatedTicketPayload = ({ ticket, client, service, cashier = null }) => ({
  idTicketRegistration: ticket.idTicketRegistration,
  turnNumber: ticket.turnNumber,
  correlativo: ticket.correlativo,
  prefix: service.prefix,
  createdAt: ticket.createdAt,
  idTicketStatus: ticket.idTicketStatus,
  client: client
    ? { idClient: client.idClient, name: client.name, dpi: client.dpi || null }
    : null,
  service: {
    idService: service.idService,
    name: service.name,
    prefix: service.prefix,
  },
  idCashier: ticket.idCashier ?? null,
  cashier: cashier ? { idCashier: cashier.idCashier, name: cashier.name } : null,
});

/* ============================
   Listados simples
============================ */

exports.findAll = async (req, res) => {
  try {
    const { prefix, idCashier: idCashierRaw, respectForced } = req.query;
    const idCashierQ = Number.isFinite(Number(idCashierRaw)) ? Number(idCashierRaw) : 0;
    const respect = respectForced !== 'false';

    let where = { idTicketStatus: 1 };

    if (prefix) {
      const svc = await getServiceByPrefix(prefix);
      if (!svc) return res.json([]);
      where.idService = svc.idService;
    }

    where = addForcedVisibilityClause(where, idCashierQ, respect);

    const tickets = await TicketRegistration.findAll({
      where,
      include: [{ model: Service }, { model: Client }],
      order: [['turnNumber', 'ASC'], ['createdAt', 'ASC']],
    });

    res.json(tickets.map((t) => toTicketPayload(t, t.Client, t.Service)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.findAllDispatched = async (req, res) => {
  try {
    const { prefix, idCashier: idCashierRaw, respectForced } = req.query;
    const idCashierQ = Number.isFinite(Number(idCashierRaw)) ? Number(idCashierRaw) : 0;
    const respect = respectForced !== 'false';

    let where = { idTicketStatus: 2 };

    if (prefix) {
      const svc = await getServiceByPrefix(prefix);
      if (!svc) return res.json([]);
      where.idService = svc.idService;
    }

    where = addForcedVisibilityClause(where, idCashierQ, respect);

    const tickets = await TicketRegistration.findAll({
      where,
      include: [{ model: Service }, { model: Client }],
      order: [['turnNumber', 'ASC'], ['createdAt', 'ASC']],
    });
    res.json(tickets.map((t) => toTicketPayload(t, t.Client, t.Service)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.findById = async (req, res) => {
  try {
    const ticket = await TicketRegistration.findByPk(req.params.id, {
      include: [{ model: Client }, { model: Service }],
    });
    if (!ticket) return res.status(404).json({ error: 'Not found' });
    return res.json(toTicketPayload(ticket));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/* ============================
   CREAR TICKET con reintento
============================ */
exports.create = async (req, res, next) => {
  const { dpi, name, idService: idServiceRaw, locationId } = req.body;

  try {
    const idService =
      typeof idServiceRaw === 'string' ? parseInt(idServiceRaw, 10) : idServiceRaw;

    // Validaciones
    if (!name || name.trim() === '') {
      return res.status(400).json({ message: 'El nombre es obligatorio.' });
    }
    if (dpi && !/^\d{13}$/.test(dpi)) {
      return res.status(400).json({ message: 'El DPI debe tener 13 dígitos numéricos.' });
    }

    // 1) Cliente
    let client;
    if (dpi) {
      const [c] = await Client.findOrCreate({ where: { dpi }, defaults: { name, dpi } });
      client = c;
    } else {
      client = await Client.create({ name, dpi: null });
    }

    // 2) Servicio
    const service = await Service.findByPk(idService);
    if (!service) {
      return res.status(404).json({ message: 'Servicio no encontrado.' });
    }

    // 3) Reintento de creación con transacción (colisiones únicas)
    const maxAttempts = 3;
    let createdTicket = null;
    let lastErr = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const t = await sequelize.transaction();
      try {
        // Número de turno por día (America/Guatemala) + correlativo 3 dígitos
        const turnNumber = await getNextTurnNumber(idService, t);
        const correlativo = `${service.prefix}-${padN(turnNumber, 3)}`;

        const ticket = await TicketRegistration.create(
          {
            turnNumber,
            idTicketStatus: 1, // pendiente
            idClient: client.idClient,
            idService,
            idCashier: null,
            status: true,
            correlativo,
            forcedToCashierId: null,
            printStatus: 'pending',
          },
          { transaction: t }
        );

        await t.commit();
        createdTicket = ticket;
        lastErr = null;
        break;
      } catch (err) {
        try { if (t.finished !== 'commit') await t.rollback(); } catch {}
        lastErr = err;
        if (isUniqueError(err) && attempt < maxAttempts) {
          // pequeño backoff aleatorio
          await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 25) + 10));
          continue;
        }
        break;
      }
    }

    if (!createdTicket) {
      if (lastErr) return next(lastErr);
      return res.status(500).json({ message: 'No se pudo crear el ticket.' });
    }

    // ====== SOCKETS ======
    const io = require('../server/socket').getIo?.();
    const room = String(service.prefix || '').toLowerCase();
    const socketPayload = toTicketPayload(createdTicket, client, service);

    if (io) {
      io.to(room).emit('new-ticket', socketPayload);
      io.to('tv').emit('new-ticket', socketPayload);
    }

    // ====== COLA DE IMPRESIÓN (con expiración para evitar backlog) ======
    if (locationId) {
      // evita duplicar jobs “abiertos” para el mismo ticket
      const existing = await PrintOutbox.findOne({
        where: {
          ticket_id: createdTicket.idTicketRegistration,
          status: { [Op.in]: ['pending', 'sent'] },
        },
      });

      if (!existing) {
        const printPayload = {
          type: 'escpos',
          header: 'SISTEMA DE TURNOS',
          subHeader: s(service.name, ''),
          ticketNumber: s(socketPayload.correlativo, '---'),
          name: s(client?.name, ''),
          dpi: s(client?.dpi, ''),
          service: s(service.name, ''),
          footer: 'Gracias por su visita',
          // Hora de Guatemala para el papel
          dateTime: fmtGuatemalaYYYYMMDDHHmm(new Date()),
        };

        // TTL del job (ajústalo a tu operación)
        const TTL_MS = 60_000;
        const expiresAt = new Date(Date.now() + TTL_MS);

        const newJob = await PrintOutbox.create({
          ticket_id: createdTicket.idTicketRegistration,
          location_id: locationId,
          payload: printPayload,
          status: 'pending',
          attempts: 0,
          // Nota: agrega esta columna en la BD si aún no existe:
          // ALTER TABLE print_outbox ADD COLUMN expires_at DATETIME NULL;
          expires_at: expiresAt,
        });

        // Si el bridge está online, despacha ya
        const socketModule = require('../server/socket');
        const io2 = socketModule.getIo?.();
        if (io2) {
          await newJob.update({
            status: 'sent',
            attempts: (newJob.attempts || 0) + 1,
            last_error: null,
          });

          await TicketRegistration.update(
            { printStatus: 'sent' },
            { where: { idTicketRegistration: createdTicket.idTicketRegistration } }
          );

          io2.to(`bridge:${locationId}`).emit('print-ticket', {
            jobId: newJob.id,
            type: printPayload.type,
            payload: printPayload,
          });
        }
      }
    }

    // Respuesta
    const responsePayload = toCreatedTicketPayload({
      ticket: createdTicket,
      client,
      service,
      cashier: null,
    });

    return res.status(201).json(responsePayload);
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
};

/* ============================
   Otros listados / update / delete
============================ */

exports.getTicketsByPrefix = async (req, res, next) => {
  try {
    const { prefix } = req.params;
    const { idCashier: idCashierRaw, respectForced } = req.query;
    const idCashierQ = Number.isFinite(Number(idCashierRaw)) ? Number(idCashierRaw) : 0;
    const respect = respectForced !== 'false';

    const service = await getServiceByPrefix(prefix);
    if (!service) return res.status(404).json({ message: 'Servicio no encontrado.' });

    let where = {
      idService: service.idService,
      status: true,
      idTicketStatus: 1,
    };
    where = addForcedVisibilityClause(where, idCashierQ, respect);

    const tickets = await TicketRegistration.findAll({
      where,
      order: [['turnNumber', 'ASC'], ['createdAt', 'ASC']],
    });

    const payload = tickets.map((t) => ({
      idTicketRegistration: t.idTicketRegistration,
      turnNumber: t.turnNumber,
      correlativo: t.correlativo,
      createdAt: t.createdAt,
      prefix: service.prefix,
      name: service.name,
      forcedToCashierId: t.forcedToCashierId ?? null,
    }));

    return res.json(payload);
  } catch (err) {
    next(err);
  }
};

exports.getTicketsForCashier = async (req, res) => {
  try {
    const { idCashier } = req.query;
    const cashierId = parseInt(idCashier || 0, 10);
    if (!cashierId) {
      return res.status(400).json({ error: 'idCashier requerido' });
    }

    const currentTicket = await TicketRegistration.findOne({
      where: { idTicketStatus: 2, idCashier: cashierId, status: true },
      include: [{ model: Client }, { model: Service }],
      order: [['turnNumber', 'ASC']],
    });

    const queueTickets = await TicketRegistration.findAll({
      where: { idTicketStatus: 1, status: true, forcedToCashierId: cashierId },
      include: [{ model: Client }, { model: Service }],
      order: [['turnNumber', 'ASC']],
    });

    const response = {
      current: currentTicket ? toTicketPayload(currentTicket) : null,
      queue: queueTickets.map((t) => toTicketPayload(t)),
    };

    if (response.current && response.current.idTicketStatus === 2) {
      const openSpan = await TicketAttendance.findOne({
        where: { idTicket: response.current.idTicketRegistration, endedAt: null },
        order: [['startedAt', 'DESC']],
      });
      response.currentAttentionStartedAt = openSpan ? openSpan.startedAt : null;
    }

    res.json(response);
  } catch (error) {
    console.error('[getTicketsForCashier] Error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.update = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { idCashier, idTicketStatus, observations } = req.body;
    const ticketId = req.params.id;

    const currentTicket = await TicketRegistration.findByPk(ticketId, {
      include: [{ model: Client }, { model: Service }],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!currentTicket) {
      await t.rollback();
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }

    if (idTicketStatus === 2) {
      if (
        currentTicket.forcedToCashierId &&
        Number(currentTicket.forcedToCashierId) !== Number(idCashier)
      ) {
        await t.rollback();
        return res.status(403).json({
          error: 'TICKET_FORCED_TO_OTHER_CASHIER',
          message: 'Este ticket está reservado para otra ventanilla',
          forcedToCashierId: currentTicket.forcedToCashierId,
        });
      }
      if (
        currentTicket.idTicketStatus === 2 &&
        currentTicket.idCashier &&
        currentTicket.idCashier !== idCashier
      ) {
        await t.rollback();
        return res.status(409).json({
          error: 'Este ticket ya está siendo atendido por otro cajero',
          conflictTicket: currentTicket.correlativo,
          currentCashier: currentTicket.idCashier,
        });
      }
    }

    const newStatus = idTicketStatus ?? currentTicket.idTicketStatus;
    const newCashierId = idCashier ?? currentTicket.idCashier ?? null;

    const updateData = {
      idTicketStatus: newStatus,
      idCashier: newCashierId,
      ...(observations && { observations }),
      ...(newStatus === 2 &&
        currentTicket.idTicketStatus === 1 && {
          dispatchedByUser: req.body.changedByUser || req.body.idUser || 1,
        }),
    };

    const [updated] = await TicketRegistration.update(updateData, {
      where: { idTicketRegistration: ticketId },
      transaction: t,
    });

    if (!updated) {
      await t.rollback();
      return res.status(404).json({ error: 'No se pudo actualizar' });
    }

    const now = new Date();
    if (newStatus === 2) {
      await Attendance.rotateSpan(
        {
          idTicket: Number(ticketId),
          idCashier: newCashierId,
          idService: currentTicket.idService,
          at: now,
        },
        t
      );
    } else if (currentTicket.idTicketStatus === 2 && newStatus !== 2) {
      await Attendance.closeOpenSpan({ idTicket: Number(ticketId), at: now }, t);
    }

    await TicketHistory.create(
      {
        idTicket: ticketId,
        fromStatus: currentTicket.idTicketStatus,
        toStatus: newStatus,
        changedByUser: req.body.changedByUser || 1,
      },
      { transaction: t }
    );

    await t.commit();

    let attentionStartedAt = null;
    if (newStatus === 2) {
      const openSpan = await TicketAttendance.findOne({
        where: { idTicket: Number(ticketId), endedAt: null },
        order: [['startedAt', 'DESC']],
      });
      attentionStartedAt = openSpan ? openSpan.startedAt : null;
    }

    const updatedTicket = await TicketRegistration.findByPk(ticketId, {
      include: [{ model: Client }, { model: Service }],
    });

    const io2 = require('../server/socket').getIo?.();
    const payload = toTicketPayload(
      updatedTicket,
      updatedTicket.Client,
      updatedTicket.Service
    );

    if (io2) {
      if (newStatus === 2 && currentTicket.idTicketStatus === 1) {
        const socketModule = require('../server/socket');
        const room = updatedTicket.Service.prefix.toLowerCase();

        const assignedPayload = {
          ticket: payload,
          assignedToCashier: newCashierId,
          previousStatus: currentTicket.idTicketStatus,
          timestamp: Date.now(),
          attentionStartedAt,
        };

        if (socketModule.emitToAvailableCashiers) {
          await socketModule.emitToAvailableCashiers(
            updatedTicket.Service.prefix,
            'ticket-assigned',
            assignedPayload,
            newCashierId
          );
        } else {
          io2.to(room).emit('ticket-assigned', assignedPayload);
        }
      } else if (newStatus === 4) {
        const room = updatedTicket.Service.prefix.toLowerCase();
        io2.to(room).emit('ticket-completed', {
          ticket: payload,
          completedByCashier: currentTicket.idCashier,
          previousStatus: currentTicket.idTicketStatus,
          timestamp: Date.now(),
        });
      } else if (newStatus === 3) {
        const room = updatedTicket.Service.prefix.toLowerCase();
        io2.to(room).emit('ticket-cancelled', {
          ticket: payload,
          cancelledByCashier: currentTicket.idCashier,
          previousStatus: currentTicket.idTicketStatus,
          timestamp: Date.now(),
        });
      }

      io2.emit('ticket-updated', payload);
    }

    try {
      const socketModule = require('../server/socket');
      if (currentTicket.idTicketStatus === 2 && (newStatus === 4 || newStatus === 3)) {
        const freedCashierId = newCashierId || currentTicket.idCashier || null;
        if (freedCashierId) {
          await socketModule.pickNextForCashier?.(updatedTicket.Service.prefix, freedCashierId);
        }
      }
    } catch (e) {
      console.error('[update] pickNextForCashier error:', e?.message || e);
    }

    res.json(updatedTicket);
  } catch (error) {
    if (t.finished !== 'commit') await t.rollback();
    console.error('Error al actualizar ticket:', error);
    res.status(400).json({ error: error.message });
  }
};

exports.getPendingTickets = async (req, res) => {
  try {
    const { idCashier: idCashierRaw, respectForced, prefix } = req.query;
    const idCashierQ = Number.isFinite(Number(idCashierRaw)) ? Number(idCashierRaw) : 0;
    const respect = respectForced !== 'false';

    let where = { idTicketStatus: parseInt(req.query.status || 1, 10) };

    if (prefix) {
      const svc = await getServiceByPrefix(prefix);
      if (!svc) return res.json([]);
      where.idService = svc.idService;
    }

    where = addForcedVisibilityClause(where, idCashierQ, respect);

    const tickets = await TicketRegistration.findAll({
      where,
      include: [{ model: Client }, { model: Service }],
      order: [['createdAt', 'ASC']],
    });

    res.json(tickets.map((t) => toTicketPayload(t)));
  } catch (error) {
    console.error('Error al obtener tickets:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const deleted = await TicketRegistration.destroy({
      where: { idTicketRegistration: req.params.id },
    });
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.findAllLive = async (req, res) => {
  try {
    const { prefix, statuses, idCashier: idCashierRaw, respectForced } = req.query;
    const idCashierQ = Number.isFinite(Number(idCashierRaw)) ? Number(idCashierRaw) : 0;
    const respect = respectForced !== 'false';

    let ids = [1, 2];
    if (statuses) {
      ids = String(statuses)
        .split(',')
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isFinite(n));
      if (ids.length === 0) ids = [1, 2];
    }

    let where = { status: true, idTicketStatus: { [Op.in]: ids } };

    if (prefix) {
      const svc = await getServiceByPrefix(prefix);
      if (!svc) return res.json([]);
      where.idService = svc.idService;
    }

    where = addForcedVisibilityClause(where, idCashierQ, respect);

    const rows = await TicketRegistration.findAll({
      where,
      include: [{ model: Client }, { model: Service }],
      order: [
        ['turnNumber', 'ASC'],
        ['createdAt', 'ASC'],
      ],
    });

    const payload = rows.map((t) => toTicketPayload(t, t.Client, t.Service));
    return res.json(payload);
  } catch (err) {
    console.error('findAllLive error:', err);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      message: 'No se pudieron obtener tickets',
    });
  }
};

/* ============================
   TRANSFERIR TICKET
============================ */
exports.transfer = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const ticketId = parseInt(req.params.id, 10);
    const {
      toCashierId,
      performedByUserId,
      comment,
      autoAssignIfFree = false,
      fromCashierId: fromCashierIdRaw,
    } = req.body;

    if (!Number.isInteger(ticketId)) {
      await t.rollback();
      return res.status(400).json({ error: 'ID de ticket inválido' });
    }
    if (!toCashierId || !performedByUserId) {
      await t.rollback();
      return res.status(400).json({ error: 'toCashierId y performedByUserId son requeridos' });
    }

    const ticket = await TicketRegistration.findByPk(ticketId, {
      include: [{ model: Service }, { model: Cashier }],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!ticket || ticket.status === false) {
      await t.rollback();
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }
    if ([3, 4].includes(ticket.idTicketStatus)) {
      await t.rollback();
      return res.status(400).json({ error: 'No se puede trasladar un ticket cancelado o completado' });
    }
    if (ticket.idTicketStatus !== 2) {
      await t.rollback();
      return res.status(400).json({ error: 'ONLY_IN_ATTENTION', message: 'Solo se puede trasladar un ticket que está en atención.' });
    }

    const fromCashierId = fromCashierIdRaw ?? ticket.idCashier ?? null;
    if (!fromCashierId || Number(ticket.idCashier) !== Number(fromCashierId)) {
      await t.rollback();
      return res.status(403).json({ error: 'NOT_ATTENDING_CASHIER', message: 'Solo la ventanilla que está atendiendo puede trasladar el ticket.' });
    }

    const fromCashier = await Cashier.findByPk(fromCashierId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!fromCashier) {
      await t.rollback();
      return res.status(404).json({ error: 'Ventanilla de origen no encontrada' });
    }
    if (fromCashier.allowTransfersOut === false) {
      await t.rollback();
      return res.status(403).json({ error: 'La ventanilla de origen no permite trasladar tickets' });
    }
    if (fromCashier.isPaused || fromCashier.isOutOfService) {
      await t.rollback();
      return res.status(400).json({ error: 'La ventanilla de origen está pausada o fuera de servicio' });
    }

    const toCashier = await Cashier.findByPk(toCashierId, {
      include: [{ model: Service, attributes: ['idService', 'prefix', 'name'] }],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!toCashier) {
      await t.rollback();
      return res.status(404).json({ error: 'Ventanilla de destino no encontrada' });
    }
    if (!toCashier.status || toCashier.isOutOfService) {
      await t.rollback();
      return res.status(400).json({ error: 'La ventanilla de destino está inactiva o fuera de servicio' });
    }
    if (toCashier.allowTransfersIn === false) {
      await t.rollback();
      return res.status(403).json({ error: 'La ventanilla de destino no acepta traslados' });
    }

    const destServiceId = Number(toCashier.idService);
    const originPrefix = (ticket.Service?.prefix || '').toUpperCase();

    if (ticket.forcedToCashierId && Number(ticket.forcedToCashierId) !== Number(fromCashierId || 0)) {
      await t.rollback();
      return res.status(403).json({ error: 'El ticket está reservado para otra ventanilla', forcedToCashierId: ticket.forcedToCashierId });
    }

    const isDestBusy = !!(await TicketRegistration.findOne({
      where: { idCashier: toCashier.idCashier, idTicketStatus: 2, status: true },
      transaction: t,
      lock: t.LOCK.UPDATE,
    }));

    const autoAssign = typeof autoAssignIfFree === 'string'
      ? autoAssignIfFree.toLowerCase() === 'true'
      : !!autoAssignIfFree;

    const prevStatus = ticket.idTicketStatus;

    const needsRenumber = Number(ticket.idService) !== destServiceId;
    let nextTurn = ticket.turnNumber;
    let nextCorrelativo = ticket.correlativo;
    let destPrefix = (toCashier.Service?.prefix || '').toUpperCase();

    if (needsRenumber) {
      const maxAttempts = 3;
      let okNum = false; let lastErr = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const n = await getNextTurnNumber(destServiceId, t);
          nextTurn = n;
          nextCorrelativo = `${destPrefix}-${padN(nextTurn, 3)}`;
          okNum = true;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt >= maxAttempts || !isUniqueError(err)) throw err;
        }
      }
      if (!okNum && lastErr) throw lastErr;
    }

    let newStatus = prevStatus;
    let assignedNow = false;

    if (isDestBusy || !autoAssign) {
      newStatus = 1; // cola en destino
    } else {
      newStatus = 2; // asignado en destino
      assignedNow = true;
    }

    const updateData = {
      idTicketStatus: newStatus,
      idCashier: assignedNow ? toCashier.idCashier : null,
      forcedToCashierId: toCashier.idCashier,
      idService: destServiceId,
      dispatchedByUser: assignedNow ? performedByUserId : null,
      ...(needsRenumber ? { turnNumber: nextTurn, correlativo: nextCorrelativo } : {}),
    };

    const tryUpdate = async () => {
      await ticket.update(updateData, { transaction: t });
    };

    if (needsRenumber) {
      let ok = false; let lastErr = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await tryUpdate();
          ok = true; break;
        } catch (err) {
          lastErr = err;
          if (isUniqueError(err) && attempt < 3) {
            const n = await getNextTurnNumber(destServiceId, t);
            nextTurn = n;
            nextCorrelativo = `${destPrefix}-${padN(nextTurn, 3)}`;
            updateData.turnNumber = nextTurn;
            updateData.correlativo = nextCorrelativo;
            continue;
          }
          throw err;
        }
      }
      if (!ok) throw lastErr;
    } else {
      await tryUpdate();
    }

    await TicketTransferLog.create(
      {
        idTicketRegistration: ticket.idTicketRegistration,
        fromCashierId: fromCashierId || null,
        toCashierId: toCashier.idCashier,
        performedByUserId,
        comment: comment?.trim() || null,
      },
      { transaction: t }
    );

    await TicketHistory.create(
      {
        idTicket: ticket.idTicketRegistration,
        fromStatus: prevStatus,
        toStatus: newStatus,
        changedByUser: performedByUserId,
      },
      { transaction: t }
    );

    const now = new Date();
    if (prevStatus === 2) {
      await Attendance.closeOpenSpan({ idTicket: ticket.idTicketRegistration, at: now }, t);
    }
    if (assignedNow && newStatus === 2) {
      await Attendance.rotateSpan(
        {
          idTicket: ticket.idTicketRegistration,
          idCashier: toCashier.idCashier,
          idService: destServiceId,
          at: now,
        },
        t
      );
    }

    await t.commit();

    let attentionStartedAt = null;
    if (assignedNow && newStatus === 2) {
      const openSpan = await TicketAttendance.findOne({
        where: { idTicket: ticket.idTicketRegistration, endedAt: null },
        order: [['startedAt', 'DESC']],
      });
      attentionStartedAt = openSpan ? openSpan.startedAt : null;
    }

    const io3 = require('../server/socket').getIo?.();
    if (io3) {
      const destPrefixUpper = destPrefix;
      const destRoom = destPrefixUpper.toLowerCase();

      let usuarioName = 'Sin cliente';
      try {
        const cli = await Client.findByPk(ticket.idClient);
        if (cli && cli.name) usuarioName = cli.name;
      } catch {}
      const moduloName = toCashier.Service?.name || '—';

      const payload = {
        idTicketRegistration: ticket.idTicketRegistration,
        turnNumber: nextTurn,
        correlativo: nextCorrelativo,
        prefix: destPrefixUpper,
        idService: destServiceId,
        idTicketStatus: newStatus,
        idCashier: assignedNow ? toCashier.idCashier : null,
        forcedToCashierId: toCashier.idCashier,
        updatedAt: ticket.updatedAt,
        usuario: usuarioName,
        modulo: moduloName,
      };

      if (originPrefix) {
        io3.to(originPrefix.toLowerCase()).emit('ticket-removed', {
          idTicketRegistration: ticket.idTicketRegistration,
          correlativo: nextCorrelativo,
          fromService: originPrefix,
          timestamp: Date.now(),
        });
      }

      io3.to(`cashier:${fromCashierId}`).emit('ticket-transferred', {
        ticket: payload,
        fromCashierId: fromCashierId || null,
        toCashierId: toCashier.idCashier,
        queued: !assignedNow,
        timestamp: Date.now(),
      });
      io3.to(`cashier:${toCashier.idCashier}`).emit('ticket-transferred', {
        ticket: payload,
        fromCashierId: fromCashierId || null,
        toCashierId: toCashier.idCashier,
        queued: !assignedNow,
        timestamp: Date.now(),
      });

      if (assignedNow) {
        io3.to(`cashier:${toCashier.idCashier}`).emit('ticket-assigned', {
          ticket: payload,
          assignedToCashier: toCashier.idCashier,
          previousStatus: prevStatus,
          timestamp: Date.now(),
          attentionStartedAt,
        });
        io3.to(destRoom).emit('ticket-removed', {
          idTicketRegistration: ticket.idTicketRegistration,
          correlativo: nextCorrelativo,
          fromService: destPrefixUpper,
          timestamp: Date.now(),
        });
      } else {
        const queuedPayload = { ...payload, idTicketStatus: 1, idCashier: null };
        io3.to(destRoom).emit('new-ticket', queuedPayload);
        io3.to(`cashier:${toCashier.idCashier}`).emit('new-ticket', queuedPayload);
        io3.to(`cashier:${toCashier.idCashier}`).emit('update-current-display', {
          ticket: queuedPayload, isAssigned: false, timestamp: Date.now(),
        });
      }

      io3.emit('ticket-updated', payload);
    }

    try {
      const socketModule = require('../server/socket');
      if (fromCashierId) {
        await socketModule.pickNextForCashier?.(originPrefix, fromCashierId);
      }
    } catch (e) {
      console.error('[transfer] pickNextForCashier (origin) error:', e?.message || e);
    }

    return res.json({
      ok: true,
      ticketId: ticket.idTicketRegistration,
      fromCashierId: fromCashierId || null,
      toCashierId: toCashier.idCashier,
      assignedNow,
      queued: !assignedNow,
      correlativo: nextCorrelativo,
      turnNumber: nextTurn,
      attentionStartedAt: attentionStartedAt || null,
    });
  } catch (err) {
    console.error('[transfer] error:', err);
    try { if (t.finished !== 'commit') await t.rollback(); } catch {}
    return res.status(500).json({ error: 'No se pudo trasladar el ticket' });
  }
};
