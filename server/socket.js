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
      cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] },
      pingTimeout: 30_000,
      pingInterval: 25_000,
      ...opts,
    });    io.on('connection', (socket) => {
      console.log('[socket] Cliente conectado:', socket.id);      /**
       * Registro de cajero en un servicio específico
       */
      socket.on('register-cashier', ({ idCashier, prefix }) => {
        if (!idCashier || !prefix) {
          console.warn(`[socket] register-cashier inválido desde ${socket.id}:`, { idCashier, prefix });
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
          currentTicket: null 
        });
        
        // Guardar información del cajero en el socket
        socket.cashierInfo = { idCashier, prefix: room };
        
        console.log(`[socket] Cajero ${idCashier} registrado en servicio '${room}' con socket ${socket.id}`);
        
        // Redistribuir tickets después de que se registre un nuevo cajero
        setTimeout(() => {
          module.exports.redistributeTickets(prefix);
        }, 500);
      });

      /**
       * Mantiene tu funcionalidad actual:
       * join a cualquier room arbitrario.
       */
      socket.on('join', (room) => {
        if (!room || typeof room !== 'string') {
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
      socket.on('register-bridge', ({ locationId }) => {
        if (!locationId || typeof locationId !== 'string') {
          console.warn(`[socket] register-bridge inválido desde ${socket.id}:`, locationId);
          return;
        }
        const room = `bridge:${locationId}`;
        socket.join(room);
        console.log(`[socket] Bridge ${socket.id} registrado en room '${room}'`);
      });

      /**
       * (Opcional) Suscripción por prefijo de servicio para pantallas/TV
       * No interfiere con tu evento 'join' genérico.
       */
      socket.on('subscribe-prefix', ({ prefix }) => {
        if (!prefix || typeof prefix !== 'string') {
          console.warn(`[socket] subscribe-prefix inválido desde ${socket.id}:`, prefix);
          return;
        }
        const room = prefix.toLowerCase();
        socket.join(room);
        console.log(`[socket] ${socket.id} suscrito a room de prefix '${room}'`);
      });

      /**
       * (Opcional) ping-pong sencillo para debug/monitor
       */
      socket.on('ping-check', () => {
        socket.emit('pong-check', { at: Date.now() });
      });      socket.on('disconnect', (reason) => {
        console.log(`[socket] Cliente desconectado: ${socket.id}. Motivo: ${reason}`);
          // Limpiar el cajero de las colas de servicio
        if (socket.cashierInfo) {
          const { idCashier, prefix } = socket.cashierInfo;
          if (serviceQueues.has(prefix)) {
            serviceQueues.get(prefix).cashiers.delete(socket.id);
            console.log(`[socket] Cajero ${idCashier} removido del servicio '${prefix}'`);
          }
          
          // Limpiar el display actual del cajero
          cashierCurrentDisplay.delete(idCashier);
        }
        
        // Limpiar tickets asignados a este socket
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
    if (!io) throw new Error('Socket.IO no inicializado');
    return io;
  },

  /**
   * Emisión segura (catch de errores) a todos.
   */
  safeEmit: (event, payload) => {
    try {
      if (!io) throw new Error('io no inicializado');
      io.emit(event, payload);
    } catch (e) {
      console.error('[socket:safeEmit] error:', e?.message || e);
    }
  },

  /**
   * Emisión a un room arbitrario (string).
   */
  emitToRoom: (room, event, payload) => {
    try {
      if (!io) throw new Error('io no inicializado');
      if (!room || typeof room !== 'string') throw new Error('room inválido');
      io.to(room).emit(event, payload);
    } catch (e) {
      console.error('[socket:emitToRoom] error:', e?.message || e);
    }
  },

  /**
   * Emisión a room de prefijo (pantallas/TV)
   * Room: prefix en minúsculas.
   */
  emitToPrefix: (prefix, event, payload) => {
    try {
      if (!io) throw new Error('io no inicializado');
      if (!prefix || typeof prefix !== 'string') throw new Error('prefix inválido');
      const room = prefix.toLowerCase();
      io.to(room).emit(event, payload);
    } catch (e) {
      console.error('[socket:emitToPrefix] error:', e?.message || e);
    }
  },

  /**
   * Emisión a bridge de impresión por locationId.
   * Room: bridge:<locationId>
   */
  emitToBridge: (locationId, event, payload) => {
    try {
      if (!io) throw new Error('io no inicializado');
      if (!locationId || typeof locationId !== 'string') throw new Error('locationId inválido');
      const room = `bridge:${locationId}`;
      io.to(room).emit(event, payload);
    } catch (e) {
      console.error('[socket:emitToBridge] error:', e?.message || e);
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
      console.error('[socket:closeIo] error:', e?.message || e);
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
      }
      
      // Encontrar tickets asignados actualmente (status 2)
      const assignedTickets = await TicketRegistration.findAll({
        where: {
          idTicketStatus: 2, // Tickets en atención
          correlativo: { [Op.like]: `${prefix}-%` },
          status: true
        }
      });
      
      // Obtener cajeros sin ticket asignado
      const availableCashiers = [];
      for (const [socketId, cashierInfo] of serviceInfo.cashiers) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          // Verificar si el cajero tiene un ticket realmente asignado (status 2)
          const hasRealAssignment = assignedTickets.some(t => t.idCashier === cashierInfo.idCashier);
          
          if (!hasRealAssignment) {
            availableCashiers.push({
              socketId,
              idCashier: cashierInfo.idCashier
            });
          }
        }
      }
      
      console.log(`[socket] Redistribuyendo tickets. Pendientes: ${tickets.length}, Cajeros disponibles: ${availableCashiers.length}`);
        // Asignar el primer ticket disponible a cada cajero disponible
      if (tickets.length > 0 && availableCashiers.length > 0) {
        const nextTicket = tickets[0]; // Todos los cajeros sin asignación ven el primer ticket pendiente
        
        // Crear payload completo como en el controlador
        const ticketPayload = {
          idTicketRegistration: nextTicket.idTicketRegistration,
          turnNumber: nextTicket.turnNumber,
          correlativo: nextTicket.correlativo,
          usuario: 'Sin cliente', // Default ya que viene de la DB sin relaciones
          modulo: '—',
          createdAt: nextTicket.createdAt,
          updatedAt: nextTicket.updatedAt,
          idTicketStatus: nextTicket.idTicketStatus,
          idCashier: nextTicket.idCashier,
          idService: nextTicket.idService,
          idClient: nextTicket.idClient,
          prefix: prefix.toUpperCase(),
          status: nextTicket.status
        };
        
        availableCashiers.forEach(cashier => {
          const socket = io.sockets.sockets.get(cashier.socketId);
          if (socket) {
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
            
            console.log(`[socket] Cajero ${cashier.idCashier} ahora muestra ticket ${nextTicket.correlativo}`);
          }
        });
      }
      
    } catch (e) {
      console.error('[socket:redistributeTickets] error:', e?.message || e);
    }
  },
};
