// server/socket.js
const { Server } = require('socket.io');
const { Op } = require('sequelize');

let io;
// === Unicidad de sesión/ventanilla ===
const userActiveSocket = new Map();    // Map<idUser, socketId>
const cashierActiveSocket = new Map(); // Map<idCashier, socketId>
// Estados en memoria (negocio de cajeros)
const cashierTickets = new Map();        // Map<prefix_idCashier, {...}>
const serviceQueues = new Map();         // Map<room, {cashiers: Map<socketId, {idCashier, currentTicket, idUser}>}>
const cashierCurrentDisplay = new Map(); // Map<idCashier, {currentTicket, isAssigned}>

// Worker de impresión
let printWorkerInterval = null;
let isProcessingPrintQueue = false;
// ============================
//  TTS Global (serialización total)
// ============================
const SERIALIZE_ALL_PREFIXES = true;           // 🔴 Activa cola global (uno por uno)
const ALLOW_MULTIPLE_ANNOUNCERS = false;       // 🔴 Solo un announcer activo
let activeAnnouncerId = null;                  // socket.id del announcer líder

const ttsGlobalQueue = [];     // [{ id, prefix, ttsText, numero, ventanilla, moduleName, raw }]
let  ttsGlobalProcessing = false;

// Helper: encolar item integrado
function makeTtsItem(rawPayload = {}) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    prefix: svcKey(rawPayload?.prefix),
    ttsText: String(rawPayload?.ttsText || ''),
    numero: rawPayload?.numero || null,
    ventanilla: rawPayload?.ventanilla || null,
    moduleName: rawPayload?.moduleName || null,
    raw: rawPayload,
  };
}
/* ============================
   Cola TTS (Text-to-Speech) centralizada
============================ */
const ttsQueues = new Map();          // Map<prefix, Array<item>>
const ttsProcessing = new Map();      // Map<prefix, boolean>
const announcerSockets = new Set();   // Set<socketId> que son TVs anunciadoras
const FALLBACK_BROADCAST_WHEN_NO_ANNOUNCER = true; // si no hay TV, solo avisamos a 'tv' (sin TTS)

const svcKey = (p) => String(p || 'default').toLowerCase();

function enqueueTtsCall(rawPayload = {}) {
  // Modo global (serialización total)
  if (SERIALIZE_ALL_PREFIXES) {
    const item = makeTtsItem(rawPayload);
    ttsGlobalQueue.push(item);

    // Aviso opcional a monitores
    if (io) {
      io.to('announcer').emit('tts-queued', { globalSize: ttsGlobalQueue.length });
    }
    processTtsGlobalQueue();
    return;
  }

  // === Modo antiguo por prefix (por si lo necesitas) ===
  const key = svcKey(rawPayload?.prefix);
  const item = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    prefix: key,
    ttsText: String(rawPayload?.ttsText || ''),
    numero: rawPayload?.numero || null,
    ventanilla: rawPayload?.ventanilla || null,
    moduleName: rawPayload?.moduleName || null,
    raw: rawPayload,
  };

  const q = ttsQueues.get(key) || [];
  q.push(item);
  ttsQueues.set(key, q);

  if (io) io.to('announcer').emit('tts-queued', { prefix: key, size: q.length });
  processTtsQueue(key);
}


function processTtsQueue(prefix) {
  if (!io) return;
  const key = svcKey(prefix);
  if (ttsProcessing.get(key)) return;

  const q = ttsQueues.get(key) || [];
  if (q.length === 0) return;

  const haveAnnouncers =
    io.sockets.adapter.rooms.get('announcer') &&
    io.sockets.adapter.rooms.get('announcer').size > 0;

  if (!haveAnnouncers && FALLBACK_BROADCAST_WHEN_NO_ANNOUNCER) {
    const head = q.shift();
    ttsQueues.set(key, q);
    // ✅ SOLO UI silenciosa al room del servicio
    io.to(key).emit('call-ticket-ui', head?.raw || {});
    // ❌ ya NO: io.to('tv').emit('call-ticket', head.raw || {})
    setTimeout(() => processTtsQueue(key), 10);
    return;
  }
  if (!haveAnnouncers) return; // no anunciadores → esperar

  ttsProcessing.set(key, true);
  const head = q[0];

  io.to('announcer').emit('tts-play', {
    id: head.id,
    prefix: key,
    ttsText: head.ttsText,
    numero: head.numero,
    ventanilla: head.ventanilla,
    moduleName: head.moduleName,
  });

  const TIMEOUT_MS = 12000;
  let finished = false;

  const onDone = (payload = {}) => {
    if (finished) return;
    if (svcKey(payload.prefix) !== key) return;
    if (String(payload.id) !== String(head.id)) return;

    finished = true;
    cleanup();

    const nowQ = ttsQueues.get(key) || [];
    if (nowQ.length > 0 && String(nowQ[0].id) === String(head.id)) {
      nowQ.shift();
      ttsQueues.set(key, nowQ);
    }
    ttsProcessing.set(key, false);
    setTimeout(() => processTtsQueue(key), 0);
  };

  const cleanup = () => {
    io.off('tts-done', onDone);
    clearTimeout(timer);
  };

  const timer = setTimeout(() => {
    if (finished) return;
    finished = true;
    cleanup();

    const nowQ = ttsQueues.get(key) || [];
    if (nowQ.length > 0 && String(nowQ[0].id) === String(head.id)) {
      nowQ.shift();
      ttsQueues.set(key, nowQ);
    }
    ttsProcessing.set(key, false);
    setTimeout(() => processTtsQueue(key), 0);
  }, TIMEOUT_MS);

  io.once('tts-done', onDone);
}
function getActiveAnnouncerSocket() {
  if (!io) return null;
  if (ALLOW_MULTIPLE_ANNOUNCERS) return null; // se emitiría al room completo (no recomendado)
  if (!activeAnnouncerId) return null;
  return io.sockets.sockets.get(activeAnnouncerId) || null;
}

function processTtsGlobalQueue() {
  if (!io) return;
  if (!SERIALIZE_ALL_PREFIXES) return;
  if (ttsGlobalProcessing) return;
  if (ttsGlobalQueue.length === 0) return;

  const haveAnnouncers =
    io.sockets.adapter.rooms.get('announcer') &&
    io.sockets.adapter.rooms.get('announcer').size > 0;

  if (!haveAnnouncers && FALLBACK_BROADCAST_WHEN_NO_ANNOUNCER) {
    const head = ttsGlobalQueue.shift();
    io.to('tv').emit('call-ticket', head.raw || {}); // solo UI legacy
    // ⬇️ antes: 10ms; ahora: inmediato
    setTimeout(() => processTtsGlobalQueue(), 0);
    return;
  }
  if (!haveAnnouncers) return;

  if (!activeAnnouncerId && !ALLOW_MULTIPLE_ANNOUNCERS) {
    const room = io.sockets.adapter.rooms.get('announcer');
    if (room && room.size > 0) {
      activeAnnouncerId = Array.from(room)[0];
      const leader = io.sockets.sockets.get(activeAnnouncerId);
      if (leader) {
        leader.emit('announcer-leader', { leader: true });
      }
    }
  }

  const leaderSocket = getActiveAnnouncerSocket();

  ttsGlobalProcessing = true;
  const head = ttsGlobalQueue[0];

  if (leaderSocket && !ALLOW_MULTIPLE_ANNOUNCERS) {
    leaderSocket.emit('tts-play', {
      id: head.id,
      prefix: head.prefix,
      ttsText: head.ttsText,
      numero: head.numero,
      ventanilla: head.ventanilla,
      moduleName: head.moduleName,
    });
  } else {
    io.to('announcer').emit('tts-play', {
      id: head.id,
      prefix: head.prefix,
      ttsText: head.ttsText,
      numero: head.numero,
      ventanilla: head.ventanilla,
      moduleName: head.moduleName,
    });
  }

  // ⬇️ antes: 12000; ahora: 8000 (o el valor que prefieras)
  const TIMEOUT_MS = 8000;
  let finished = false;

  const onDone = (payload = {}) => {
    if (finished) return;
    if (String(payload.id) !== String(head.id)) return;

    finished = true;
    cleanup();

    if (ttsGlobalQueue.length > 0 && String(ttsGlobalQueue[0].id) === String(head.id)) {
      ttsGlobalQueue.shift();
    }
    ttsGlobalProcessing = false;
    setTimeout(() => processTtsGlobalQueue(), 0);
  };

  const cleanup = () => {
    io.off('tts-done', onDone);
    clearTimeout(timer);
  };

  const timer = setTimeout(() => {
    if (finished) return;
    finished = true;
    cleanup();

    if (ttsGlobalQueue.length > 0 && String(ttsGlobalQueue[0].id) === String(head.id)) {
      ttsGlobalQueue.shift();
    }
    ttsGlobalProcessing = false;
    setTimeout(() => processTtsGlobalQueue(), 0);
  }, TIMEOUT_MS);

  io.once('tts-done', onDone);
}


/* ============================
   Utils
============================ */
/** Obtiene el prefix del servicio al que pertenece un cajero (por idCashier) */
async function getPrefixByCashierId(idCashier) {
  if (!idCashier) return null;
  try {
    const { Cashier, Service } = require('../models');
    const cashier = await Cashier.findByPk(idCashier, {
      attributes: ['idCashier', 'idService'],
      include: [{ model: Service, attributes: ['idService', 'prefix'] }],
    });
    const p = cashier?.Service?.prefix;
    return p ? String(p).toUpperCase() : null;
  } catch (e) {
    console.warn('[socket:getPrefixByCashierId] error:', e?.message || e);
    return null;
  }
}

/** Al reconectar un cajero, restaurar su estado sin mutar nada:
 *  1) Si tiene EN_ATENCION → ese manda
 *  2) Si no, mostrar primer PENDIENTE reservado para él en su servicio (preferPrefix)
 *  3) Si no hay en su servicio, mostrar primer PENDIENTE reservado para él en cualquier servicio
 */
async function restoreCashierState(idCashier, preferPrefix = null) {
  try {
    const { TicketRegistration, Service, sequelize } = require('../models');

    const assigned = await TicketRegistration.findOne({
      where: { idTicketStatus: 2, idCashier: idCashier, status: true },
      include: [{ model: Service, attributes: ['prefix'] }],
      order: [['turnNumber', 'ASC']],
    });
    if (assigned) {
      const payload = toDisplayPayload(assigned.Service?.prefix, assigned);
      cashierCurrentDisplay.set(idCashier, { currentTicket: payload, isAssigned: true });
      emitToCashierDirect(idCashier, 'update-current-display', {
        ticket: payload, isAssigned: true, timestamp: Date.now(),
      });
      return;
    }

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
function toDisplayPayload(prefix, t, moduloOverride = null) {
  const pfx = (prefix ? String(prefix) : (t?.Service?.prefix || '')).toUpperCase();
  const modulo =
    moduloOverride != null
      ? String(moduloOverride)
      : (t && t.idCashier != null ? String(t.idCashier) : '—');

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
    modulo,
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
 * elige SIEMPRE el menor turnNumber entre:
 *  - pendientes forzados a ese cajero  OR  pendientes libres del servicio
 */
async function pickNextForCashier(prefix, idCashier) {
  try {
    if (!io) throw new Error('io no inicializado');

    const prefixLower = String(prefix || '').toLowerCase();
    const serviceId = await getServiceIdByPrefix(prefixLower);
    if (!idCashier) return;

    const { TicketRegistration, Service, sequelize } = require('../models');

    // 1) Primero buscar PENDIENTE de MI servicio, prefiriendo LIBRES (NULL) y luego forzados a mí
    if (!serviceId) {
      console.log(`[socket:pickNextForCashier] Sin idService para prefix ${prefixLower}`);
      emitToCashierDirect(idCashier, 'no-tickets-available', { timestamp: Date.now() });
      cashierCurrentDisplay.delete(idCashier);
      return;
    }

    const nextInMyService = await TicketRegistration.findOne({
      where: {
        idTicketStatus: 1,
        idService: serviceId,
        status: true,
      },
      include: [{ model: Service, attributes: ['prefix'] }],
      order: [
        [
          sequelize.literal(`
            CASE
              WHEN "forcedToCashierId" IS NULL THEN 0
              WHEN "forcedToCashierId" = ${idCashier} THEN 1
              ELSE 2
            END
          `),
          'ASC'
        ],
        ['turnNumber', 'ASC'],
        ['createdAt', 'ASC']
      ],
    });

    if (nextInMyService) {
      const payload = toDisplayPayload(nextInMyService.Service?.prefix || prefixLower, nextInMyService, idCashier);
      cashierCurrentDisplay.set(idCashier, { currentTicket: payload, isAssigned: false });
      emitToCashierDirect(idCashier, 'update-current-display', {
        ticket: payload,
        isAssigned: false,
        timestamp: Date.now(),
      });
      console.log(`[socket:pickNextForCashier] Enviado ${nextInMyService.correlativo} a cajero ${idCashier} (svc:${(nextInMyService.Service?.prefix || prefixLower)})`);
      return;
    }

    // 2) Si no hay en mi servicio, considerar forzados a mí en cualquier servicio
    const forcedAny = await TicketRegistration.findOne({
      where: {
        idTicketStatus: 1,
        status: true,
        forcedToCashierId: idCashier,
      },
      include: [{ model: Service, attributes: ['prefix'] }],
      order: [['turnNumber', 'ASC'], ['createdAt', 'ASC']],
    });

    if (forcedAny) {
      const forcedPrefix = forcedAny.Service?.prefix || prefixLower;
      const payload = toDisplayPayload(forcedPrefix, forcedAny, idCashier);
      cashierCurrentDisplay.set(idCashier, { currentTicket: payload, isAssigned: false });
      emitToCashierDirect(idCashier, 'update-current-display', {
        ticket: payload,
        isAssigned: false,
        timestamp: Date.now(),
      });
      console.log(`[socket:pickNextForCashier] Forzado → ${forcedAny.correlativo} a cajero ${idCashier} (svc:${forcedPrefix})`);
      return;
    }

    // 3) No hay nada
    cashierCurrentDisplay.delete(idCashier);
    emitToCashierDirect(idCashier, 'no-tickets-available', { timestamp: Date.now() });
    console.log(`[socket:pickNextForCashier] No hay siguiente para cajero ${idCashier} (svc:${prefixLower})`);
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
          { printStatus: 'sent' },
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
            { printStatus: 'error' },
            { where: { idTicketRegistration: job.ticket_id } }
          );
        }
        continue;
      }
      await job.update({ status: 'pending' });
      if (job.ticket_id) {
        await TicketRegistration.update(
          { printStatus: 'pending' },
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
            { printStatus: 'error' },
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
          { printStatus: 'pending' },
          { where: { idTicketRegistration: job.ticket_id } }
        );
      }
    }
  } catch (e) {
    console.error('[socket] requeue stuck error:', e?.message || e);
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

  // --- Registro de usuario general (único por usuario)
  socket.on('register-user', ({ idUser, username, fullName }) => {
    if (!idUser) {
      console.warn(`[socket] register-user inválido desde ${socket.id}:`, { idUser, username, fullName });
      return;
    }

    // ⇨ Cierra cualquier sesión previa de este usuario
    const prev = userActiveSocket.get(idUser);
    if (prev && prev !== socket.id) {
      const s = io.sockets.sockets.get(prev);
      if (s) {
        s.emit('session-revoked', { reason: 'Sesión iniciada en otro dispositivo' });
        setTimeout(() => s.disconnect(true), 500);
      }
    }
    userActiveSocket.set(idUser, socket.id);

    socket.userInfo = { idUser, username, fullName };
    socket.join(`user-${idUser}`);
    console.log(`[socket] Usuario ${idUser} (${username}) registrado en socket ${socket.id} y room 'user-${idUser}'`);
  });

  // --- Registro del cajero en un servicio (único por ventanilla)
  socket.on('register-cashier', ({ idCashier, prefix, idUser }) => {
    if (!idCashier || !prefix || typeof prefix !== 'string') {
      console.warn(`[socket] register-cashier inválido desde ${socket.id}:`, { idCashier, prefix, idUser });
      return;
    }

    // ⇨ Exclusivo por ventanilla: un solo socket controlándola
    const prevSock = cashierActiveSocket.get(idCashier);
    if (prevSock && prevSock !== socket.id) {
      const s = io.sockets.sockets.get(prevSock);
      if (s) {
        s.emit('cashier-taken', { reason: 'Esta ventanilla fue abierta en otra máquina' });
        setTimeout(() => s.disconnect(true), 500);
      }
    }
    cashierActiveSocket.set(idCashier, socket.id);

    // ⇨ Opcional: fuerza unicidad también por usuario (si vino)
    if (idUser) {
      const prevUserSock = userActiveSocket.get(idUser);
      if (prevUserSock && prevUserSock !== socket.id) {
        const s = io.sockets.sockets.get(prevUserSock);
        if (s) {
          s.emit('session-revoked', { reason: 'Sesión iniciada en otra máquina' });
          setTimeout(() => s.disconnect(true), 500);
        }
      }
      userActiveSocket.set(idUser, socket.id);
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
      idUser: idUser || null,
    });

    socket.cashierInfo = { idCashier, prefix: room, idUser: idUser || null };
    console.log(`[socket] Cajero ${idCashier} (user: ${idUser}) registrado en servicio '${room}' con socket ${socket.id}`);

    restoreCashierState(idCashier, prefix).catch(e => console.error('[socket] restoreCashierState:', e?.message || e));
    setTimeout(async () => {
      await module.exports.redistributeTickets(room);
      console.log(`[socket] Redistribución completada para cajero ${idCashier} en ${room}`);
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

  // === Registrar TV como "anunciador" TTS ===
  socket.on('register-announcer', () => {
    socket.join('announcer');
    announcerSockets.add(socket.id);
    console.log(`[socket] ${socket.id} registrado como announcer (TV). Total: ${announcerSockets.size}`);

    if (!ALLOW_MULTIPLE_ANNOUNCERS) {
      if (!activeAnnouncerId) {
        activeAnnouncerId = socket.id;
        socket.emit('announcer-leader', { leader: true });
        console.log(`[socket] announcer líder: ${activeAnnouncerId}`);
      } else {
        socket.emit('announcer-leader', { leader: false });
      }
    }

    if (SERIALIZE_ALL_PREFIXES) {
      setTimeout(() => processTtsGlobalQueue(), 20);
    } else {
      for (const key of ttsQueues.keys()) {
        setTimeout(() => processTtsQueue(key), 20);
      }
    }
  });

  // === Llamada de ticket → encola TTS global y UI silenciosa por servicio ===
  socket.on("call-ticket", (payload = {}) => {
    try {
      payload._fromSocketId = socket.id;
      payload._fromCashierId = socket.cashierInfo?.idCashier ?? null;

      enqueueTtsCall(payload);

      const room = typeof payload.prefix === "string" ? payload.prefix.toLowerCase() : null;
      if (room) {
        io.to(room).emit("call-ticket-ui", payload);
      }
      console.log(`[socket] call-ticket encolado → prefix:${payload?.prefix} correlativo:${payload?.numero}`);
    } catch (e) {
      console.error("[socket] call-ticket handler error:", e?.message || e);
    }
  });

  // === Confirmación fin de TTS desde TV (libera la cola) ===
  socket.on('tts-done', (payload = {}) => {
    try { io.emit('tts-done', payload); }
    catch (e) { console.error('[socket] tts-done handler error:', e?.message || e); }
  });

  // --- Debug ping
  socket.on("ping-check", () => {
    socket.emit("pong-check", { at: Date.now() });
  });

  socket.on("disconnect", (reason) => {
    console.log(`[socket] Cliente desconectado: ${socket.id}. Motivo: ${reason}`);

    // Limpia líder/announcers
    if (announcerSockets.has(socket.id)) {
      announcerSockets.delete(socket.id);
      if (activeAnnouncerId === socket.id) {
        activeAnnouncerId = null;
        if (!ALLOW_MULTIPLE_ANNOUNCERS) {
          const room = io.sockets.adapter.rooms.get('announcer');
          if (room && room.size > 0) {
            activeAnnouncerId = Array.from(room)[0];
            const leader = io.sockets.sockets.get(activeAnnouncerId);
            if (leader) leader.emit('announcer-leader', { leader: true });
            console.log(`[socket] announcer líder cambiado a: ${activeAnnouncerId}`);
          }
        }
      }
      console.log(`[socket] announcer removido: ${socket.id}. Activos: ${announcerSockets.size}`);
    }

    // Limpia unicidad por usuario
    if (socket.userInfo?.idUser && userActiveSocket.get(socket.userInfo.idUser) === socket.id) {
      userActiveSocket.delete(socket.userInfo.idUser);
    }
    // Limpia unicidad por ventanilla
    if (socket.cashierInfo?.idCashier && cashierActiveSocket.get(socket.cashierInfo.idCashier) === socket.id) {
      cashierActiveSocket.delete(socket.cashierInfo.idCashier);
    }

    if (socket.cashierInfo) {
      const { idCashier, prefix } = socket.cashierInfo;
      if (serviceQueues.has(prefix)) {
        serviceQueues.get(prefix).cashiers.delete(socket.id);
        console.log(`[socket] Cajero ${idCashier} removido del servicio '${prefix}'`);
        setTimeout(() => { module.exports.redistributeTickets(prefix); }, 1000);
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

  // ---- eventos de cambio de ticket → TVs y cajeros
  notifyTicketChange: async (prefix, actionType, ticket, assignedToCashier = null) => {
    try {
      if (!io) throw new Error('io no inicializado');

      let enrichedTicket = { ...ticket };
      let targetPrefix = prefix;
      let moduloForDisplay = null;

      if ((actionType === 'assigned' || actionType === 'transferred') && assignedToCashier != null) {
        const { Cashier, Service } = require('../models');
        const cashier = await Cashier.findByPk(assignedToCashier, {
          attributes: ['idCashier', 'idService'],
          include: [{ model: Service, attributes: ['idService', 'prefix'] }],
        });

        if (cashier) {
          const srvId = Number(cashier.idService);
          const srvPrefix = cashier.Service?.prefix ? String(cashier.Service.prefix) : String(targetPrefix || '');

          enrichedTicket.idService = srvId;
          enrichedTicket.prefix = srvPrefix.toUpperCase();
          moduloForDisplay = assignedToCashier;
          targetPrefix = srvPrefix;
        }
      }

      const room = String(targetPrefix || prefix || '').toLowerCase();

      if (actionType === 'assigned') {
        cashierCurrentDisplay.set(assignedToCashier, { currentTicket: enrichedTicket, isAssigned: true });

        const payload = {
          ticket: { ...enrichedTicket, modulo: String(moduloForDisplay ?? assignedToCashier) },
          assignedToCashier,
          timestamp: Date.now(),
        };

        emitToCashierDirect(assignedToCashier, 'ticket-assigned', payload);
        io.to(room).emit('ticket-assigned', payload);
        io.to('tv').emit('ticket-assigned', payload);

        console.log(`[socket] Ticket ${enrichedTicket.correlativo} assigned → cashier ${assignedToCashier} (room:${room}, prefix:${enrichedTicket.prefix})`);

      } else if (actionType === 'transferred') {
        const payload = {
          ticket: { ...enrichedTicket, modulo: String(moduloForDisplay ?? assignedToCashier) },
          fromCashierId: ticket.idCashier ?? null,
          toCashierId: assignedToCashier,
          queued: true,
          timestamp: Date.now(),
        };

        io.to(room).emit('ticket-transferred', payload);
        io.to('tv').emit('ticket-transferred', payload);

        console.log(`[socket] Ticket ${enrichedTicket.correlativo} transferred → to cashier ${assignedToCashier} (room:${room}, prefix:${enrichedTicket.prefix})`);

        const fromCashierId = ticket.idCashier ?? null;
        if (fromCashierId) {
          const originPrefix = await getPrefixByCashierId(fromCashierId);
          if (originPrefix) await pickNextForCashier(originPrefix, fromCashierId);
        }

      } else if (actionType === 'completed') {
        cashierCurrentDisplay.delete(assignedToCashier);

        const payload = {
          ticket: { ...enrichedTicket },
          completedByCashier: assignedToCashier,
          timestamp: Date.now(),
        };

        io.to(room).emit('ticket-completed', payload);
        io.to('tv').emit('ticket-completed', payload);

        console.log(`[socket] Ticket ${enrichedTicket.correlativo} completed by cashier ${assignedToCashier} (room:${room})`);
        await pickNextForCashier(room, assignedToCashier);

      } else if (actionType === 'cancelled') {
        cashierCurrentDisplay.delete(assignedToCashier);

        const payload = {
          ticket: { ...enrichedTicket },
          cancelledByCashier: assignedToCashier,
          timestamp: Date.now(),
        };

        io.to(room).emit('ticket-cancelled', payload);
        io.to('tv').emit('ticket-cancelled', payload);

        console.log(`[socket] Ticket ${enrichedTicket.correlativo} cancelled by cashier ${assignedToCashier} (room:${room})`);
        await pickNextForCashier(room, assignedToCashier);
      }
    } catch (e) {
      console.error('[socket:notifyTicketChange] error:', e?.message || e);
    }
  },
notifyTicketTransferred: async (ticket, fromCashierId, toCashierId, queued = true) => {
  try {
    if (!io) throw new Error('io no inicializado');
    const { Cashier, Service } = require('../models');

    const cashierTo = await Cashier.findByPk(toCashierId, {
      attributes: ['idCashier', 'idService'],
      include: [{ model: Service, attributes: ['idService', 'prefix'] }],
    });

    let enrichedTicket = { ...ticket };
    let destPrefix = ticket.prefix || '';
    if (cashierTo) {
      const srvId = Number(cashierTo.idService);
      const srvPrefix = cashierTo.Service?.prefix ? String(cashierTo.Service.prefix) : String(destPrefix || '');
      enrichedTicket.idService = srvId;
      enrichedTicket.prefix = srvPrefix.toUpperCase();
      destPrefix = srvPrefix;
    }

    const room = String(destPrefix).toLowerCase();
    const payload = {
      ticket: { ...enrichedTicket, modulo: String(toCashierId) },
      fromCashierId,
      toCashierId,
      queued: !!queued,
      timestamp: Date.now(),
    };

    // 🔹 Emitir la transferencia visual (solo UI, no prioridad inmediata)
    io.to(room).emit('ticket-transferred', payload);
    io.to('tv').emit('ticket-transferred', payload);

    console.log(`[socket] ticket-transferred → ${enrichedTicket.correlativo} from:${fromCashierId} to:${toCashierId} queued:${queued} (prefix:${enrichedTicket.prefix}, room:${room})`);

    // 🔹 Si el ticket fue transferido y está en cola (queued = true),
    //     NO lo asignamos directamente al cajero destino.
    //     Esperamos a que se vacíe la cola normal.
    if (queued) {
      console.log(`[socket] Ticket ${enrichedTicket.correlativo} queda en cola del servicio destino (${destPrefix})`);
    } else {
      // 🔹 Solo si fue asignado inmediato (autoAssignIfFree = true)
      //     mostramos al cajero destino el nuevo ticket.
      await pickNextForCashier(destPrefix, toCashierId);
    }

    // 🔹 Siempre liberar el cajero origen (buscar su siguiente)
    if (fromCashierId) {
      const originPrefix = await getPrefixByCashierId(fromCashierId);
      if (originPrefix) await pickNextForCashier(originPrefix, fromCashierId);
    }
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
          forcedToCashierId: null,
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

  broadcastNextPendingToOthers: async (prefix, excludeCashierId = null, targetCashierId = null) => {
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

      const { TicketRegistration, sequelize, Op } = require('../models');

      const next = await TicketRegistration.findOne({
        where: {
          idTicketStatus: 1,
          idService: serviceId,
          status: true,
          ...(targetCashierId
            ? { [Op.or]: [{ forcedToCashierId: targetCashierId }, { forcedToCashierId: null }] }
            : { forcedToCashierId: null }),
        },
        order: targetCashierId
          ? [
              [sequelize.literal(`CASE WHEN "forcedToCashierId" = ${Number(targetCashierId)} THEN 0 ELSE 1 END`), 'ASC'],
              ['turnNumber', 'ASC'],
              ['createdAt', 'ASC'],
            ]
          : [['turnNumber', 'ASC'], ['createdAt', 'ASC']],
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

  // Monitoreo opcional de colas TTS
  getTtsQueueSizes: () => {
    const out = {};
    for (const [k, v] of ttsQueues.entries()) out[k] = v.length;
    return out;
  },

  // 👉 Exportamos para que el controlador pueda llamarlo
  pickNextForCashier,
};
