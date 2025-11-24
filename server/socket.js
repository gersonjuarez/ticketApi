// =========================================================
//  SOCKET GLOBAL – OPTIMIZADO 2025
//  Conserva 100% tu arquitectura original
//  Arreglado: refresh, transferencias, módulo, TV sync,
//  reconexión, queue-updated, impresión, TTS
// =========================================================

const { Server } = require('socket.io');
const { Op } = require('sequelize');
const { sequelize } = require('../models');

let io;

// =========================================================
//  RECONEXIÓN – PERIODO DE GRACIA PARA NO PERDER ESTADO
// =========================================================
const RECONNECT_GRACE_MS = 15000; // 15s
const cashierDisconnectTimers = new Map(); // idCashier -> Timeout
const bridgeDisconnectTimers = new Map();  // location -> Timeout
const announcerDisconnectTimers = new Map(); // socketId -> Timeout
const tvDisconnectTimers = new Map();       // socketId -> Timeout

// =========================================================
//  MAPS DE ESTADO
// =========================================================

const userActiveSocket = new Map();
const cashierActiveSocket = new Map();

const serviceQueues = new Map();    
const cashierCurrentDisplay = new Map();
const cashierTickets = new Map();    

// =========================================================
//  TTS GLOBAL
// =========================================================

const SERIALIZE_ALL_PREFIXES = true;
const ALLOW_MULTIPLE_ANNOUNCERS = false;

let activeAnnouncerId = null;
const announcerSockets = new Set();
const tvSockets = new Set();
const ttsGlobalQueue = [];
let ttsGlobalProcessing = false;

function makeTtsItem(raw = {}) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    prefix: (raw.prefix || "").toLowerCase(),
    ttsText: raw.ttsText || "",
    numero: raw.numero || null,
    ventanilla: raw.ventanilla || null,
    moduleName: raw.moduleName || null,
    raw
  };
}

function enqueueTtsCall(raw) {
  const item = makeTtsItem(raw);
  ttsGlobalQueue.push(item);
  if (io) io.to("announcer").emit("tts-queued", { size: ttsGlobalQueue.length });
  processTtsGlobalQueue();
}

function getAnnouncerLeader() {
  if (!io) return null;
  if (ALLOW_MULTIPLE_ANNOUNCERS) return null;
  return io.sockets.sockets.get(activeAnnouncerId) || null;
}

// =========================================================
//  TTS GLOBAL – PROCESAMIENTO
// =========================================================

function processTtsGlobalQueue() {
  if (!io) return;
  if (ttsGlobalProcessing) return;
  if (ttsGlobalQueue.length === 0) return;

  const announcers = io.sockets.adapter.rooms.get("announcer");
  const haveAnnouncer = announcers && announcers.size > 0;

  const head = ttsGlobalQueue[0];
  ttsGlobalProcessing = true;

  if (!haveAnnouncer) {
    io.to("tv").emit("call-ticket-ui", head.raw);
    ttsGlobalQueue.shift();
    ttsGlobalProcessing = false;
    return processTtsGlobalQueue();
  }

  if (!activeAnnouncerId) {
    activeAnnouncerId = Array.from(announcers)[0];
    const leader = getAnnouncerLeader();
    if (leader) leader.emit("announcer-leader", { leader: true });
  }

  let leader = getAnnouncerLeader();
  if (!leader) {
    io.to("announcer").emit("tts-play", head);
  } else {
    leader.emit("tts-play", head);
  }

  const TIMEOUT = 8000;
  let finished = false;

  const end = () => {
    if (finished) return;
    finished = true;

    io.off("tts-done", finish);
    clearTimeout(timer);

    if (ttsGlobalQueue[0]?.id === head.id) {
      ttsGlobalQueue.shift();
    }
    ttsGlobalProcessing = false;
    processTtsGlobalQueue();
  };

  const finish = (payload) => {
    if (payload.id !== head.id) return;
    end();
  };

  const timer = setTimeout(end, TIMEOUT);

  io.once("tts-done", finish);
}

// =========================================================
//  UTILS
// =========================================================

async function getPrefixByCashierId(idCashier) {
  if (!idCashier) return null;
  try {
    const { Cashier, Service } = require('../models');
    const c = await Cashier.findByPk(idCashier, {
      attributes: ['idCashier', 'idService'],
      include: [{ model: Service, attributes: ['prefix'] }]
    });
    return c?.Service?.prefix?.toUpperCase() || null;
  } catch {
    return null;
  }
}

async function getServiceIdByPrefix(prefix) {
  if (!prefix) return null;
  const { Service } = require('../models');
  const svc = await Service.findOne({
    where: sequelize.where(
      sequelize.fn('upper', sequelize.col('prefix')),
      String(prefix).toUpperCase()
    ),
    attributes: ['idService']
  });
  return svc ? svc.idService : null;
}

function toDisplayPayload(prefix, t, overrideModulo = null) {
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
    prefix: (prefix || t.Service?.prefix || "").toUpperCase(),
    status: t.status,
    usuario: 'Sin cliente',
    modulo: String(overrideModulo ?? t.idCashier ?? "—")
  };
}

function emitToCashierDirect(idCashier, event, payload) {
  if (!io) return;
  const room = `cashier:${idCashier}`;
  const sockets = io.sockets.adapter.rooms.get(room);

  if (sockets && sockets.size > 0) {
    io.to(room).emit(event, payload);
    return;
  }

  for (const [, serviceInfo] of serviceQueues) {
    for (const [sock, info] of serviceInfo.cashiers) {
      if (info.idCashier === idCashier) {
        const s = io.sockets.sockets.get(sock);
        if (s) s.emit(event, payload);
      }
    }
  }
}

// =========================================================
//  LIMPIEZA DIFERIDA DE CAJEROS (RECONEXIÓN SUAVE)
// =========================================================
function scheduleCashierCleanup(idCashier, prefix, socketId) {
  if (!idCashier) return;
  if (cashierDisconnectTimers.has(idCashier)) return;
  const timer = setTimeout(() => {
    cashierDisconnectTimers.delete(idCashier);
    // Limpieza definitiva si no reconectó
    cashierActiveSocket.delete(idCashier);
    const room = String(prefix || '').toLowerCase();
    const info = serviceQueues.get(room);
    if (info) info.cashiers.delete(socketId);
    cashierCurrentDisplay.delete(idCashier);
    try { redistributeTickets(prefix); } catch {}
  }, RECONNECT_GRACE_MS);
  cashierDisconnectTimers.set(idCashier, timer);
}

function cancelCashierCleanup(idCashier) {
  const t = cashierDisconnectTimers.get(idCashier);
  if (t) {
    clearTimeout(t);
    cashierDisconnectTimers.delete(idCashier);
  }
}

// =========================================================
//  LIMPIEZA DIFERIDA – ANNOUNCER Y TV
// =========================================================
function scheduleAnnouncerCleanup(socketId) {
  if (!socketId) return;
  if (announcerDisconnectTimers.has(socketId)) return;
  const timer = setTimeout(() => {
    announcerDisconnectTimers.delete(socketId);
    announcerSockets.delete(socketId);
    if (socketId === activeAnnouncerId) activeAnnouncerId = null;
  }, RECONNECT_GRACE_MS);
  announcerDisconnectTimers.set(socketId, timer);
}

function cancelAnnouncerCleanup(socketId) {
  const t = announcerDisconnectTimers.get(socketId);
  if (t) {
    clearTimeout(t);
    announcerDisconnectTimers.delete(socketId);
  }
}

function scheduleTvCleanup(socketId) {
  if (!socketId) return;
  if (tvDisconnectTimers.has(socketId)) return;
  const timer = setTimeout(() => {
    tvDisconnectTimers.delete(socketId);
    tvSockets.delete(socketId);
  }, RECONNECT_GRACE_MS);
  tvDisconnectTimers.set(socketId, timer);
}

function cancelTvCleanup(socketId) {
  const t = tvDisconnectTimers.get(socketId);
  if (t) {
    clearTimeout(t);
    tvDisconnectTimers.delete(socketId);
  }
}

// =========================================================
//  NOTIFICACIONES PRINCIPALES
// =========================================================

const notifyTicketChange = async (prefix, action, ticket, assignedTo = null) => {
  try {
    if (!io) return;

    let enriched = { ...ticket };
    let moduleToShow = assignedTo ?? ticket.idCashier;

    if (assignedTo) {
      const { Cashier, Service } = require('../models');
      const cashier = await Cashier.findByPk(assignedTo, {
        include: [{ model: Service }]
      });
      if (cashier) {
        enriched.idService = cashier.Service.idService;
        enriched.prefix = cashier.Service.prefix.toUpperCase();
        moduleToShow = assignedTo;
        prefix = enriched.prefix;
      }
    }

    const room = prefix.toLowerCase();

    if (action === "assigned") {
      enriched.modulo = String(moduleToShow);

      emitToCashierDirect(assignedTo, "ticket-assigned", {
        ticket: enriched,
        assignedToCashier: assignedTo,
        timestamp: Date.now()
      });

      io.to(room).emit("ticket-assigned", { ticket: enriched });
      io.to("tv").emit("ticket-assigned", { ticket: enriched });

      return;
    }

    if (action === "transferred") {
      enriched.modulo = String(moduleToShow);

      const payload = {
        ticket: enriched,
        toCashierId: assignedTo,
        fromCashierId: ticket.idCashier,
        timestamp: Date.now()
      };

      io.to(room).emit("ticket-transferred", payload);
      io.to("tv").emit("ticket-transferred", payload);

      io.to(room).emit("queue-updated", {
        prefix,
        action: "transferred",
        ticketId: ticket.idTicketRegistration
      });

      return;
    }

    if (action === "completed") {
      const payload = { ticket: enriched };

      io.to(room).emit("ticket-completed", payload);
      io.to("tv").emit("ticket-completed", payload);

      io.to(room).emit("queue-updated", {
        prefix,
        action: "completed"
      });

      if (assignedTo) {
        await pickNextForCashier(prefix, assignedTo);
      }

      return;
    }

    if (action === "cancelled") {
      const payload = { ticket: enriched };
      io.to(room).emit("ticket-cancelled", payload);
      io.to("tv").emit("ticket-cancelled", payload);

      io.to(room).emit("queue-updated", {
        prefix,
        action: "cancelled"
      });

      return;
    }

  } catch (e) {
    console.error("[socket:notifyTicketChange ERROR]", e);
  }
};

// =========================================================
//  PICK NEXT PARA CAJERO
// =========================================================

async function pickNextForCashier(prefix, idCashier) {
  try {
    const serviceId = await getServiceIdByPrefix(prefix);
    if (!serviceId) return;

    const { TicketRegistration, Service } = require('../models');

    const assigned = await TicketRegistration.findOne({
      where: { idTicketStatus: 2, idCashier, status: true },
      include: [{ model: Service }]
    });

    if (assigned) {
      const payload = toDisplayPayload(prefix, assigned, idCashier);
      cashierCurrentDisplay.set(idCashier, { currentTicket: payload, isAssigned: true });
      emitToCashierDirect(idCashier, "update-current-display", {
        ticket: payload,
        isAssigned: true,
        timestamp: Date.now()
      });
      return;
    }

    const next = await TicketRegistration.findOne({
      where: {
        idTicketStatus: 1,
        idService: serviceId,
        status: true,
        [Op.or]: [
          { forcedToCashierId: idCashier },
          { forcedToCashierId: null }
        ]
      },
      include: [{ model: Service }],
      order: [
        [sequelize.literal('CASE WHEN transferredAt IS NULL THEN 0 ELSE 1 END'), 'ASC'],
        ['createdAt', 'ASC'],
        ['turnNumber', 'ASC']
      ]
    });

    if (!next) {
      cashierCurrentDisplay.delete(idCashier);
      emitToCashierDirect(idCashier, "no-tickets-available", { timestamp: Date.now() });
      return;
    }

    const payload = toDisplayPayload(prefix, next, idCashier);
    cashierCurrentDisplay.set(idCashier, { currentTicket: payload, isAssigned: false });

    emitToCashierDirect(idCashier, "update-current-display", {
      ticket: payload,
      isAssigned: false,
      timestamp: Date.now()
    });

  } catch (e) {
    console.error("[socket:pickNextForCashier ERROR]", e);
  }
}

// =========================================================
//  REDISTRIBUCIÓN DE TICKETS
// =========================================================

async function redistributeTickets(prefix) {
  try {
    if (!io) return;

    const room = prefix.toLowerCase();
    const serviceInfo = serviceQueues.get(room);
    if (!serviceInfo) return;

    const serviceId = await getServiceIdByPrefix(prefix);
    if (!serviceId) return;

    const { TicketRegistration } = require('../models');

    await TicketRegistration.findAll({
      where: { idTicketStatus: 1, idService: serviceId, status: true },
      order: [
        [sequelize.literal('CASE WHEN transferredAt IS NULL THEN 0 ELSE 1 END'), 'ASC'],
        ['createdAt', 'ASC'],
        ['turnNumber', 'ASC']
      ]
    });

    io.to(room).emit("queue-updated", {
      prefix,
      action: "redistribute",
      timestamp: Date.now()
    });

    io.to("tv").emit("queue-updated", {
      prefix,
      action: "redistribute",
      timestamp: Date.now()
    });

  } catch (e) {
    console.error("[socket:redistributeTickets ERROR]", e);
  }
}

// =========================================================
//  PRINT WORKER
// =========================================================

let isProcessingPrintQueue = false;

async function processPrintQueueBatch(io, batchSize = 15) {
  if (isProcessingPrintQueue) return;
  isProcessingPrintQueue = true;

  try {
    const { PrintOutbox, TicketRegistration } = require('../models');

    const jobs = await PrintOutbox.findAll({
      where: { status: { [Op.or]: ['pending', '', null] } },
      limit: batchSize,
      order: [['createdAt', 'ASC']]
    });

    for (const job of jobs) {
      const payload = job.payload || {};
      const type = payload.type || 'escpos';
      const finalPayload = payload.payload || payload;

      // ============================================================
      //  🔥 MOTIVO #1 DE QUE NO IMPRIME:
      //     NO EXISTE EL BRIDGE CONECTADO A LA TIENDA
      // ============================================================

      const room = `bridge:${String(job.location_id || "").trim()}`;
      const roomData = io.sockets.adapter.rooms.get(room);

      if (!roomData || roomData.size === 0) {
        // Log detallado de todas las salas bridge activas
        const allRooms = Array.from(io.sockets.adapter.rooms.keys());
        const bridgeRooms = allRooms.filter(r => r.startsWith('bridge:'));
        
        console.log(`❌ [PrintWorker] NO IMPRIME porque NO hay impresora conectada (${room})`);
        console.log(`📊 [PrintWorker] Salas bridge activas: ${bridgeRooms.length > 0 ? bridgeRooms.join(', ') : 'NINGUNA'}`);
        console.log(`📊 [PrintWorker] Total sockets conectados: ${io.sockets.sockets.size}`);

        await job.update({
          attempts: sequelize.literal('(COALESCE(attempts,0)+1)'),
          last_error: "No hay impresora conectada al bridge"
        });

        continue;
      }

      // Obtener el correlativo para logging
      let correlativo = 'N/A';
      if (job.ticket_id) {
        const ticket = await TicketRegistration.findByPk(job.ticket_id);
        if (ticket) correlativo = ticket.correlativo;
      }

      // Verificar si hay múltiples bridges en la sala
      if (roomData.size > 1) {
        console.warn(`⚠️ [PrintWorker] ADVERTENCIA: ${roomData.size} bridges conectados en ${room}. Esto puede causar impresiones duplicadas.`);
      }

      console.log(`📤 [PrintWorker] Enviando a la impresora (${room}) → job #${job.id}, ticket correlativo: ${correlativo}`);

      await job.update({
        status: 'sent',
        attempts: sequelize.literal('(COALESCE(attempts,0)+1)'),
        last_error: null
      });

      if (job.ticket_id) {
        await TicketRegistration.update(
          { printStatus: 'sent' },
          { where: { idTicketRegistration: job.ticket_id } }
        );
      }

      io.to(room).emit("print-ticket", {
        jobId: job.id,
        type,
        payload: finalPayload
      });
    }

  } catch (e) {
    console.error("[print-worker ERROR]", e);
  }

  isProcessingPrintQueue = false;
}

// =========================================================
//  INIT SOCKET.IO
// =========================================================

function init(httpServer, opts = {}) {
  io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingTimeout: 30000,
    pingInterval: 25000,
    ...opts
  });

  io.on("connection", (socket) => {

    console.log("⚡ Cliente conectado:", socket.id);

    // USER
    socket.on("register-user", ({ idUser, username }) => {
      userActiveSocket.set(idUser, socket.id);
      socket.userInfo = { idUser, username };
      socket.join(`user-${idUser}`);
    });

    // CAJERO
    socket.on("register-cashier", ({ idCashier, prefix, idUser }) => {
      // Cancelar limpieza si estaba programada durante la gracia
      cancelCashierCleanup(idCashier);

      cashierActiveSocket.set(idCashier, socket.id);
      socket.cashierInfo = { idCashier, prefix };

      const room = prefix.toLowerCase();
      socket.join(room);
      socket.join(`cashier:${idCashier}`);

      if (!serviceQueues.has(room)) {
        serviceQueues.set(room, { cashiers: new Map() });
      }

      const cashiersMap = serviceQueues.get(room).cashiers;
      // Limpiar entradas obsoletas de este cajero (sockets viejos)
      for (const [sockId, info] of cashiersMap) {
        if (info.idCashier === idCashier && sockId !== socket.id) {
          cashiersMap.delete(sockId);
        }
      }

      cashiersMap.set(socket.id, {
        idCashier,
        idUser,
        currentTicket: null
      });

      pickNextForCashier(prefix, idCashier);
      setTimeout(() => redistributeTickets(prefix), 500);
    });
    // =====================================================
    //  🔥 BRIDGE (IMPRESORAS)
    // =====================================================
    socket.on("register-bridge", (payload) => {
      // Soportar tanto "location" como "locationId" para compatibilidad
      const location = payload?.location || payload?.locationId || "";
      const normLocation = String(location).trim();
      
      if (!normLocation) {
        console.error("❌ [SOCKET] register-bridge sin location/locationId", { payload, socketId: socket.id });
        socket.emit("bridge-ack", { ok: false, error: "location/locationId requerido" });
        return;
      }
      
      console.log(`🟢 Bridge conectado para la tienda: ${normLocation}, socketId: ${socket.id}`);

      // El bridge se conecta a su "sala" personalizada
      const roomName = `bridge:${normLocation}`;
      
      // 🔥 IMPORTANTE: Desconectar bridges antiguos de esta ubicación para evitar duplicados
      const existingRoom = io.sockets.adapter.rooms.get(roomName);
      if (existingRoom && existingRoom.size > 0) {
        console.warn(`⚠️ [BRIDGE] Ya existe(n) ${existingRoom.size} bridge(s) en ${roomName}. Desconectando bridge(s) antiguo(s)...`);
        
        // Desconectar todos los sockets existentes en la sala
        for (const oldSocketId of existingRoom) {
          const oldSocket = io.sockets.sockets.get(oldSocketId);
          if (oldSocket && oldSocket.id !== socket.id) {
            console.log(`🔄 [BRIDGE] Desconectando bridge antiguo: ${oldSocketId}`);
            oldSocket.disconnect(true);
          }
        }
      }
      
      socket.join(roomName);

      socket.isBridge = true;
      socket.bridgeLocation = normLocation;
      
      // Log detallado de bridges conectados
      const roomData = io.sockets.adapter.rooms.get(roomName);
      console.log(`📊 [BRIDGE] Sala ${roomName} ahora tiene ${roomData ? roomData.size : 0} socket(s)`);

      // Cancelar limpieza diferida si se reconectó en la ventana de gracia
      const bt = bridgeDisconnectTimers.get(normLocation);
      if (bt) { clearTimeout(bt); bridgeDisconnectTimers.delete(normLocation); }

      socket.emit("bridge-ack", { ok: true, location: normLocation });

      // Procesar inmediatamente trabajos pendientes al conectar un bridge
      setTimeout(() => processPrintQueueBatch(io, 25), 200);
    });

    // ACK de impresión fallida desde el bridge
    socket.on("print-failed", async ({ jobId, error }) => {
      try {
        const { PrintOutbox } = require('../models');
        const job = await PrintOutbox.findByPk(jobId);
        if (!job) {
          console.warn(`⚠️ [print-failed] Job #${jobId} no encontrado`);
          return;
        }

        console.error(`❌ [print-failed] Job #${jobId} falló: ${error}`);

        await job.update({
          status: 'failed',
          last_error: error || 'Error desconocido desde bridge'
        });
      } catch (e) {
        console.error('[bridge print-failed ERROR]', e);
      }
    });

    // ACK de impresión exitosa desde el bridge
    socket.on("print-done", async ({ jobId }) => {
      try {
        const { PrintOutbox } = require('../models');
        const job = await PrintOutbox.findByPk(jobId);
        if (!job) {
          console.warn(`⚠️ [print-done] Job #${jobId} no encontrado`);
          return;
        }

        console.log(`✅ [print-done] Job #${jobId} confirmado como impreso. Marcando como 'done'`);

        // Actualizar a 'done' - el hook del modelo sincronizará automáticamente con TicketRegistration
        await job.update({ status: 'done', last_error: null });

      } catch (e) {
        console.error('[bridge print-done ERROR]', e);
      }
    });

    // ACK de impresión fallida desde el bridge
    socket.on("print-failed", async ({ jobId, error }) => {
      try {
        const { PrintOutbox } = require('../models');
        const job = await PrintOutbox.findByPk(jobId);
        if (!job) return;
        await job.update({ status: 'failed', last_error: String(error || 'Unknown error') });
      } catch (e) {
        console.error('[bridge print-failed ERROR]', e);
      }
    });
    // =====================================================
    //  TVs
    // =====================================================
    socket.on("subscribe-tv", () => {
      console.log(`📺 [SOCKET] Cliente ${socket.id} suscribiéndose a TV`);
      socket.isTv = true;
      socket.join("tv");
      socket.emit("subscribed-tv", { ok: true });
      tvSockets.add(socket.id);
      cancelTvCleanup(socket.id);
      
      // Log de cuántos están en el room
      const tvRoom = io.sockets.adapter.rooms.get("tv");
      console.log(`📺 [SOCKET] Total de TVs conectadas: ${tvRoom ? tvRoom.size : 0}`);
    });

    // ANNOUNCER
    socket.on("register-announcer", () => {
      socket.isAnnouncer = true;
      socket.join("announcer");
      announcerSockets.add(socket.id);
      cancelAnnouncerCleanup(socket.id);

      const leaders = io.sockets.adapter.rooms.get("announcer");
      if (!activeAnnouncerId && leaders && leaders.size > 0) {
        activeAnnouncerId = Array.from(leaders)[0];
      }
      socket.emit('announcer-leader', {
        leader: socket.id === activeAnnouncerId
      });

      processTtsGlobalQueue();
    });

    // CALL TICKET
    socket.on("call-ticket", (payload) => {
      enqueueTtsCall(payload);

      const room = payload.prefix?.toLowerCase();
      if (room) io.to(room).emit("call-ticket-ui", payload);
    });

    socket.on("tts-done", (data) => io.emit("tts-done", data));

    // TRANSFER
    socket.on("ticket-transfer", async (data) => {
      const { ticket, fromCashierId, toCashierId } = data;

      await notifyTicketChange(
        ticket.prefix,
        "transferred",
        ticket,
        toCashierId
      );

      const originPrefix = await getPrefixByCashierId(fromCashierId);
      if (originPrefix) pickNextForCashier(originPrefix, fromCashierId);

      redistributeTickets(ticket.prefix);
    });

    // DISCONNECT
    socket.on("disconnect", () => {
      if (socket.cashierInfo) {
        const { idCashier, prefix } = socket.cashierInfo;
        // No limpies inmediatamente; agenda limpieza diferida
        scheduleCashierCleanup(idCashier, prefix, socket.id);
      }

      if (socket.isAnnouncer) {
        // Limpieza diferida del announcer y liderazgo
        scheduleAnnouncerCleanup(socket.id);
      }

      if (socket.isTv) {
        // Limpieza diferida de TV
        scheduleTvCleanup(socket.id);
      }

      if (socket.isBridge && socket.bridgeLocation) {
        // Programar ventana de gracia para puentes de impresión
        const loc = socket.bridgeLocation;
        const timer = setTimeout(() => {
          bridgeDisconnectTimers.delete(loc);
        }, RECONNECT_GRACE_MS);
        bridgeDisconnectTimers.set(loc, timer);
      }
    });
  });

  // PRINT QUEUE
  setInterval(() => processPrintQueueBatch(io, 15), 5000);

  return io;
}

// =========================================================
//  EXPORTS
// =========================================================

module.exports = {
  init,
  getIo: () => io,
  notifyTicketChange,
  pickNextForCashier,
  redistributeTickets
};
