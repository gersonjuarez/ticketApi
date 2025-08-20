// controllers/ticketController.js
const { Op } = require('sequelize');
const {
  TicketRegistration,
  Client,
  Service,
  sequelize,
} = require('../models');

/* ============================
   Helpers
============================ */

/** Devuelve [startOfDay, endOfDay) en hora del servidor */
const getTodayBounds = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

/** Normaliza payload hacia el front (para listados/detalle) */
const toTicketPayload = (ticket, client = null, service = null) => ({
  idTicketRegistration: ticket.idTicketRegistration,
  turnNumber: ticket.turnNumber, // <-- agregado
  correlativo: ticket.correlativo,
  prefix: (service?.prefix ?? ticket.Service?.prefix) || undefined, // <-- agregado
  usuario: (client?.name ?? ticket.Client?.name) || 'Sin cliente',
  modulo: (service?.name ?? ticket.Service?.name) || '—',
  createdAt: ticket.createdAt,
  updatedAt: ticket.updatedAt, // <-- agregado para consistencia
  idTicketStatus: ticket.idTicketStatus,  idCashier: ticket.idCashier, // <-- agregado para validaciones en frontend
  dispatchedByUser: ticket.dispatchedByUser, // <-- agregado para saber quién lo despachó
  idService: ticket.idService, // <-- agregado para referencia
  idClient: ticket.idClient, // <-- agregado para referencia
  status: ticket.status, // <-- agregado para estado del registro
});

/** Payload específico para responder al crear (para RN) */
const toCreatedTicketPayload = ({ ticket, client, service, cashier = null }) => ({
  idTicketRegistration: ticket.idTicketRegistration,
  turnNumber: ticket.turnNumber,
  correlativo: ticket.correlativo,
  prefix: service.prefix,
  createdAt: ticket.createdAt,
  idTicketStatus: ticket.idTicketStatus,
  // datos de cliente (por si quieres mostrarlos)
  client: client
    ? { idClient: client.idClient, name: client.name, dpi: client.dpi || null }
    : null,
  // datos de servicio
  service: {
    idService: service.idService,
    name: service.name,
    prefix: service.prefix,
  },
  // datos de caja (si la asignan en la creación; ahora es null)
  idCashier: ticket.idCashier ?? null,
  cashier: cashier
    ? { idCashier: cashier.idCashier, name: cashier.name }
    : null,
});

/** Intenta determinar si un error es de clave única / duplicado */
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

/* ============================
   Listados simples
============================ */

/** LISTAR PENDIENTES (status 1) con filtro opcional por prefijo */
exports.findAll = async (req, res) => {
  try {
    const { prefix } = req.query;
    const where = {
      idTicketStatus: 1,
      ...(prefix ? { correlativo: { [Op.like]: `${prefix}-%` } } : {}),
    };
    const tickets = await TicketRegistration.findAll({ where, include: [{ model: Service }] }); // <-- incluye Service para prefix en payload
    res.json(tickets.map((t) => toTicketPayload(t)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/** LISTAR EN ATENCIÓN / DESPACHADOS (status 2) con filtro opcional por prefijo */
exports.findAllDispatched = async (req, res) => {
  try {
    const { prefix } = req.query;
    const where = {
      idTicketStatus: 2,
      ...(prefix ? { correlativo: { [Op.like]: `${prefix}-%` } } : {}),
    };
    const tickets = await TicketRegistration.findAll({ where, include: [{ model: Service }] }); // <-- incluye Service
    res.json(tickets.map((t) => toTicketPayload(t)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/** OBTENER DETALLE */
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

    if (!name || name.trim() === '') {
      return res.status(400).json({ message: 'El nombre es obligatorio.' });
    }
    if (dpi && !/^\d{13}$/.test(dpi)) {
      return res.status(400).json({ message: 'El DPI debe tener 13 dígitos numéricos.' });
    }

    // 1) Cliente (fuera del retry; su DPI es único y estable)
    let client;
    if (dpi) {
      const [c] = await Client.findOrCreate({
        where: { dpi },
        defaults: { name, dpi },
      });
      client = c;
    } else {
      client = await Client.create({ name, dpi: null });
    }

    // 2) Servicio
    const service = await Service.findByPk(idService);
    if (!service) {
      return res.status(404).json({ message: 'Servicio no encontrado.' });
    }

    // 3) Reintento de creación (para resolver colisiones)
    const maxAttempts = 3;
    let createdTicket = null;
    let lastErr = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const t = await sequelize.transaction();
      try {
        const { start, end } = getTodayBounds();

        // (a) Calcular MAX(turnNumber) sólo del día actual y servicio
        const lastTurnToday =
          (await TicketRegistration.max('turnNumber', {
            where: {
              idService,
              createdAt: { [Op.gte]: start, [Op.lt]: end },
            },
            transaction: t,
          })) || 0;

        const turnNumber = lastTurnToday + 1;
        const correlativo = `${service.prefix}-${turnNumber}`;

        // (b) Crear ticket
        const ticket = await TicketRegistration.create(
          {
            turnNumber,
            idTicketStatus: 1, // pendiente
            idClient: client.idClient,
            idService,
            idCashier: null,
            status: true,
            correlativo,
          },
          { transaction: t }
        );

        await t.commit();
        createdTicket = ticket;
        lastErr = null;
        break; // éxito -> salimos del bucle
      } catch (err) {
        // rollback seguro
        try { if (t.finished !== 'commit') await t.rollback(); } catch {}
        lastErr = err;

        if (isUniqueError(err) && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 25) + 10));
          continue; // reintentar
        }
        break;
      }
    }

    if (!createdTicket) {
      if (lastErr) return next(lastErr);
      return res.status(500).json({ message: 'No se pudo crear el ticket.' });
    }

    // ====== EMITIR EVENTOS SOCKET (con payload enriquecido) ======
    const io = require('../server/socket').getIo?.();
    const room = String(service.prefix || '').toLowerCase();

    // payload unificado para sockets
    const socketPayload = toTicketPayload(createdTicket, client, service);    if (io) {
      io.to(room).emit('new-ticket', socketPayload);
      io.emit('new-ticket', socketPayload);
      
      // Redistribuir tickets automáticamente después de crear uno nuevo
      setTimeout(async () => {
        try {
          const socketModule = require('../server/socket');
          if (socketModule.redistributeTickets) {
            await socketModule.redistributeTickets(service.prefix);
            console.log(`[CREATE] Redistribución automática completada para servicio ${service.prefix}`);
          }
        } catch (e) {
          console.error('[CREATE] Error en redistribución automática:', e);
        }
      }, 100);

      // Imprimir (si mandaron locationId)
      if (locationId) {
        const printJob = {
          type: 'escpos',
          payload: { 
            header: 'SISTEMA DE TURNOS',
            subHeader: service.name,
            ticketNumber: socketPayload.correlativo,
            name,
            dpi: dpi || '',
            service: service.name,
            footer: 'Gracias por su visita',
            dateTime: new Date().toLocaleString(),
          },
        };
        io.to(`bridge:${locationId}`).emit('print-ticket', printJob);
      }
    }

    // ====== RESPUESTA INMEDIATA AL FRONT (RN) ======
    const responsePayload = toCreatedTicketPayload({
      ticket: createdTicket,
      client,
      service,
      cashier: null, // aún no asignado
    });

    return res.status(201).json(responsePayload);
  } catch (err) {
    return next(err);
  }
};

/* ============================
   Otros listados / update / delete
============================ */

/** LISTAR POR PREFIX (todos status con status=true) */
exports.getTicketsByPrefix = async (req, res, next) => {
  try {
    const { prefix } = req.params;
    const service = await Service.findOne({ where: { prefix } });
    if (!service) return res.status(404).json({ message: 'Servicio no encontrado.' });

    // SOLO pendientes para no "persistir" ACT-4 en las listas ni en recargas
    const tickets = await TicketRegistration.findAll({
      where: {
        idService: service.idService,
        status: true,
        idTicketStatus: 1, // <<< clave: solo pendientes
      },
      order: [['turnNumber', 'ASC']],
    });

    const payload = tickets.map((t) => ({
      idTicketRegistration: t.idTicketRegistration,
      turnNumber: t.turnNumber,
      correlativo: t.correlativo,
      createdAt: t.createdAt,
      prefix: service.prefix,
      name: service.name,
    }));return res.json(payload);
  } catch (err) {
    next(err);
  }
};

/** NUEVO: OBTENER TICKETS PARA CAJERO ESPECÍFICO */
exports.getTicketsForCashier = async (req, res) => {
  try {
    const { prefix, idUser, idCashier } = req.query; // Recibir AMBOS parámetros
    console.log('[getTicketsForCashier] ===== DEBUGGING TICKET LOAD =====');
    console.log('[getTicketsForCashier] prefix:', prefix, 'idUser:', idUser, 'idCashier:', idCashier);

    const service = await Service.findOne({ where: { prefix } });
    if (!service) return res.status(404).json({ message: 'Servicio no encontrado.' });
    
    console.log('[getTicketsForCashier] Service found:', service.idService);// 1. Obtener el ticket actual del cajero 
    // SOLO buscar por dispatchedByUser - cada usuario ve únicamente SUS tickets despachados
    const { Op } = require('sequelize');
    const currentTicket = await TicketRegistration.findOne({
      where: { 
        idService: service.idService,
        idTicketStatus: 2, // Despachado/En atención
        dispatchedByUser: parseInt(idUser || 0), // SOLO el usuario que lo despachó
        status: true
      },
      include: [{ model: Client }, { model: Service }],
      order: [['turnNumber', 'ASC']]
    });    console.log(`[getTicketsForCashier] Usuario ${idUser} - Ticket actual encontrado:`, currentTicket ? `${currentTicket.correlativo} (ID:${currentTicket.idTicketRegistration}, status:${currentTicket.idTicketStatus}, dispatchedBy:${currentTicket.dispatchedByUser})` : 'ninguno');

    // 2. Obtener tickets pendientes (estado 1) para la cola
    // IMPORTANTE: Filtrar SOLO estado 1 para evitar que tickets despachados aparezcan como pendientes
    const queueTickets = await TicketRegistration.findAll({
      where: { 
        idService: service.idService,
        idTicketStatus: 1, // SOLO pendientes - NO incluir estado 2
        status: true
      },
      include: [{ model: Client }, { model: Service }],
      order: [['turnNumber', 'ASC']]
    });

    console.log(`[getTicketsForCashier] Queue tickets found:`, queueTickets.map(t => `${t.correlativo} (ID:${t.idTicketRegistration})`));
    console.log(`[getTicketsForCashier] Current: ${currentTicket?.correlativo || 'ninguno'}, Queue pendientes: ${queueTickets.length}`);    const response = {
      current: currentTicket ? toTicketPayload(currentTicket) : null,
      queue: queueTickets.map(t => toTicketPayload(t))
    };

    console.log('[getTicketsForCashier] ===== RESPONSE =====');
    console.log('[getTicketsForCashier] Current ticket:', response.current ? `${response.current.correlativo} (status:${response.current.idTicketStatus}, dispatchedByUser:${response.current.dispatchedByUser})` : 'null');
    console.log('[getTicketsForCashier] Queue tickets:', response.queue.map(t => t.correlativo));
    console.log('[getTicketsForCashier] ===== END DEBUGGING =====');
    
    res.json(response);
  } catch (error) {
    console.error('[getTicketsForCashier] Error:', error);
    res.status(500).json({ error: error.message });
  }
};

/** UPDATE (emite ticket-updated enriquecido y guarda historial) */
exports.update = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { idCashier, idTicketStatus, observations } = req.body;
    const ticketId = req.params.id;

    console.log('[UPDATE] Datos recibidos:', { idCashier, idTicketStatus, observations, ticketId });

    // Obtener el ticket actual para comparar estados
    const currentTicket = await TicketRegistration.findByPk(ticketId, {
      include: [{ model: Client }, { model: Service }],
      transaction: t
    });

    if (!currentTicket) {
      await t.rollback();
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }

    console.log('[UPDATE] Ticket actual:', {
      id: currentTicket.idTicketRegistration,
      correlativo: currentTicket.correlativo,
      currentStatus: currentTicket.idTicketStatus,
      currentCashier: currentTicket.idCashier,
      dispatchedByUser: currentTicket.dispatchedByUser
    });

    // Verificar si ESTE ticket específico ya está asignado a otro cajero
    if (idTicketStatus === 2) {
      console.log('[UPDATE] Validando despacho - Estado solicitado: 2');
      console.log('[UPDATE] Current ticket status:', currentTicket.idTicketStatus);
      console.log('[UPDATE] Current ticket cashier:', currentTicket.idCashier);
      console.log('[UPDATE] Requesting cashier:', idCashier);
      
      // Si el ticket ya está en estado 2 (despachado) y es de otro cajero, no permitir
      if (currentTicket.idTicketStatus === 2 && currentTicket.idCashier && currentTicket.idCashier !== idCashier) {
        console.log('[UPDATE] ERROR: Ticket ya despachado por otro cajero:', {
          currentCashier: currentTicket.idCashier,
          requestingCashier: idCashier
        });
        await t.rollback();
        return res.status(409).json({ 
          error: 'Este ticket ya está siendo atendido por otro cajero',
          conflictTicket: currentTicket.correlativo,
          currentCashier: currentTicket.idCashier
        });
      } else {
        console.log('[UPDATE] Validación OK - Ticket disponible para despacho');
      }
    }

    // Siempre actualizar con los nuevos valores
    const updateData = {
      idTicketStatus: idTicketStatus || currentTicket.idTicketStatus,
      idCashier: idCashier || currentTicket.idCashier,
      ...(observations && { observations }),
      // Guardar el usuario que despachó solo cuando se cambia a estado 2 (despachado)
      ...(idTicketStatus === 2 && currentTicket.idTicketStatus === 1 && { 
        dispatchedByUser: req.body.changedByUser || req.body.idUser || 1 
      })
    };

    console.log('[UPDATE] Actualizando ticket con:', updateData);

    const [updated] = await TicketRegistration.update(updateData, {
      where: { idTicketRegistration: ticketId },
      transaction: t
    });

    if (!updated) {
      await t.rollback();
      return res.status(404).json({ error: 'No se pudo actualizar' });
    }

    // Crear registro en el historial SIEMPRE con el idUser (del req.body)
    const { TicketHistory } = require('../models');
    const historyData = {
      idTicket: ticketId,
      fromStatus: currentTicket.idTicketStatus,
      toStatus: idTicketStatus || currentTicket.idTicketStatus,
      changedByUser: req.body.changedByUser || 1,
    };

    console.log('[UPDATE] Creando historial con:', historyData);
    await TicketHistory.create(historyData, { transaction: t });

    await t.commit();

    // Traemos el ticket actualizado con relaciones
    const updatedTicket = await TicketRegistration.findByPk(ticketId, {
      include: [{ model: Client }, { model: Service }],
    });    const io = require('../server/socket').getIo();
    const payload = toTicketPayload(updatedTicket, updatedTicket.Client, updatedTicket.Service);    // Emitir eventos específicos según el tipo de cambio
    if (idTicketStatus === 2 && currentTicket.idTicketStatus === 1) {
      // Ticket fue despachado/asignado - notificar a otros cajeros del servicio (EXCLUYENDO al que lo despachó)
      const socketModule = require('../server/socket');
      
      console.log(`[UPDATE] ===== DEBUGGING TICKET ASSIGNMENT =====`);
      console.log(`[UPDATE] Ticket: ${updatedTicket.correlativo}`);
      console.log(`[UPDATE] Assigned to idCashier: ${idCashier}`);
      console.log(`[UPDATE] Service prefix: ${updatedTicket.Service.prefix}`);
      console.log(`[UPDATE] Attempting to EXCLUDE idCashier ${idCashier} from ticket-assigned event`);
      
      if (socketModule.emitToAvailableCashiers) {
        await socketModule.emitToAvailableCashiers(
          updatedTicket.Service.prefix,
          'ticket-assigned',
          {
            ticket: payload,
            assignedToCashier: idCashier,
            previousStatus: currentTicket.idTicketStatus,
            timestamp: Date.now()
          },
          idCashier  // Excluir el cajero que despachó el ticket
        );
        console.log(`[UPDATE] Ticket ${updatedTicket.correlativo} asignado a cajero ${idCashier} - evento enviado SOLO a cajeros disponibles`);
      } else if (socketModule.emitToPrefixExcludingCashier) {
        // Verificar estado del servicio antes de emitir
        const serviceState = socketModule.getServiceState(updatedTicket.Service.prefix);
        console.log(`[UPDATE] Service state:`, JSON.stringify(serviceState, null, 2));
        
        socketModule.emitToPrefixExcludingCashier(
          updatedTicket.Service.prefix,
          'ticket-assigned',
          {
            ticket: payload,
            assignedToCashier: idCashier,
            previousStatus: currentTicket.idTicketStatus,
            timestamp: Date.now()
          },
          idCashier  // Excluir el cajero que despachó el ticket
        );
        console.log(`[UPDATE] Ticket ${updatedTicket.correlativo} asignado a cajero ${idCashier} - evento enviado a otros cajeros (excludiendo ${idCashier})`);
      } else {
        // Fallback al método anterior si no existe la función
        const room = updatedTicket.Service.prefix.toLowerCase();
        console.log(`[UPDATE] FALLBACK: Enviando a TODOS los cajeros en room ${room} (NO EXCLUYENDO)`);
        io.to(room).emit('ticket-assigned', {
          ticket: payload,
          assignedToCashier: idCashier,
          previousStatus: currentTicket.idTicketStatus,
          timestamp: Date.now()
        });
        console.log(`[UPDATE] Ticket ${updatedTicket.correlativo} asignado a cajero ${idCashier} - evento enviado a todos`);
      }      console.log(`[UPDATE] ===== END DEBUGGING =====`);
      
      // Empujar "siguiente pendiente" YA a los demás cajeros (y además redistribuir)
      try {
        if (socketModule.broadcastNextPendingToOthers) {
          await socketModule.broadcastNextPendingToOthers(updatedTicket.Service.prefix, idCashier);
        }
        if (socketModule.redistributeTickets) {
          await socketModule.redistributeTickets(updatedTicket.Service.prefix);
        }
        console.log(`[UPDATE] Broadcast y redistribución completada para servicio ${updatedTicket.Service.prefix}`);
      } catch (e) {
        console.error('[UPDATE] Error en broadcast/redistribute:', e);
      }
      
    } else if (idTicketStatus === 4) {
      // Ticket fue completado - notificar para actualizar colas
      const room = updatedTicket.Service.prefix.toLowerCase();
      io.to(room).emit('ticket-completed', {
        ticket: payload,
        completedByCashier: currentTicket.idCashier,
        previousStatus: currentTicket.idTicketStatus,
        timestamp: Date.now()
      });
      console.log(`[UPDATE] Ticket ${updatedTicket.correlativo} completado por cajero ${currentTicket.idCashier}`);
      
      // Redistribuir tickets automáticamente después de completar
      setTimeout(async () => {
        try {
          const socketModule = require('../server/socket');
          if (socketModule.redistributeTickets) {
            await socketModule.redistributeTickets(updatedTicket.Service.prefix);
            console.log(`[UPDATE] Redistribución automática completada para servicio ${updatedTicket.Service.prefix}`);
          }
        } catch (e) {
          console.error('[UPDATE] Error en redistribución automática:', e);
        }
      }, 200);
    }
    
    // Evento general para otras pantallas
    io.emit('ticket-updated', payload);

    console.log('[UPDATE] Ticket actualizado exitosamente:', updatedTicket.correlativo);
    res.json(updatedTicket);
  } catch (error) {
    if (t.finished !== 'commit') await t.rollback();
    console.error('Error al actualizar ticket:', error);
    res.status(400).json({ error: error.message });
  }
};

/** LISTAR por STATUS (1 ó 2) incluyendo Client y Service */
exports.getPendingTickets = async (req, res) => {
  try {
    const status = parseInt(req.query.status || 1, 10);
    const tickets = await TicketRegistration.findAll({
      where: { idTicketStatus: status },
      include: [{ model: Client }, { model: Service }],
      order: [['createdAt', 'ASC']],
    });

    const payload = tickets.map((t) => toTicketPayload(t));
    res.json(payload);
  } catch (error) {
    console.error('Error al obtener tickets:', error);
    res.status(500).json({ error: error.message });
  }
};

/** DELETE */
exports.delete = async (req, res) => {
  try {
    const deleted = await TicketRegistration.destroy({
      where: { idTicketRegistration: req.params.id },
    });  if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
