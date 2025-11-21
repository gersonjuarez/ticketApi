// =========================================================
//  SOCKET GLOBAL – OPTIMIZADO 2025
//  Conserva 100% tu arquitectura original
//  Arreglado: refresh, transferencias, módulo, TV sync,
//  reconexión, queue-updated, impressão, TTS
// =========================================================

const { Server } = require('socket.io');
const { Op } = require('sequelize');
const { sequelize } = require('../models');

let io;

// =========================================================
//  MAPS DE ESTADO (TAL COMO LOS TENÍAS – SOLO OPTIMIZADO)
// =========================================================

const userActiveSocket = new Map();
const cashierActiveSocket = new Map();

const serviceQueues = new Map();     // { room: { cashiers: Map(socket, info) } }
const cashierCurrentDisplay = new Map(); // { idCashier: { currentTicket, isAssigned } }
const cashierTickets = new Map();    // { prefix_idCashier: { … } }

// =========================================================
// TTS GLOBAL (TU ARQUITECTURA ORIGINAL, REPARADA)
// =========================================================

const SERIALIZE_ALL_PREFIXES = true;
const ALLOW_MULTIPLE_ANNOUNCERS = false;

let activeAnnouncerId = null;
const announcerSockets = new Set();
const ttsGlobalQueue = [];
let ttsGlobalProcessing = false;

function makeTtsItem(raw = {}) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    prefix: (raw.prefix || "").toString().toLowerCase(),
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
//   🔥 TTS GLOBAL – OPTIMIZADO
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
    // No announcers → solo UI
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
    // fallback
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
//    UTILS QUE MANTENGO EXACTOS A TU LÓGICA ORIGINAL
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

// 🔥 Reparado: modulo siempre correcto
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
    prefix: (prefix || t.Service?.prefix || "").toString().toUpperCase(),
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

  // fallback (tu lógica original)
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
//   NOTIFICACIONES PRINCIPALES (ARREGLADAS)
// =========================================================

const notifyTicketChange = async (prefix, action, ticket, assignedTo = null) => {
  try {
    if (!io) return;

    let enriched = { ...ticket };
    let moduleToShow = assignedTo ?? ticket.idCashier;

    // 🔥 Reparado: si se transfiere → mostrar modulo nuevo inmediatamente
    if (assignedTo) {
      const { Cashier, Service } = require('../models');
      const cashier = await Cashier.findByPk(assignedTo, {
        include: [{ model: Service, attributes: ['prefix'] }]
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

      // 🔥 refresh inmediato
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

    // 🔥 NUEVO: cargar siguiente ticket para el cajero que atendió
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
//   🔥 PICK NEXT PARA CAJERO — REPARADO
// =========================================================

async function pickNextForCashier(prefix, idCashier) {
  try {
    const serviceId = await getServiceIdByPrefix(prefix);
    if (!serviceId) return;

    const { TicketRegistration, Service } = require('../models');

    // 1) buscar asignados
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

    // 2) buscar pendiente
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
//  🔥 REDISTRIBUCIÓN DE TICKETS — ARREGLADA
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

    const pending = await TicketRegistration.findAll({
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
//  PRINT WORKER – EXPLICADO Y CLARO
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

      const room = `bridge:${job.location_id}`;
      const roomData = io.sockets.adapter.rooms.get(room);

      if (!roomData || roomData.size === 0) {
        console.log(
          `❌ [PrintWorker] NO IMPRIME porque NO hay impresora conectada (${room})`
        );

        await job.update({
          attempts: sequelize.literal('(COALESCE(attempts,0)+1)'),
          last_error: "No hay impresora conectada al bridge"
        });

        continue; // 🚨 se detiene aquí → no se imprime
      }

      // ============================================================
      //   SÍ HAY BRIDGE → SE ENVÍA LA IMPRESIÓN
      // ============================================================

      console.log(`📤 [PrintWorker] Enviando a la impresora (${room}) → job #${job.id}`);

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

      // Enviar al bridge
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
//  🔥 INIT SOCKET.IO
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

    // =====================================================
    //  USER (APP CREACIÓN TICKETS)
    // =====================================================
    socket.on("register-user", ({ idUser, username }) => {
      userActiveSocket.set(idUser, socket.id);
      socket.userInfo = { idUser, username };
      socket.join(`user-${idUser}`);
    });

    // =====================================================
    //  CAJERO (APP DASHBOARD)
    // =====================================================
    socket.on("register-cashier", ({ idCashier, prefix, idUser }) => {
      cashierActiveSocket.set(idCashier, socket.id);
      socket.cashierInfo = { idCashier, prefix };

      const room = prefix.toLowerCase();
      socket.join(room);
      socket.join(`cashier:${idCashier}`);

      if (!serviceQueues.has(room)) {
        serviceQueues.set(room, { cashiers: new Map() });
      }

      serviceQueues.get(room).cashiers.set(socket.id, {
        idCashier,
        idUser,
        currentTicket: null
      });

      // 🔥 rejoin state estable
      pickNextForCashier(prefix, idCashier);

      // 🔥 redistribución inicial
      setTimeout(() => redistributeTickets(prefix), 500);
    });
// ============================================
// BRIDGE – registro correcto con backend
// ============================================

// LEER locationId correctamente
const locationId =
  process.env.LOCATION_ID ||
  require("os").hostname() ||
  "sucursal-central-01";

console.log("📌 Bridge iniciado con locationId:", locationId);

const socket = io(SOCKET_URL, {
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: 50,
  reconnectionDelay: 2000,
});

socket.on("connect", () => {
  console.log("⚡ Socket conectado:", socket.id);

  socket.emit("register-bridge", { location: locationId });

  console.log("📤 Enviado registro:", { location: locationId });
});

socket.on("bridge-ack", (msg) => {
  console.log("🟢 Backend confirmó el bridge:", msg);
});

socket.on("print-ticket", (data) => {
  console.log("🖨 Ticket recibido para imprimir:", data);

  // TODO: tu función de impresión ESC/POS aquí
  // printEscPos(data.payload);

  socket.emit("print-done", { jobId: data.jobId });
});

    // =====================================================
    //  TVs
    // =====================================================
    socket.on("subscribe-tv", () => {
      socket.isTv = true;
      socket.join("tv");
      socket.emit("subscribed-tv", { ok: true });
    });

    socket.on("register-announcer", () => {
      socket.isAnnouncer = true;
      socket.join("announcer");
      announcerSockets.add(socket.id);

      const leaders = io.sockets.adapter.rooms.get("announcer");
      if (!activeAnnouncerId && leaders && leaders.size > 0) {
        activeAnnouncerId = Array.from(leaders)[0];
      }
      socket.emit('announcer-leader', {
        leader: socket.id === activeAnnouncerId
      });

      processTtsGlobalQueue();
    });

    // =====================================================
    //   CALL TICKET → TTS
    // =====================================================
    socket.on("call-ticket", (payload) => {
      enqueueTtsCall(payload);

      const room = payload.prefix?.toLowerCase();
      if (room) io.to(room).emit("call-ticket-ui", payload);
    });

    socket.on("tts-done", (data) => io.emit("tts-done", data));

    // =====================================================
    //   TRANSFERENCIAS Y CAMBIOS DE TICKET
    // =====================================================

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

    // =====================================================
    //  DISCONNECT
    // =====================================================
    socket.on("disconnect", () => {
      if (socket.cashierInfo) {
        const { idCashier, prefix } = socket.cashierInfo;
        cashierActiveSocket.delete(idCashier);

        const room = prefix.toLowerCase();
        const info = serviceQueues.get(room);
        if (info) info.cashiers.delete(socket.id);

        cashierCurrentDisplay.delete(idCashier);
        redistributeTickets(prefix);
      }

      if (socket.isAnnouncer) {
        announcerSockets.delete(socket.id);
        if (socket.id === activeAnnouncerId) activeAnnouncerId = null;
      }
    });

  });

  // =====================================================
  //   TIMERS
  // =====================================================
  setInterval(() => processPrintQueueBatch(io, 15), 5000);

  return io;
}

// =========================================================
// EXPORT
// =========================================================

module.exports = {
  init,
  getIo: () => io,
  notifyTicketChange,
  pickNextForCashier,
  redistributeTickets
};
