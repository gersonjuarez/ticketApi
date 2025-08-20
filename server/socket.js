const { Server } = require('socket.io');

let io;

// Estado global
const cashierTickets = new Map();        // Map<string, {idCashier, idTicket, prefix, ticket, socketId}>
const serviceQueues = new Map();         // Map<string, {cashiers: Map<socketId, {idCashier, currentTicket, idUser}>}>
const cashierCurrentDisplay = new Map(); // Map<idCashier, {currentTicket, isAssigned}>

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

      // Registro del cajero en un servicio
      socket.on('register-cashier', ({ idCashier, prefix, idUser }) => {
        if (!idCashier || !prefix) {
          console.warn(`[socket] register-cashier inválido desde ${socket.id}:`, { idCashier, prefix, idUser });
          return;
        }
        const room = prefix.toLowerCase();
        socket.join(room);

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

        setTimeout(async () => {
          await module.exports.redistributeTickets(prefix);
          console.log(`[socket] Redistribución completada para cajero ${idCashier} en ${prefix}`);
        }, 500);
      });

      // Join genérico
      socket.on("join", (room) => {
        if (!room || typeof room !== "string") {
          console.warn(`[socket] join inválido desde ${socket.id}:`, room);
          return;
        }
        socket.join(room);
        console.log(`[socket] ${socket.id} se unió al room '${room}'`);
      });

      // Bridge de impresión
      socket.on("register-bridge", ({ locationId }) => {
        if (!locationId || typeof locationId !== "string") {
          console.warn(`[socket] register-bridge inválido:`, locationId);
          return;
        }
        const room = `bridge:${locationId}`;
        socket.join(room);
        console.log(`[socket] Bridge ${socket.id} registrado en room '${room}'`);
      });

      // Suscripciones para pantallas
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

      // Llamada de ticket (excluye al emisor en el room del servicio y siempre envía a TVs)
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

      // Debug ping
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

    return io;
  },

  getIo: () => {
    if (!io) throw new Error("Socket.IO no inicializado");
    return io;
  },

  safeEmit: (event, payload) => {
    try {
      if (!io) throw new Error("io no inicializado");
      io.emit(event, payload);
    } catch (e) {
      console.error("[socket:safeEmit] error:", e?.message || e);
    }
  },

  emitToRoom: (room, event, payload) => {
    try {
      if (!io) throw new Error("io no inicializado");
      if (!room || typeof room !== "string") throw new Error("room inválido");
      io.to(room).emit(event, payload);
    } catch (e) {
      console.error("[socket:emitToRoom] error:", e?.message || e);
    }
  },

  emitToPrefix: (prefix, event, payload) => {
    try {
      if (!io) throw new Error("io no inicializado");
      if (!prefix || typeof prefix !== "string") throw new Error("prefix inválido");
      const room = prefix.toLowerCase();
      io.to(room).emit(event, payload);
    } catch (e) {
      console.error("[socket:emitToPrefix] error:", e?.message || e);
    }
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
        if (socket) {
          socket.emit(event, payload);
          emitCount++;
        }
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
      if (!serviceInfo) {
        console.log(`[socket:emitToAvailableCashiers] No hay info para servicio ${prefix}`);
        return;
      }

      const { TicketRegistration } = require('../models');
      const { Op } = require('sequelize');

      const assignedTickets = await TicketRegistration.findAll({
        where: {
          idTicketStatus: 2,
          correlativo: { [Op.like]: `${prefix}-%` },
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
        if (socket) {
          socket.emit(event, payload);
          emitCount++;
          console.log(`[socket:emitToAvailableCashiers] Enviando ${event} a cajero disponible: ${cashierInfo.idCashier}`);
        }
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
    try {
      if (!io) return;
      await new Promise((res) => io.close(() => res()));
      io = undefined;
    } catch (e) {
      console.error("[socket:closeIo] error:", e?.message || e);
    }
  },

  assignTicketToCashier: (idCashier, ticket, socketId = null) => {
    try {
      const key = `${ticket.prefix}_${idCashier}`;
      cashierTickets.set(key, {
        idCashier,
        idTicket: ticket.idTicketRegistration,
        prefix: ticket.prefix,
        ticket,
        socketId
      });
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

  getCashierCurrentTicket: (idCashier, prefix) => {
    try {
      return cashierCurrentDisplay.get(idCashier);
    } catch (e) {
      console.error('[socket:getCashierCurrentTicket] error:', e?.message || e);
      return null;
    }
  },

  getServiceState: (prefix) => {
    try {
      const room = prefix.toLowerCase();
      const serviceInfo = serviceQueues.get(room);
      if (!serviceInfo) return null;
      const cashiers = Array.from(serviceInfo.cashiers.entries()).map(([socketId, info]) => ({
        socketId,
        ...info,
        currentDisplay: cashierCurrentDisplay.get(info.idCashier)
      }));
      return { prefix, room, cashiersConnected: cashiers.length, cashiers };
    } catch (e) {
      console.error('[socket:getServiceState] error:', e?.message || e);
      return null;
    }
  },

  notifyTicketChange: async (prefix, actionType, ticket, assignedToCashier = null) => {
    try {
      if (!io) throw new Error('io no inicializado');
      const room = prefix.toLowerCase();

      if (actionType === 'assigned') {
        cashierCurrentDisplay.set(assignedToCashier, { currentTicket: ticket, isAssigned: true });
        io.to(room).emit('ticket-assigned', { ticket, assignedToCashier, timestamp: Date.now() });
        console.log(`[socket] Ticket ${ticket.correlativo} asignado a cajero ${assignedToCashier}`);
        await module.exports.redistributeTickets(prefix);
      } else if (actionType === 'completed') {
        cashierCurrentDisplay.delete(assignedToCashier);
        io.to(room).emit('ticket-completed', { ticket, completedByCashier: assignedToCashier, timestamp: Date.now() });
        console.log(`[socket] Ticket ${ticket.correlativo} completado por cajero ${assignedToCashier}`);
        await module.exports.redistributeTickets(prefix);
      }
    } catch (e) {
      console.error('[socket:notifyTicketChange] error:', e?.message || e);
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

      const { TicketRegistration } = require('../models');
      const { Op } = require('sequelize');

      const tickets = await TicketRegistration.findAll({
        where: { idTicketStatus: 1, correlativo: { [Op.like]: `${prefix}-%` }, status: true },
        order: [['turnNumber', 'ASC']]
      });

      if (tickets.length === 0) {
        console.log(`[socket] No hay tickets pendientes en servicio ${prefix}`);
        for (const [socketId, cashierInfo] of serviceInfo.cashiers) {
          const socket = io.sockets.sockets.get(socketId);
          if (socket) {
            const hasAssignedTicket = cashierCurrentDisplay.has(cashierInfo.idCashier);
            if (!hasAssignedTicket) socket.emit('no-tickets-available', { timestamp: Date.now() });
          }
        }
        return;
      }

      const assignedTickets = await TicketRegistration.findAll({
        where: {
          idTicketStatus: 2,
          correlativo: { [Op.like]: `${prefix}-%` },
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
          availableCashiers.push({ socketId, idCashier: cashierInfo.idCashier });
        }
      }

      console.log(`[socket] Redistribuyendo tickets. Pendientes: ${tickets.length}, Cajeros disponibles: ${availableCashiers.length}, Cajeros ocupados: ${busyCashiers.size}`);

      if (tickets.length > 0 && availableCashiers.length > 0) {
        const nextTicket = tickets[0];
        const ticketPayload = {
          idTicketRegistration: nextTicket.idTicketRegistration,
          turnNumber: nextTicket.turnNumber,
          correlativo: nextTicket.correlativo,
          usuario: 'Sin cliente',
          modulo: '—',
          createdAt: nextTicket.createdAt,
          updatedAt: nextTicket.updatedAt,
          idTicketStatus: nextTicket.idTicketStatus,
          idCashier: nextTicket.idCashier,
          dispatchedByUser: nextTicket.dispatchedByUser,
          idService: nextTicket.idService,
          idClient: nextTicket.idClient,
          prefix: prefix.toUpperCase(),
          status: nextTicket.status
        };

        availableCashiers.forEach(cashier => {
          const socket = io.sockets.sockets.get(cashier.socketId);
          if (!socket) return;
          if (busyCashiers.has(cashier.idCashier)) return;

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

      const { TicketRegistration } = require('../models');
      const { Op } = require('sequelize');

      const next = await TicketRegistration.findOne({
        where: { idTicketStatus: 1, correlativo: { [Op.like]: `${prefix}-%` }, status: true },
        order: [['turnNumber', 'ASC']],
      });
      if (!next) {
        console.log(`[socket] No hay siguiente ticket pendiente para broadcast en ${prefix}`);
        return;
      }

      const assigned = await TicketRegistration.findAll({
        where: {
          idTicketStatus: 2,
          correlativo: { [Op.like]: `${prefix}-%` },
          idCashier: { [Op.ne]: null },
          status: true,
        },
      });
      const busy = new Set(assigned.map(t => t.idCashier).filter(Boolean));

      const payload = {
        idTicketRegistration: next.idTicketRegistration,
        turnNumber: next.turnNumber,
        correlativo: next.correlativo,
        createdAt: next.createdAt,
        updatedAt: next.updatedAt,
        idTicketStatus: 1,
        idCashier: next.idCashier,
        dispatchedByUser: next.dispatchedByUser,
        idService: next.idService,
        idClient: next.idClient,
        prefix: prefix.toUpperCase(),
        status: next.status,
        usuario: 'Sin cliente',
        modulo: '—',
      };

      let broadcastCount = 0;
      for (const [socketId, info] of serviceInfo.cashiers) {
        if (excludeCashierId && info.idCashier === excludeCashierId) continue;
        if (busy.has(info.idCashier)) continue;

        const s = io.sockets.sockets.get(socketId);
        if (!s) continue;

        cashierCurrentDisplay.set(info.idCashier, { currentTicket: payload, isAssigned: false });
        s.emit('update-current-display', { ticket: payload, isAssigned: false, timestamp: Date.now() });
        broadcastCount++;
        console.log(`[socket:broadcastNextPendingToOthers] Enviando siguiente ticket a cajero disponible: ${info.idCashier}`);
      }

      console.log(`[socket:broadcastNextPendingToOthers] Broadcast del siguiente ticket ${next.correlativo} a ${broadcastCount} cajeros disponibles (excluyendo dispatch:${excludeCashierId}, ocupados:${busy.size})`);
    } catch (e) {
      console.error('[socket:broadcastNextPendingToOthers] error:', e?.message || e);
    }
  },
};
