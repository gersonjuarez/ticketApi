// server/socket.js
const { Server } = require('socket.io');

let io;

// Estado global para manejar tickets asignados por cajero y servicio
const cashierTickets = new Map(); // Map<string, {idCashier: number, idTicket: number, prefix: string}>
const serviceQueues = new Map(); // Map<string, {cashiers: Map<socketId, {idCashier, currentTicket}>}>
const cashierCurrentDisplay = new Map(); // Map<idCashier, {currentTicket: ticket, isAssigned: boolean}>

/**
 * Inicializa Socket.IO y registra eventos base.
 * Mantiene tu funcionalidad actual y agrega helpers de emisión y cierre.
 */
module.exports = {
  init: (httpServer, opts = {}) => {
    io = new Server(httpServer, {
      cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] },
      pingTimeout: 30_000,
      pingInterval: 25_000,
      ...opts,
    });    io.on('connection', (socket) => {
      console.log('[socket] Cliente conectado:', socket.id);      /**
       * Registro de cajero en un servicio específico
       */
      socket.on('register-cashier', ({ idCashier, prefix, idUser }) => {
        if (!idCashier || !prefix) {
          console.warn(`[socket] register-cashier inválido desde ${socket.id}:`, { idCashier, prefix, idUser });
          return;
        }
        
        const room = prefix.toLowerCase();
        socket.join(room);
        
        // Registrar el cajero en el servicio
        if (!serviceQueues.has(room)) {
          serviceQueues.set(room, { cashiers: new Map() });
        }
        serviceQueues.get(room).cashiers.set(socket.id, { 
          idCashier, 
          currentTicket: null,
          idUser: idUser || null  // Incluir idUser para poder filtrar por usuario
        });
        
        // Guardar información del cajero en el socket
        socket.cashierInfo = { idCashier, prefix: room, idUser: idUser || null };
          console.log(`[socket] Cajero ${idCashier} (user: ${idUser}) registrado en servicio '${room}' con socket ${socket.id}`);
        
        // Redistribuir tickets después de que se registre un nuevo cajero
        setTimeout(async () => {
          await module.exports.redistributeTickets(prefix);
          console.log(`[socket] Redistribución completada para cajero ${idCashier} en servicio ${prefix}`);
        }, 500);
      });

      /**
       * Mantiene tu funcionalidad actual:
       * join a cualquier room arbitrario.
       */
      socket.on("join", (room) => {
        if (!room || typeof room !== "string") {
          console.warn(`[socket] join inválido desde ${socket.id}:`, room);
          return;
        }
        socket.join(room);
        console.log(`[socket] ${socket.id} se unió al room '${room}'`);
      });

      /**
       * Nuevo: registro de bridge de impresión
       * Une al socket a un room específico por locationId: bridge:<locationId>
       * Esto permite emitir trabajos de impresión dirigidos.
       */
      socket.on("register-bridge", ({ locationId }) => {
        if (!locationId || typeof locationId !== "string") {
          console.warn(
            `[socket] register-bridge inválido desde ${socket.id}:`,
            locationId
          );
          return;
        }
        const room = `bridge:${locationId}`;
        socket.join(room);
        console.log(
          `[socket] Bridge ${socket.id} registrado en room '${room}'`
        );
      });

      /**
       * (Opcional) Suscripción por prefijo de servicio para pantallas/TV
       * No interfiere con tu evento 'join' genérico.
       */
      socket.on("subscribe-prefix", ({ prefix }) => {
        if (!prefix || typeof prefix !== "string") {
          console.warn(
            `[socket] subscribe-prefix inválido desde ${socket.id}:`,
            prefix
          );
          return;
        }
        const room = prefix.toLowerCase();
        socket.join(room);
        console.log(
          `[socket] ${socket.id} suscrito a room de prefix '${room}'`
        );
      });
      socket.on("call-ticket", (payload = {}) => {
        try {
          const { prefix } = payload || {};
          if (typeof prefix === "string" && prefix.trim()) {
            const room = prefix.toLowerCase();
            io.to(room).emit("call-ticket", payload);
            console.log(`[socket] call-ticket → room '${room}':`, payload);
          } else {
            io.emit("call-ticket", payload);
            console.log("[socket] call-ticket → all:", payload);
          }
        } catch (e) {
          console.error("[socket] call-ticket handler error:", e?.message || e);
        }
      });

      /**
       * (Opcional) ping-pong sencillo para debug/monitor
       */
      socket.on("ping-check", () => {
        socket.emit("pong-check", { at: Date.now() });
      });      socket.on("disconnect", (reason) => {
        console.log(
          `[socket] Cliente desconectado: ${socket.id}. Motivo: ${reason}`
        );
        // Limpiar el cajero de las colas de servicio
        if (socket.cashierInfo) {
          const { idCashier, prefix } = socket.cashierInfo;
          if (serviceQueues.has(prefix)) {
            serviceQueues.get(prefix).cashiers.delete(socket.id);
            console.log(`[socket] Cajero ${idCashier} removido del servicio '${prefix}'`);
            
            // Redistribuir tickets después de que se desconecte un cajero
            setTimeout(() => {
              module.exports.redistributeTickets(prefix.toUpperCase());
            }, 1000);
          }
          
          // Limpiar el display actual del cajero
          cashierCurrentDisplay.delete(idCashier);
        }
        
        // Limpiar tickets asignados a este socket en memoria
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

  /**
   * Obtiene la instancia de io para usar en controladores.
   */
  getIo: () => {
    if (!io) throw new Error("Socket.IO no inicializado");
    return io;
  },

  /**
   * Emisión segura (catch de errores) a todos.
   */
  safeEmit: (event, payload) => {
    try {
      if (!io) throw new Error("io no inicializado");
      io.emit(event, payload);
    } catch (e) {
      console.error("[socket:safeEmit] error:", e?.message || e);
    }
  },

  /**
   * Emisión a un room arbitrario (string).
   */
  emitToRoom: (room, event, payload) => {
    try {
      if (!io) throw new Error("io no inicializado");
      if (!room || typeof room !== "string") throw new Error("room inválido");
      io.to(room).emit(event, payload);
    } catch (e) {
      console.error("[socket:emitToRoom] error:", e?.message || e);
    }
  },

  /**
   * Emisión a room de prefijo (pantallas/TV)
   * Room: prefix en minúsculas.
   */
  emitToPrefix: (prefix, event, payload) => {
    try {
      if (!io) throw new Error("io no inicializado");
      if (!prefix || typeof prefix !== "string")
        throw new Error("prefix inválido");
      const room = prefix.toLowerCase();
      io.to(room).emit(event, payload);
    } catch (e) {
      console.error("[socket:emitToPrefix] error:", e?.message || e);
    }
  },
  /**
   * Emisión a room de prefijo excluyendo un cajero específico
   */
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
        // Excluir el cajero especificado
        if (excludeCashierId && cashierInfo.idCashier === excludeCashierId) {
          console.log(`[socket:emitToPrefixExcludingCashier] Excluyendo cajero ${excludeCashierId} del evento ${event}`);
          continue;
        }
        
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

  /**
   * Emisión INTELIGENTE: Solo a cajeros SIN tickets despachados (disponibles)
   * Excluye al cajero que hizo dispatch Y a todos los que ya tienen tickets despachados
   */
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

      // Obtener cajeros ocupados de la BD (que tienen tickets despachados)
      const { TicketRegistration } = require('../models');
      const { Op } = require('sequelize');
      
      const assignedTickets = await TicketRegistration.findAll({
        where: {
          idTicketStatus: 2, // Tickets despachados/en atención
          correlativo: { [Op.like]: `${prefix}-%` },
          idCashier: { [Op.ne]: null },
          status: true
        }
      });
      
      const busyCashiers = new Set(assignedTickets.map(t => t.idCashier).filter(Boolean));
      console.log(`[socket:emitToAvailableCashiers] Cajeros ocupados: [${Array.from(busyCashiers).join(', ')}]`);
      
      let emitCount = 0;
      for (const [socketId, cashierInfo] of serviceInfo.cashiers) {
        // Excluir el cajero que hizo el dispatch
        if (excludeCashierId && cashierInfo.idCashier === excludeCashierId) {
          console.log(`[socket:emitToAvailableCashiers] Excluyendo cajero que despachó: ${excludeCashierId}`);
          continue;
        }
        
        // Excluir cajeros que ya tienen tickets despachados
        if (busyCashiers.has(cashierInfo.idCashier)) {
          console.log(`[socket:emitToAvailableCashiers] Excluyendo cajero ocupado: ${cashierInfo.idCashier}`);
          continue;
        }
        
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

  /**
   * Emisión a bridge de impresión por locationId.
   * Room: bridge:<locationId>
   */
  emitToBridge: (locationId, event, payload) => {
    try {
      if (!io) throw new Error("io no inicializado");
      if (!locationId || typeof locationId !== "string")
        throw new Error("locationId inválido");
      const room = `bridge:${locationId}`;
      io.to(room).emit(event, payload);
    } catch (e) {
      console.error("[socket:emitToBridge] error:", e?.message || e);
    }
  },

  /**
   * Cierre elegante de Socket.IO (para graceful shutdown).
   */
  closeIo: async () => {
    try {
      if (!io) return;
      await new Promise((res) => io.close(() => res()));
      io = undefined;
    } catch (e) {
      console.error("[socket:closeIo] error:", e?.message || e);
    }
  },

  /**
   * Asignar un ticket a un cajero específico
   */
  assignTicketToCashier: (idCashier, ticket, socketId = null) => {
    try {
      const key = `${ticket.prefix}_${idCashier}`;
      cashierTickets.set(key, {
        idCashier,
        idTicket: ticket.idTicketRegistration,
        prefix: ticket.prefix,
        ticket: ticket,
        socketId
      });
      console.log(`[socket] Ticket ${ticket.correlativo} asignado a cajero ${idCashier}`);
    } catch (e) {
      console.error('[socket:assignTicketToCashier] error:', e?.message || e);
    }
  },

  /**
   * Liberar un ticket de un cajero
   */
  releaseTicketFromCashier: (idCashier, prefix) => {
    try {
      const key = `${prefix}_${idCashier}`;
      const removed = cashierTickets.delete(key);
      if (removed) {
        console.log(`[socket] Ticket liberado del cajero ${idCashier} en servicio ${prefix}`);
      }
      return removed;
    } catch (e) {
      console.error('[socket:releaseTicketFromCashier] error:', e?.message || e);
    }
  },

  /**
   * Obtener el ticket actual de un cajero
   */
  getCashierCurrentTicket: (idCashier, prefix) => {
    try {
      return cashierCurrentDisplay.get(idCashier);
    } catch (e) {
      console.error('[socket:getCashierCurrentTicket] error:', e?.message || e);
      return null;
    }
  },

  /**
   * Obtener el estado completo de un servicio para debug
   */
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
      
      return {
        prefix,
        room,
        cashiersConnected: cashiers.length,
        cashiers
      };
    } catch (e) {
      console.error('[socket:getServiceState] error:', e?.message || e);
      return null;
    }
  },

  /**
   * Notificar cambio de ticket a todos los cajeros del servicio
   */
  notifyTicketChange: async (prefix, actionType, ticket, assignedToCashier = null) => {
    try {
      if (!io) throw new Error('io no inicializado');
      
      const room = prefix.toLowerCase();
      
      if (actionType === 'assigned') {
        // Marcar que este cajero tiene el ticket asignado
        cashierCurrentDisplay.set(assignedToCashier, {
          currentTicket: ticket,
          isAssigned: true
        });
        
        // Notificar a todos en el servicio
        io.to(room).emit('ticket-assigned', {
          ticket,
          assignedToCashier,
          timestamp: Date.now()
        });
        
        console.log(`[socket] Ticket ${ticket.correlativo} asignado a cajero ${assignedToCashier}`);
        
        // Redistribuir tickets entre los demás cajeros inmediatamente
        await module.exports.redistributeTickets(prefix);
        
      } else if (actionType === 'completed') {
        // Liberar el ticket del cajero
        cashierCurrentDisplay.delete(assignedToCashier);
        
        // Notificar completado
        io.to(room).emit('ticket-completed', {
          ticket,
          completedByCashier: assignedToCashier,
          timestamp: Date.now()
        });
        
        console.log(`[socket] Ticket ${ticket.correlativo} completado por cajero ${assignedToCashier}`);
        
        // Redistribuir tickets inmediatamente
        await module.exports.redistributeTickets(prefix);
      }
      
    } catch (e) {
      console.error('[socket:notifyTicketChange] error:', e?.message || e);
    }
  },
  /**
   * Redistribuir tickets automáticamente entre cajeros disponibles
   */
  redistributeTickets: async (prefix) => {
    try {
      if (!io) throw new Error('io no inicializado');
      
      const room = prefix.toLowerCase();
      const serviceInfo = serviceQueues.get(room);
      
      if (!serviceInfo || serviceInfo.cashiers.size === 0) {
        console.log(`[socket] No hay cajeros conectados en servicio ${prefix}`);
        return;
      }
      
      // Obtener tickets pendientes del servicio
      const { TicketRegistration } = require('../models');
      const { Op } = require('sequelize');
      
      const tickets = await TicketRegistration.findAll({
        where: {
          idTicketStatus: 1, // Solo tickets pendientes
          correlativo: { [Op.like]: `${prefix}-%` },
          status: true
        },
        order: [['turnNumber', 'ASC']]
      });
      
      if (tickets.length === 0) {
        console.log(`[socket] No hay tickets pendientes en servicio ${prefix}`);
        
        // Enviar evento de "no tickets" a cajeros sin asignación
        for (const [socketId, cashierInfo] of serviceInfo.cashiers) {
          const socket = io.sockets.sockets.get(socketId);
          if (socket) {
            const hasAssignedTicket = cashierCurrentDisplay.has(cashierInfo.idCashier);
            if (!hasAssignedTicket) {
              socket.emit('no-tickets-available', { timestamp: Date.now() });
            }
          }
        }
        return;
      }      // Encontrar cajeros que tienen tickets realmente asignados (por idCashier)
      const assignedTickets = await TicketRegistration.findAll({
        where: {
          idTicketStatus: 2, // Tickets en atención
          correlativo: { [Op.like]: `${prefix}-%` },
          idCashier: { [Op.ne]: null }, // Que tengan cajero asignado
          status: true
        }
      });
      
      // Crear un Set de cajeros ocupados (por idCashier)
      const busyCashiers = new Set(assignedTickets.map(t => t.idCashier).filter(Boolean));
      console.log(`[socket] Cajeros ocupados (idCashier): [${Array.from(busyCashiers).join(', ')}]`);
      
      // Obtener cajeros disponibles (sin ticket asignado en BD)
      const availableCashiers = [];
      for (const [socketId, cashierInfo] of serviceInfo.cashiers) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket && !busyCashiers.has(cashierInfo.idCashier)) {
          availableCashiers.push({
            socketId,
            idCashier: cashierInfo.idCashier
          });
        }
      }
      
      console.log(`[socket] Redistribuyendo tickets. Pendientes: ${tickets.length}, Cajeros disponibles: ${availableCashiers.length}, Cajeros ocupados: ${busyCashiers.size}`);
      
      if (tickets.length > 0 && availableCashiers.length > 0) {
        const nextTicket = tickets[0];
          // Crear payload completo como en el controlador
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
          dispatchedByUser: nextTicket.dispatchedByUser, // Incluir campo para frontend
          idService: nextTicket.idService,
          idClient: nextTicket.idClient,
          prefix: prefix.toUpperCase(),
          status: nextTicket.status
        };
          // Mostrar el primer ticket disponible a todos los cajeros sin asignación
        // (pero no asignar realmente hasta que uno lo despache)
        availableCashiers.forEach(cashier => {
          const socket = io.sockets.sockets.get(cashier.socketId);
          if (socket) {
            // DOBLE VERIFICACIÓN: No enviar si el cajero está ocupado
            if (busyCashiers.has(cashier.idCashier)) {
              console.log(`[socket] SKIP: Cajero ${cashier.idCashier} está ocupado, no recibe update-current-display`);
              return;
            }
            
            // Actualizar el display del cajero (pero no asignado realmente)
            cashierCurrentDisplay.set(cashier.idCashier, {
              currentTicket: ticketPayload,
              isAssigned: false
            });
            
            socket.emit('update-current-display', {
              ticket: ticketPayload,
              isAssigned: false,
              timestamp: Date.now()
            });
            
            console.log(`[socket] Cajero ${cashier.idCashier} ahora ve ticket ${nextTicket.correlativo} (no asignado)`);
          }
        });
      }
        } catch (e) {
      console.error('[socket:redistributeTickets] error:', e?.message || e);
    }
  },

  /**
   * Enviar inmediatamente un "update-current-display" con el siguiente pendiente
   * a todos los cajeros disponibles del servicio, excepto el cajero excluido.
   */
  broadcastNextPendingToOthers: async (prefix, excludeCashierId = null) => {
    try {
      if (!io) return;
      const room = prefix.toLowerCase();
      const serviceInfo = serviceQueues.get(room);
      if (!serviceInfo) return;

      const { TicketRegistration } = require('../models');
      const { Op } = require('sequelize');

      // Siguiente pendiente
      const next = await TicketRegistration.findOne({
        where: {
          idTicketStatus: 1,
          correlativo: { [Op.like]: `${prefix}-%` },
          status: true,
        },
        order: [['turnNumber', 'ASC']],
      });
      if (!next) {
        console.log(`[socket] No hay siguiente ticket pendiente para broadcast en ${prefix}`);
        return;
      }

      // Cajeros ocupados reales (por idCashier en BD)
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
      };      let broadcastCount = 0;
      for (const [socketId, info] of serviceInfo.cashiers) {
        // Excluir el cajero que hizo el dispatch
        if (excludeCashierId && info.idCashier === excludeCashierId) {
          console.log(`[socket:broadcastNextPendingToOthers] Excluyendo cajero que despachó: ${excludeCashierId}`);
          continue;
        }
        
        // IMPORTANTE: Excluir cajeros que ya tienen tickets despachados
        if (busy.has(info.idCashier)) {
          console.log(`[socket:broadcastNextPendingToOthers] Excluyendo cajero ocupado: ${info.idCashier}`);
          continue;
        }

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
