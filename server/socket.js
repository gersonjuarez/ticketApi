// server/socket.js
const { Server } = require('socket.io');
const { Op } = require('sequelize');

let io;

// Estados en memoria (negocio de cajeros)
const cashierTickets = new Map();        // Map<prefix_idCashier, {...}>
const serviceQueues = new Map();         // Map<room, {cashiers: Map<socketId, {idCashier, currentTicket, idUser}>}>
const cashierCurrentDisplay = new Map(); // Map<idCashier, {currentTicket, isAssigned}>

// Worker de impresión
let printWorkerInterval = null;
let isProcessingPrintQueue = false;

/* ============================
   Utils
============================ */
/** Al reconectar un cajero, restaurar su estado: EN_ATENCION o PENDIENTE forzado para él (cualquier servicio) */
/** Al reconectar un cajero, restaurar su estado sin mutar nada:
 *  1) Si tiene EN_ATENCION → ese manda
 *  2) Si no, mostrar primer PENDIENTE reservado para él en su servicio (preferPrefix)
 *  3) Si no hay en su servicio, mostrar primer PENDIENTE reservado para él en cualquier servicio
 */
async function restoreCashierState(idCashier, preferPrefix = null) {
  try {
    const { TicketRegistration, Service, sequelize } = require('../models');

    // 1) En atención conmigo
    const assigned = await TicketRegistration.findOne({
      where: { idTicketStatus: 2, idCashier: idCashier, status: true },
      include: [{ model: Service, attributes: ['prefix'] }],
      order: [['updatedAt', 'DESC']],
    });
    if (assigned) {
      const payload = toDisplayPayload(assigned.Service?.prefix, assigned);
      cashierCurrentDisplay.set(idCashier, { currentTicket: payload, isAssigned: true });
      emitToCashierDirect(idCashier, 'update-current-display', {
        ticket: payload, isAssigned: true, timestamp: Date.now(),
      });
      return;
    }

    // 2) Reservado para mí en MI servicio (si lo conozco)
    if (preferPrefix && typeof preferPrefix === 'string') {
      const svc = await Service.findOne({
        where: sequelize.where(
          sequelize.fn('upper', sequelize.col('prefix')),
          String(preferPrefix).toUpperCase()
        ),
        attributes: ['idService', 'prefix'],
      });

      if (svc) {
        const forcedInMyService = await TicketRegistration.findOne({
          where: {
            idTicketStatus: 1,
            status: true,
            forcedToCashierId: idCashier,
            idService: svc.idService,
          },
          include: [{ model: Service, attributes: ['prefix'] }],
          order: [['turnNumber', 'ASC'], ['createdAt', 'ASC']],
        });

        if (forcedInMyService) {
          const payload = toDisplayPayload(forcedInMyService.Service?.prefix, forcedInMyService);
          cashierCurrentDisplay.set(idCashier, { currentTicket: payload, isAssigned: false });
          emitToCashierDirect(idCashier, 'update-current-display', {
            ticket: payload, isAssigned: false, timestamp: Date.now(),
          });
          return;
        }
      }
    }

    // 3) Reservado para mí en cualquier servicio
    const forcedAny = await TicketRegistration.findOne({
      where: { idTicketStatus: 1, status: true, forcedToCashierId: idCashier },
      include: [{ model: Service, attributes: ['prefix'] }],
      order: [['turnNumber', 'ASC'], ['createdAt', 'ASC']],
    });
    if (forcedAny) {
      const payload = toDisplayPayload(forcedAny.Service?.prefix, forcedAny);
      cashierCurrentDisplay.set(idCashier, { currentTicket: payload, isAssigned: false });
      emitToCashierDirect(idCashier, 'update-current-display', {
        ticket: payload, isAssigned: false, timestamp: Date.now(),
      });
    }
  } catch (e) {
    console.error('[socket:restoreCashierState] error:', e?.message || e);
  }
}


/** Obtiene idService a partir del prefix (case-insensitive) */
async function getServiceIdByPrefix(prefix) {
  if (!prefix) return null;
  const { Service, sequelize } = require('../models');
  const svc = await Service.findOne({
    where: sequelize.where(
      sequelize.fn('upper', sequelize.col('prefix')),
      String(prefix).toUpperCase()
    ),
    attributes: ['idService', 'prefix'],
  });
  return svc ? Number(svc.idService) : null;
}

/** Construye payload mínimo para pantallas */
function toDisplayPayload(prefix, t) {
  const pfx = (prefix ? String(prefix) : (t?.Service?.prefix || '')).toUpperCase();
  return {
    idTicketRegistration: t.idTicketRegistration,
    turnNumber: t.turnNumber,
    correlativo: t.correlativo,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    idTicketStatus: t.idTicketStatus,
    idCashier: t.idCashier,
    dispatchedByUser: t.dispatchedByUser,
    idService: t.idService,
    idClient: t.idClient,
    prefix: pfx,
    status: t.status,
    usuario: 'Sin cliente',
    modulo: '—',
  };
}

/** Emite a un cajero por su room y, si no hay sockets ahí, por los sockets registrados en serviceQueues (fallback) */
function emitToCashierDirect(idCashier, event, payload) {
  if (!io || !idCashier) return 0;
  const room = `cashier:${idCashier}`;
  const socketsInRoom = io.sockets.adapter.rooms.get(room);
  let sent = 0;

  if (socketsInRoom && socketsInRoom.size > 0) {
    io.to(room).emit(event, payload);
    sent = socketsInRoom.size;
  } else {
    // Fallback: recorrer los sockets registrados en serviceQueues
    for (const [, serviceInfo] of serviceQueues) {
      for (const [socketId, info] of serviceInfo.cashiers) {
        if (info.idCashier === idCashier) {
          const s = io.sockets.sockets.get(socketId);
          if (s) { s.emit(event, payload); sent++; }
        }
      }
    }
  }
  return sent;
}

/**
 * Empuja al cajero su "siguiente" ticket dentro del servicio:
 * ahora se elige SIEMPRE el menor turnNumber entre:
 *  - pendientes forzados a ese cajero  OR  pendientes libres del servicio
 */
async function pickNextForCashier(prefix, idCashier) {
  try {
    if (!io) throw new Error('io no inicializado');
    const serviceId = await getServiceIdByPrefix(prefix);
    if (!serviceId || !idCashier) return;

    const { TicketRegistration, Op } = require('../models');

    const next = await TicketRegistration.findOne({
      where: {
        idTicketStatus: 1,
        idService: serviceId,
        status: true,
        [Op.or]: [
          { forcedToCashierId: idCashier },
          { forcedToCashierId: null },
        ],
      },
      order: [['turnNumber', 'ASC'], ['createdAt', 'ASC']],
    });

    if (!next) {
      cashierCurrentDisplay.delete(idCashier);
      emitToCashierDirect(idCashier, 'no-tickets-available', { timestamp: Date.now() });
      console.log(`[socket:pickNextForCashier] Sin siguiente para cajero ${idCashier} en ${prefix}`);
      return;
    }

    const payload = toDisplayPayload(prefix, next);
    cashierCurrentDisplay.set(idCashier, { currentTicket: payload, isAssigned: false });
    emitToCashierDirect(idCashier, 'update-current-display', {
      ticket: payload,
      isAssigned: false,
      timestamp: Date.now(),
    });

    console.log(
      `[socket:pickNextForCashier] Enviado ${next.correlativo} a cajero ${idCashier} (${prefix})`
    );
  } catch (e) {
    console.error('[socket:pickNextForCashier] error:', e?.message || e);
  }
}

/**
 * Envía un batch de trabajos 'pending' al bridge correspondiente.
 * Reclama cada job de forma atómica marcándolo a 'sent' y lo emite.
 * NO toca printedAt (eso lo hace el ACK).
 */
async function processPrintQueueBatch(io, batchSize = 15) {
  if (isProcessingPrintQueue) return;
  isProcessingPrintQueue = true;

  try {
    const { PrintOutbox, TicketRegistration, sequelize } = require('../models');

    const candidates = await PrintOutbox.findAll({
      attributes: ['id'],
      where: { status: { [Op.or]: ['pending', '', null] } },
      order: [['createdAt', 'ASC']],
      limit: batchSize,
    });

    if (candidates.length === 0) return;

    for (const row of candidates) {
      const id = row.id;

      const [claimed] = await PrintOutbox.update(
        {
          status: 'sent',
          attempts: sequelize.literal('(COALESCE(attempts,0) + 1)'),
          last_error: null,
          updatedAt: new Date(),
        },
        {
          where: {
            id,
            status: { [Op.or]: ['pending', '', null] },
          },
        }
      );

      if (!claimed) continue;

      const job = await PrintOutbox.findByPk(id);
      if (!job) continue;

      if (!job.location_id) {
        await job.update({ status: 'failed', last_error: 'location_id vacío' });
        continue;
      }

      let parsed = {};
      try {
        parsed = typeof job.payload === 'string' ? JSON.parse(job.payload) : (job.payload || {});
      } catch { parsed = {}; }

      const type = parsed?.type || 'escpos';
      const finalPayload = (parsed && typeof parsed.payload === 'object') ? parsed.payload : parsed;

      if (job.ticket_id) {
        await TicketRegistration.update(
          { printStatus: 'sent' }, // <-- usar atributo del modelo
          { where: { idTicketRegistration: job.ticket_id } }
        );
      }

      console.log(`[print-worker] jobId=${id} → status=sent, emit to bridge:${job.location_id}`);

      io.to(`bridge:${job.location_id}`).emit('print-ticket', {
        jobId: id,
        type,
        payload: finalPayload || {},
      });
    }
  } catch (e) {
    console.error('[print-worker] error batch:', e?.message || e);
  } finally {
    isProcessingPrintQueue = false;
  }
}

/** Re-intenta jobs 'failed' mientras attempts < maxAttempts */
async function retryFailedPrints(io, maxAttempts = 5) {
  try {
    const { PrintOutbox, TicketRegistration } = require('../models');
    const failed = await PrintOutbox.findAll({
      where: { status: 'failed' },
      limit: 100,
    });

    for (const job of failed) {
      if ((job.attempts || 0) >= maxAttempts) {
        await job.update({ status: 'dead' });
        if (job.ticket_id) {
          await TicketRegistration.update(
            { printStatus: 'error' }, // <-- atributo correcto
            { where: { idTicketRegistration: job.ticket_id } }
          );
        }
        continue;
      }
      await job.update({ status: 'pending' });
      if (job.ticket_id) {
        await TicketRegistration.update(
          { printStatus: 'pending' }, // <-- atributo correcto
          { where: { idTicketRegistration: job.ticket_id } }
        );
      }
    }
  } catch (e) {
    console.error('[print-worker] retry error:', e?.message || e);
  }
}

/** Re-encola 'sent' sin ACK tras ttlMs (timeout) */
async function requeueStuckSentJobs(ttlMs = 45_000, maxAttempts = 5) {
  try {
    const { PrintOutbox, TicketRegistration } = require('../models');
    const cutoff = new Date(Date.now() - ttlMs);

    const stuck = await PrintOutbox.findAll({
      where: { status: 'sent', updatedAt: { [Op.lt]: cutoff } },
      limit: 100,
    });

    for (const job of stuck) {
      if ((job.attempts || 0) >= maxAttempts) {
        await job.update({ status: 'dead', last_error: 'ack timeout (dead)' });
        if (job.ticket_id) {
          await TicketRegistration.update(
            { printStatus: 'error' }, // <-- atributo correcto
            { where: { idTicketRegistration: job.ticket_id } }
          );
        }
        continue;
      }
      await job.update({
        status: 'failed',
        attempts: (job.attempts || 0) + 1,
        last_error: 'ack timeout',
      });
      if (job.ticket_id) {
        await TicketRegistration.update(
          { printStatus: 'pending' }, // <-- atributo correcto
          { where: { idTicketRegistration: job.ticket_id } }
        );
      }
    }
  } catch (e) {
    console.error('[print-worker] requeue stuck error:', e?.message || e);
  }
}

module.exports = {
  init: (httpServer, opts = {}) => {
    io = new Server(httpServer, {
      cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] },
      pingTimeout: 30000,
      pingInterval: 25000,
      ...opts,
    });

    io.on('connection', (socket) => {
      console.log('[socket] Cliente conectado:', socket.id);

      // --- Registro de usuario general
      socket.on('register-user', ({ idUser, username, fullName }) => {
        if (!idUser) {
          console.warn(`[socket] register-user inválido desde ${socket.id}:`, { idUser, username, fullName });
          return;
        }
        socket.userInfo = { idUser, username, fullName };
        socket.join(`user-${idUser}`);
        console.log(`[socket] Usuario ${idUser} (${username}) registrado en socket ${socket.id} y room 'user-${idUser}'`);
      });

      // --- Registro del cajero en un servicio
      socket.on('register-cashier', ({ idCashier, prefix, idUser }) => {
        if (!idCashier || !prefix || typeof prefix !== 'string') {
          console.warn(`[socket] register-cashier inválido desde ${socket.id}:`, { idCashier, prefix, idUser });
          return;
        }

        const room = prefix.toLowerCase();
        socket.join(room);
        socket.join(`cashier:${idCashier}`);

        if (!serviceQueues.has(room)) {
          serviceQueues.set(room, { cashiers: new Map() });
        }
        serviceQueues.get(room).cashiers.set(socket.id, {
          idCashier,
          currentTicket: null,
          idUser: idUser || null
        });

        socket.cashierInfo = { idCashier, prefix: room, idUser: idUser || null };
        console.log(`[socket] Cajero ${idCashier} (user: ${idUser}) registrado en servicio '${room}' con socket ${socket.id}`);

        restoreCashierState(idCashier, prefix) .catch(e => console.error('[socket] restoreCashierState:', e?.message || e));
        setTimeout(async () => {
          await module.exports.redistributeTickets(prefix);
          console.log(`[socket] Redistribución completada para cajero ${idCashier} en ${prefix}`);
        }, 500);
      });

      // --- Join genérico
      socket.on("join", (room) => {
        if (!room || typeof room !== "string") {
          console.warn(`[socket] join inválido desde ${socket.id}:`, room);
          return;
        }
        socket.join(room);
        console.log(`[socket] ${socket.id} se unió al room '${room}'`);
      });

      // --- Bridge de impresión
      socket.on("register-bridge", async ({ locationId }) => {
        if (!locationId || typeof locationId !== "string") {
          console.warn(`[socket] register-bridge inválido:`, locationId);
          return;
        }
        const room = `bridge:${locationId}`;
        socket.join(room);
        console.log(`[socket] Bridge ${socket.id} registrado en room '${room}'`);

        // Reabrir 'sent' viejos de esta location y procesar ya (evita esperar TTL)
        try {
          const { PrintOutbox } = require('../models');
          const cutoff = new Date(Date.now() - 10_000);
          await PrintOutbox.update(
            { status: 'pending' },
            { where: { status: 'sent', location_id: locationId, updatedAt: { [Op.lt]: cutoff } } }
          );
        } catch (e) {
          console.warn('[socket] requeue sent-on-bridge-register error:', e?.message || e);
        }
        setTimeout(() => processPrintQueueBatch(io, 15), 200);
      });

      // --- Suscripciones para pantallas
      socket.on("subscribe-prefix", ({ prefix }) => {
        if (!prefix || typeof prefix !== "string") {
          console.warn(`[socket] subscribe-prefix inválido:`, prefix);
          return;
        }
        const room = prefix.toLowerCase();
        socket.join(room);
        console.log(`[socket] ${socket.id} suscrito a room prefix '${room}'`);
      });

      socket.on("subscribe-tv", () => {
        socket.join("tv");
        socket.emit("subscribed-tv", { ok: true, room: "tv" });
        console.log(`[socket] ${socket.id} suscrito al room global 'tv'`);
      });

      // --- Llamada de ticket (excluye al emisor en el room)
      socket.on("call-ticket", (payload = {}) => {
        try {
          const { prefix } = payload || {};
          const room = typeof prefix === "string" ? prefix.toLowerCase() : null;

          payload._fromSocketId = socket.id;
          payload._fromCashierId = socket.cashierInfo?.idCashier ?? null;

          if (room) {
            socket.to(room).emit("call-ticket", payload);
            console.log(`[socket] call-ticket → room '${room}' (excluding sender):`, payload);
          }

          io.to("tv").emit("call-ticket", payload);
          console.log("[socket] call-ticket → room 'tv':", payload);
        } catch (e) {
          console.error("[socket] call-ticket handler error:", e?.message || e);
        }
      });

      // --- ACK desde bridge de impresión (idempotente)
      socket.on('print-ack', async ({ jobId, ok, error }) => {
        try {
          const { PrintOutbox, TicketRegistration } = require('../models');
          if (!jobId) return;

          const job = await PrintOutbox.findByPk(jobId);
          if (!job) {
            console.warn(`[socket] print-ack: jobId=${jobId} no encontrado`);
            return;
          }

          if (job.status === 'done' || job.status === 'dead') {
            console.log(`[socket] print-ack: jobId=${jobId} ignorado (status=${job.status})`);
            return;
          }

          console.log(`[socket] print-ack jobId=${jobId} ok=${ok} err=${error || ''}`);

          if (ok) {
            await job.update({ status: 'done', last_error: null });
            if (job.ticket_id) {
              await TicketRegistration.update(
                { printStatus: 'printed', printedAt: new Date() }, // atributo + fecha local del server
                { where: { idTicketRegistration: job.ticket_id } }
              );
            }
            console.log(`[socket] jobId=${jobId} → done; ticket_id=${job.ticket_id || '—'} → printed`);
          } else {
            await job.update({ status: 'failed', last_error: error || 'unknown error' });
            if (job.ticket_id) {
              await TicketRegistration.update(
                { printStatus: 'error' },
                { where: { idTicketRegistration: job.ticket_id } }
              );
            }
            console.warn(`[socket] jobId=${jobId} → failed (${error || 'unknown'})`);
          }
        } catch (e) {
          console.error('[socket] print-ack handler error:', e?.message || e);
        }
      });

      // --- Debug ping
      socket.on("ping-check", () => {
        socket.emit("pong-check", { at: Date.now() });
      });

      socket.on("disconnect", (reason) => {
        console.log(`[socket] Cliente desconectado: ${socket.id}. Motivo: ${reason}`);
        if (socket.cashierInfo) {
          const { idCashier, prefix } = socket.cashierInfo;
          if (serviceQueues.has(prefix)) {
            serviceQueues.get(prefix).cashiers.delete(socket.id);
            console.log(`[socket] Cajero ${idCashier} removido del servicio '${prefix}'`);
            setTimeout(() => {
              module.exports.redistributeTickets(prefix.toUpperCase());
            }, 1000);
          }
          cashierCurrentDisplay.delete(idCashier);
        }
        for (const [key, value] of cashierTickets.entries()) {
          if (value.socketId === socket.id) {
            cashierTickets.delete(key);
            console.log(`[socket] Ticket ${key} liberado del cajero desconectado`);
          }
        }
      });
    });

    // Iniciar workers de impresión
    if (!printWorkerInterval) {
      printWorkerInterval = setInterval(() => processPrintQueueBatch(io, 15), 5000);
      setInterval(() => retryFailedPrints(io, 5), 60_000);
      setInterval(() => requeueStuckSentJobs(45_000, 5), 30_000);
      console.log('[socket] Print worker iniciado (cola cada 5s, retry cada 60s, timeout ACK cada 30s)');
    }

    return io;
  },

  getIo: () => {
    if (!io) throw new Error("Socket.IO no inicializado");
    return io;
  },

  // ---- utilidades negocio
  safeEmit: (event, payload) => {
    try { if (!io) throw new Error("io no inicializado"); io.emit(event, payload); }
    catch (e) { console.error("[socket:safeEmit] error:", e?.message || e); }
  },

  emitToRoom: (room, event, payload) => {
    try { if (!io) throw new Error("io no inicializado"); if (!room || typeof room !== "string") throw new Error("room inválido"); io.to(room).emit(event, payload); }
    catch (e) { console.error("[socket:emitToRoom] error:", e?.message || e); }
  },

  emitToPrefix: (prefix, event, payload) => {
    try { if (!io) throw new Error("io no inicializado"); if (!prefix || typeof prefix !== "string") throw new Error("prefix inválido"); const room = prefix.toLowerCase(); io.to(room).emit(event, payload); }
    catch (e) { console.error("[socket:emitToPrefix] error:", e?.message || e); }
  },

  emitToPrefixExcludingCashier: (prefix, event, payload, excludeCashierId) => {
    try {
      if (!io) throw new Error("io no inicializado");
      if (!prefix || typeof prefix !== "string") throw new Error("prefix inválido");
      const room = prefix.toLowerCase();
      const serviceInfo = serviceQueues.get(room);
      if (!serviceInfo) {
        console.log(`[socket:emitToPrefixExcludingCashier] No hay info para servicio ${prefix}`);
        return;
      }
      let emitCount = 0;
      for (const [socketId, cashierInfo] of serviceInfo.cashiers) {
        if (excludeCashierId && cashierInfo.idCashier === excludeCashierId) continue;
        const socket = io.sockets.sockets.get(socketId);
        if (socket) { socket.emit(event, payload); emitCount++; }
      }
      console.log(`[socket:emitToPrefixExcludingCashier] Evento ${event} enviado a ${emitCount} cajeros (excluyendo ${excludeCashierId})`);
    } catch (e) {
      console.error("[socket:emitToPrefixExcludingCashier] error:", e?.message || e);
    }
  },

  emitToAvailableCashiers: async (prefix, event, payload, excludeCashierId = null) => {
    try {
      if (!io) throw new Error("io no inicializado");
      if (!prefix || typeof prefix !== "string") throw new Error("prefix inválido");
      const room = prefix.toLowerCase();
      const serviceInfo = serviceQueues.get(room);
      if (!serviceInfo) { console.log(`[socket:emitToAvailableCashiers] No hay info para servicio ${prefix}`); return; }

      const serviceId = await getServiceIdByPrefix(prefix);
      if (!serviceId) { console.log(`[socket:emitToAvailableCashiers] Servicio inexistente: ${prefix}`); return; }

      const { TicketRegistration } = require('../models');

      const assignedTickets = await TicketRegistration.findAll({
        where: {
          idTicketStatus: 2,
          idService: serviceId,
          idCashier: { [Op.ne]: null },
          status: true
        }
      });

      const busyCashiers = new Set(assignedTickets.map(t => t.idCashier).filter(Boolean));
      console.log(`[socket:emitToAvailableCashiers] Cajeros ocupados: [${Array.from(busyCashiers).join(', ')}]`);

      let emitCount = 0;
      for (const [socketId, cashierInfo] of serviceInfo.cashiers) {
        if (excludeCashierId && cashierInfo.idCashier === excludeCashierId) continue;
        if (busyCashiers.has(cashierInfo.idCashier)) continue;
        const socket = io.sockets.sockets.get(socketId);
        if (socket) { socket.emit(event, payload); emitCount++; console.log(`[socket:emitToAvailableCashiers] Enviando ${event} a cajero disponible: ${cashierInfo.idCashier}`); }
      }
      console.log(`[socket:emitToAvailableCashiers] Evento ${event} enviado a ${emitCount} cajeros disponibles (excluyendo dispatch:${excludeCashierId}, ocupados:${busyCashiers.size})`);
    } catch (e) {
      console.error("[socket:emitToAvailableCashiers] error:", e?.message || e);
    }
  },

  emitToBridge: (locationId, event, payload) => {
    try {
      if (!io) throw new Error("io no inicializado");
      if (!locationId || typeof locationId !== "string") throw new Error("locationId inválido");
      const room = `bridge:${locationId}`;
      io.to(room).emit(event, payload);
    } catch (e) {
      console.error("[socket:emitToBridge] error:", e?.message || e);
    }
  },

  closeIo: async () => {
    try { if (!io) return; await new Promise((res) => io.close(() => res())); io = undefined; }
    catch (e) { console.error("[socket:closeIo] error:", e?.message || e); }
  },

  // ---- negocio tickets
  assignTicketToCashier: (idCashier, ticket, socketId = null) => {
    try {
      const key = `${ticket.prefix}_${idCashier}`;
      cashierTickets.set(key, { idCashier, idTicket: ticket.idTicketRegistration, prefix: ticket.prefix, ticket, socketId });
      console.log(`[socket] Ticket ${ticket.correlativo} asignado a cajero ${idCashier}`);
    } catch (e) {
      console.error('[socket:assignTicketToCashier] error:', e?.message || e);
    }
  },

  releaseTicketFromCashier: (idCashier, prefix) => {
    try {
      const key = `${prefix}_${idCashier}`;
      const removed = cashierTickets.delete(key);
      if (removed) console.log(`[socket] Ticket liberado del cajero ${idCashier} en servicio ${prefix}`);
      return removed;
    } catch (e) {
      console.error('[socket:releaseTicketFromCashier] error:', e?.message || e);
    }
  },

  getCashierCurrentTicket: (idCashier) => {
    try { return cashierCurrentDisplay.get(idCashier); }
    catch (e) { console.error('[socket:getCashierCurrentTicket] error:', e?.message || e); return null; }
  },

  getServiceState: (prefix) => {
    try {
      const room = prefix.toLowerCase();
      const serviceInfo = serviceQueues.get(room);
      if (!serviceInfo) return null;
      const cashiers = Array.from(serviceInfo.cashiers.entries()).map(([socketId, info]) => ({
        socketId, ...info, currentDisplay: cashierCurrentDisplay.get(info.idCashier)
      }));
      return { prefix, room, cashiersConnected: cashiers.length, cashiers };
    } catch (e) {
      console.error('[socket:getServiceState] error:', e?.message || e);
      return null;
    }
  },

// --- dentro de module.exports = { ... } ---
// Reemplaza notifyTicketChange COMPLETO por este:

notifyTicketChange: async (prefix, actionType, ticket, assignedToCashier = null) => {
  try {
    if (!io) throw new Error('io no inicializado');

    // Clona el ticket para no mutar referencias ajenas
    let enrichedTicket = { ...ticket };
    let targetPrefix = prefix;

    // ⚠️ Cuando hay asignación/traslado, forzamos servicio del cajero destino
    if ((actionType === 'assigned' || actionType === 'transferred') && assignedToCashier != null) {
      const { Cashier, Service } = require('../models');

      // Obtenemos el servicio del cajero destino
      const cashier = await Cashier.findByPk(assignedToCashier, {
        attributes: ['idCashier', 'idService'],
        include: [{ model: Service, attributes: ['idService', 'prefix'] }],
      });

      if (cashier) {
        const srvId = Number(cashier.idService);
        const srvPrefix = (cashier.Service && cashier.Service.prefix)
          ? String(cashier.Service.prefix)
          : String(targetPrefix || '');

        // Inyecta SIEMPRE el servicio destino al payload
        enrichedTicket.idService = srvId;
        enrichedTicket.prefix = srvPrefix.toUpperCase();

        // El room a notificar debe ser el del servicio DESTINO
        targetPrefix = srvPrefix;
      }
    }

    const room = String(targetPrefix || prefix || '').toLowerCase();

    if (actionType === 'assigned') {
      // Mantén el estado actual del cajero
      cashierCurrentDisplay.set(assignedToCashier, { currentTicket: enrichedTicket, isAssigned: true });

      // ✅ Envía directo al cajero destino (aunque no esté suscrito al room)
      emitToCashierDirect(assignedToCashier, 'ticket-assigned', {
        ticket: enrichedTicket,
        assignedToCashier,
        timestamp: Date.now(),
      });

      // ✅ Emite al servicio DESTINO
      io.to(room).emit('ticket-assigned', {
        ticket: enrichedTicket,
        assignedToCashier,
        timestamp: Date.now(),
      });

      // ✅ Emite también a TVs
      io.to('tv').emit('ticket-assigned', {
        ticket: enrichedTicket,
        assignedToCashier,
        timestamp: Date.now(),
      });

      console.log(`[socket] Ticket ${enrichedTicket.correlativo} assigned → cashier ${assignedToCashier} (room:${room}, prefix:${enrichedTicket.prefix})`);

    } else if (actionType === 'transferred') {
      // Para transferencias, esperamos que el controlador nos llame con from/to y queued.
      // Si llegaste aquí con 'transferred' y 'assignedToCashier', hacemos un broadcast básico:
      io.to(room).emit('ticket-transferred', {
        ticket: enrichedTicket,
        fromCashierId: ticket.idCashier ?? null,
        toCashierId: assignedToCashier,
        queued: true, // por defecto; si tu controlador sabe si va a cola o en atención, usa el helper de abajo
        timestamp: Date.now(),
      });
      io.to('tv').emit('ticket-transferred', {
        ticket: enrichedTicket,
        fromCashierId: ticket.idCashier ?? null,
        toCashierId: assignedToCashier,
        queued: true,
        timestamp: Date.now(),
      });

      console.log(`[socket] Ticket ${enrichedTicket.correlativo} transferred → to cashier ${assignedToCashier} (room:${room}, prefix:${enrichedTicket.prefix})`);

    } else if (actionType === 'completed') {
      cashierCurrentDisplay.delete(assignedToCashier);

      io.to(room).emit('ticket-completed', {
        ticket: enrichedTicket,
        completedByCashier: assignedToCashier,
        timestamp: Date.now(),
      });

      io.to('tv').emit('ticket-completed', {
        ticket: enrichedTicket,
        completedByCashier: assignedToCashier,
        timestamp: Date.now(),
      });

      console.log(`[socket] Ticket ${enrichedTicket.correlativo} completed by cashier ${assignedToCashier} (room:${room})`);

      // Empuja el siguiente SOLO a ese cajero, usando el servicio actual
      await pickNextForCashier(targetPrefix, assignedToCashier);
    }
  } catch (e) {
    console.error('[socket:notifyTicketChange] error:', e?.message || e);
  }
},
notifyTicketTransferred: async (ticket, fromCashierId, toCashierId, queued = true) => {
  try {
    if (!io) throw new Error('io no inicializado');
    const { Cashier, Service } = require('../models');

    // Servicio destino por el cajero destino
    const cashier = await Cashier.findByPk(toCashierId, {
      attributes: ['idCashier', 'idService'],
      include: [{ model: Service, attributes: ['idService', 'prefix'] }],
    });

    // Enriquecer ticket con servicio destino
    let enrichedTicket = { ...ticket };
    let destPrefix = ticket.prefix || '';
    if (cashier) {
      const srvId = Number(cashier.idService);
      const srvPrefix = (cashier.Service && cashier.Service.prefix)
        ? String(cashier.Service.prefix)
        : String(destPrefix || '');
      enrichedTicket.idService = srvId;
      enrichedTicket.prefix = srvPrefix.toUpperCase();
      destPrefix = srvPrefix;
    }

    const room = String(destPrefix).toLowerCase();

    // Broadcast a servicio destino y TV
    io.to(room).emit('ticket-transferred', {
      ticket: enrichedTicket,
      fromCashierId,
      toCashierId,
      queued: !!queued,
      timestamp: Date.now(),
    });
    io.to('tv').emit('ticket-transferred', {
      ticket: enrichedTicket,
      fromCashierId,
      toCashierId,
      queued: !!queued,
      timestamp: Date.now(),
    });

    console.log(`[socket] ticket-transferred → ${enrichedTicket.correlativo} from:${fromCashierId} to:${toCashierId} queued:${queued} (prefix:${enrichedTicket.prefix}, room:${room})`);
  } catch (e) {
    console.error('[socket:notifyTicketTransferred] error:', e?.message || e);
  }
},

  redistributeTickets: async (prefix) => {
    try {
      if (!io) throw new Error('io no inicializado');

      const room = prefix.toLowerCase();
      const serviceInfo = serviceQueues.get(room);
      if (!serviceInfo || serviceInfo.cashiers.size === 0) {
        console.log(`[socket] No hay cajeros conectados en servicio ${prefix}`);
        return;
      }

      const serviceId = await getServiceIdByPrefix(prefix);
      if (!serviceId) {
        console.log(`[socket] Servicio no encontrado para prefix ${prefix}`);
        return;
      }

      const { TicketRegistration } = require('../models');

      const tickets = await TicketRegistration.findAll({
        where: {
          idTicketStatus: 1,
          idService: serviceId,
          status: true,
          forcedToCashierId: null, // 👈 redistribución general solo con libres
        },
        order: [['turnNumber', 'ASC']]
      });

      if (tickets.length === 0) {
        console.log(`[socket] No hay tickets pendientes en servicio ${prefix}`);
        for (const [socketId, cashierInfo] of serviceInfo.cashiers) {
          const socket = io.sockets.sockets.get(socketId);
          if (socket) {
                      const hasDisplay = cashierCurrentDisplay.has(cashierInfo.idCashier);
       if (!hasDisplay) socket.emit('no-tickets-available', { timestamp: Date.now() });
          }
        }
        return;
      }

      const assignedTickets = await TicketRegistration.findAll({
        where: {
          idTicketStatus: 2,
          idService: serviceId,
          idCashier: { [Op.ne]: null },
          status: true
        }
      });

      const busyCashiers = new Set(assignedTickets.map(t => t.idCashier).filter(Boolean));
      console.log(`[socket] Cajeros ocupados (idCashier): [${Array.from(busyCashiers).join(', ')}]`);

      const availableCashiers = [];
      for (const [socketId, cashierInfo] of serviceInfo.cashiers) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket && !busyCashiers.has(cashierInfo.idCashier)) {
          if (cashierCurrentDisplay.has(cashierInfo.idCashier)) continue;
          availableCashiers.push({ socketId, idCashier: cashierInfo.idCashier });
        }
      }

      console.log(`[socket] Redistribuyendo tickets. Pendientes libres: ${tickets.length}, Disponibles: ${availableCashiers.length}, Ocupados:${busyCashiers.size}`);

      if (tickets.length > 0 && availableCashiers.length > 0) {
        const nextTicket = tickets[0];
        const ticketPayload = toDisplayPayload(prefix, nextTicket);

        availableCashiers.forEach(cashier => {
          const socket = io.sockets.sockets.get(cashier.socketId);
          if (!socket) return;
          if (busyCashiers.has(cashier.idCashier)) return;
          if (cashierCurrentDisplay.has(cashier.idCashier)) return;
          cashierCurrentDisplay.set(cashier.idCashier, { currentTicket: ticketPayload, isAssigned: false });
          socket.emit('update-current-display', { ticket: ticketPayload, isAssigned: false, timestamp: Date.now() });
          console.log(`[socket] Cajero ${cashier.idCashier} ahora ve ticket ${nextTicket.correlativo} (no asignado)`);
        });
      }
    } catch (e) {
      console.error('[socket:redistributeTickets] error:', e?.message || e);
    }
  },

  broadcastNextPendingToOthers: async (prefix, excludeCashierId = null) => {
    try {
      if (!io) return;
      const room = prefix.toLowerCase();
      const serviceInfo = serviceQueues.get(room);
      if (!serviceInfo) return;

      const serviceId = await getServiceIdByPrefix(prefix);
      if (!serviceId) {
        console.log(`[socket:broadcastNextPendingToOthers] Servicio no encontrado para prefix ${prefix}`);
        return;
      }

      const { TicketRegistration } = require('../models');

      const next = await TicketRegistration.findOne({
        where: {
          idTicketStatus: 1,
          idService: serviceId,
          status: true,
          forcedToCashierId: null,
        },
        order: [['turnNumber', 'ASC']],
      });

      if (!next) {
        console.log(`[socket] No hay siguiente ticket pendiente libre para broadcast en ${prefix}`);
        return;
      }

      const assigned = await TicketRegistration.findAll({
        where: {
          idTicketStatus: 2,
          idService: serviceId,
          idCashier: { [Op.ne]: null },
          status: true,
        },
      });
      const busy = new Set(assigned.map(t => t.idCashier).filter(Boolean));

      const payload = toDisplayPayload(prefix, next);

      let broadcastCount = 0;
      for (const [socketId, info] of serviceInfo.cashiers) {
        if (excludeCashierId && info.idCashier === excludeCashierId) continue;
        if (busy.has(info.idCashier)) continue;
        if (cashierCurrentDisplay.has(info.idCashier)) continue;
        const s = io.sockets.sockets.get(socketId);
        if (!s) continue;

        cashierCurrentDisplay.set(info.idCashier, { currentTicket: payload, isAssigned: false });
        s.emit('update-current-display', { ticket: payload, isAssigned: false, timestamp: Date.now() });
        broadcastCount++;
        console.log(`[socket:broadcastNextPendingToOthers] Enviando siguiente libre a cajero disponible: ${info.idCashier}`);
      }

      console.log(`[socket:broadcastNextPendingToOthers] Broadcast de ${next.correlativo} a ${broadcastCount} cajeros disponibles (excluyendo dispatch:${excludeCashierId}, ocupados:${busy.size})`);
    } catch (e) {
      console.error('[socket:broadcastNextPendingToOthers] error:', e?.message || e);
    }
  },

  forceLogoutUser: (idUser, reason = 'Cambio de ventanilla') => {
    try {
      console.log(`[socket:forceLogoutUser] Iniciando cierre de sesión para usuario ${idUser}, razón: ${reason}`);
      if (!io) { console.warn('[socket:forceLogoutUser] Socket.IO no inicializado'); return 0; }

      let loggedOutSockets = 0;

      for (const [, serviceInfo] of serviceQueues) {
        for (const [socketId, cashierInfo] of serviceInfo.cashiers) {
          if (cashierInfo.idUser === idUser) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) {
              socket.emit('force-logout', {
                reason,
                message: 'Tu sesión ha sido cerrada porque se cambió tu ventanilla asignada.',
                timestamp: Date.now()
              });
              setTimeout(() => socket.disconnect(true), 1000);
              loggedOutSockets++;
            }
          }
        }
      }

      if (loggedOutSockets === 0) {
        for (const [, socket] of io.sockets.sockets) {
          if (socket.userInfo && socket.userInfo.idUser === idUser) {
            socket.emit('force-logout', {
              reason,
              message: 'Tu sesión ha sido cerrada porque se cambió tu ventanilla asignada.',
              timestamp: Date.now()
            });
            setTimeout(() => socket.disconnect(true), 1000);
            loggedOutSockets++;
          }
        }
      }

      if (loggedOutSockets === 0) {
        const userRoom = `user-${idUser}`;
        const socketsInRoom = io.sockets.adapter.rooms.get(userRoom);
        if (socketsInRoom && socketsInRoom.size > 0) {
          io.to(userRoom).emit('force-logout', {
            reason,
            message: 'Tu sesión ha sido cerrada porque se cambió tu ventanilla asignada.',
            timestamp: Date.now()
          });
          loggedOutSockets = socketsInRoom.size;
          setTimeout(() => {
            for (const socketId of socketsInRoom) {
              const socket = io.sockets.sockets.get(socketId);
              if (socket) socket.disconnect(true);
            }
          }, 1000);
        }
      }

      console.log(`[socket:forceLogoutUser] RESULTADO: Sesiones cerradas para usuario ${idUser}: ${loggedOutSockets}`);
      return loggedOutSockets;
    } catch (e) {
      console.error('[socket:forceLogoutUser] error:', e?.message || e);
      return 0;
    }
  },

  // 👉 Exportamos para que el controlador pueda llamarlo
  pickNextForCashier,
};
