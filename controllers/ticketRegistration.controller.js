// controllers/ticketController.js
const { Op } = require('sequelize');
const { TicketRegistration, Client, Service, TicketHistory, sequelize } = require('../models');

// ---- helper para unificar el payload que espera el front ----
const toTicketPayload = (ticket, client = null, service = null) => ({
  idTicketRegistration: ticket.idTicketRegistration,
  correlativo: ticket.correlativo,
  usuario: (client?.name ?? ticket.Client?.name) || 'Sin cliente',
  modulo: (service?.name ?? ticket.Service?.name) || '—',
  createdAt: ticket.createdAt,
  idTicketStatus: ticket.idTicketStatus,
});

// === LISTAR PENDIENTES Y DESPACHADOS (status 1 y 2) con filtro opcional por prefijo ===
exports.findAll = async (req, res) => {
  try {
    const { prefix } = req.query;
    const where = {
      idTicketStatus: { [Op.in]: [1] }, // Incluir tanto pendientes como despachados
      ...(prefix ? { correlativo: { [Op.like]: `${prefix}-%` } } : {})
    };
    const tickets = await TicketRegistration.findAll({ where });
    res.json(tickets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// === LISTAR EN ATENCIÓN / DESPACHADOS (status 2) ===
exports.findAllDispatched = async (req, res) => {
  try {
    const { prefix } = req.query;
    const where = {
      idTicketStatus: 2,
      ...(prefix ? { correlativo: { [Op.like]: `${prefix}-%` } } : {})
    };
    const tickets = await TicketRegistration.findAll({ where });
    res.json(tickets);
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

// === CREAR TICKET (dispara impresión y emite socket enriquecido) ===
exports.create = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const { dpi, name, idService: idServiceRaw, locationId } = req.body;
    console.log('[create] body:', req.body);

    const idService = typeof idServiceRaw === 'string' ? parseInt(idServiceRaw, 10) : idServiceRaw;

    if (!name || name.trim() === '') {
      await t.rollback();
      return res.status(400).json({ message: 'El nombre es obligatorio.' });
    }
    if (dpi && !/^\d{13}$/.test(dpi)) {
      await t.rollback();
      return res.status(400).json({ message: 'El DPI debe tener 13 dígitos numéricos.' });
    }

    // 1) Cliente
    let client;
    if (dpi) {
      [client] = await Client.findOrCreate({
        where: { dpi },
        defaults: { name, dpi },
        transaction: t,
      });
    } else {
      client = await Client.create({ name, dpi: null }, { transaction: t });
    }

    // 2) Servicio
    const service = await Service.findByPk(idService, { transaction: t });
    if (!service) {
      await t.rollback();
      return res.status(404).json({ message: 'Servicio no encontrado.' });
    }

    // 3) Turno correlativo por servicio
    const lastTurn =
      (await TicketRegistration.max('turnNumber', {
        where: { idService },
        transaction: t,
      })) || 0;

    const turnNumber = lastTurn + 1;
    const correlativo = `${service.prefix}-${turnNumber}`;

    // 4) Crear ticket
    const ticket = await TicketRegistration.create(
      {
        turnNumber,
        idTicketStatus: 1,
        idClient: client.idClient,
        idService,
        idCashier: null,
        status: true,
        correlativo,
      },
      { transaction: t }
    );

    await t.commit();

    // ====== EMITIR EVENTOS SOCKET (con payload enriquecido) ======
    const io = require('../server/socket').getIo();
    const room = service.prefix.toLowerCase();

    const payload = toTicketPayload(ticket, client, service); // <-- incluye usuario y modulo

    // a) Eventos para pantallas/TV (room específico + broadcast)
    io.to(room).emit('new-ticket', payload);
    io.emit('new-ticket', payload);

    // b) Imprimir (si mandaron locationId)
    if (locationId) {
      console.log('[create] enviando print-ticket a bridge:%s', locationId);
      const printJob = {
        type: 'escpos',
        payload: {
          header: 'SISTEMA DE TURNOS',
          subHeader: service.name,
          ticketNumber: correlativo,
          name,
          dpi: dpi || '',
          service: service.name,
          footer: 'Gracias por su visita',
          qrData: `TICKET:${correlativo}`,
        },
      };
      io.to(`bridge:${locationId}`).emit('print-ticket', printJob);
    } else {
      console.warn('[create] sin locationId, no se imprime');
    }

    return res.status(201).json(ticket);
  } catch (err) {
    if (t.finished !== 'commit') await t.rollback();
    next(err);
  }
};

// === LISTAR POR PREFIX (status 1 y 2 con status=true) ===
exports.getTicketsByPrefix = async (req, res, next) => {
  try {
    const { prefix } = req.params;
    const service = await Service.findOne({ where: { prefix } });
    if (!service) return res.status(404).json({ message: 'Servicio no encontrado.' });

    const tickets = await TicketRegistration.findAll({
      where: { 
        idService: service.idService, 
        status: true,
        idTicketStatus: { [Op.in]: [1, 2] } // Incluir pendientes y despachados
      },
      order: [['turnNumber', 'ASC']]
    });

    const payload = tickets.map((t) => ({
      idTicketRegistration: t.idTicketRegistration,
      turnNumber: t.turnNumber,
      correlativo: t.correlativo,
      createdAt: t.createdAt,
      prefix: service.prefix,
      name: service.name,
      idTicketStatus: t.idTicketStatus,
      idCashier: t.idCashier
    }));

    return res.json(payload);
  } catch (err) {
    next(err);
  }
};

// === NUEVO: OBTENER TICKETS PARA CAJERO ESPECÍFICO ===
exports.getTicketsForCashier = async (req, res) => {
  try {
    const { prefix, idCashier } = req.query;
    console.log('[getTicketsForCashier] prefix:', prefix, 'idCashier:', idCashier);

    const service = await Service.findOne({ where: { prefix } });
    if (!service) return res.status(404).json({ message: 'Servicio no encontrado.' });

    // 1. Obtener el ticket actual de esta secretaria (estado 2 + su idCashier)
    const currentTicket = await TicketRegistration.findOne({
      where: { 
        idService: service.idService,
        idTicketStatus: 2, // Despachado/En atención
        idCashier: idCashier,
        status: true
      },
      include: [{ model: Client }, { model: Service }],
      order: [['turnNumber', 'ASC']]
    });

    // 2. Obtener tickets pendientes (estado 1) para la cola
    const queueTickets = await TicketRegistration.findAll({
      where: { 
        idService: service.idService,
        idTicketStatus: 1, // Solo pendientes
        status: true
      },
      include: [{ model: Client }, { model: Service }],
      order: [['turnNumber', 'ASC']]
    });

    const response = {
      current: currentTicket ? toTicketPayload(currentTicket) : null,
      queue: queueTickets.map(t => toTicketPayload(t))
    };

    console.log('[getTicketsForCashier] Respuesta:', response);
    res.json(response);
  } catch (error) {
    console.error('[getTicketsForCashier] Error:', error);
    res.status(500).json({ error: error.message });
  }
};

// === UPDATE (emite ticket-updated enriquecido y guarda historial) ===
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

    // Verificar si el ticket ya está asignado a otro cajero (solo para estado 2)
    if (idTicketStatus === 2 && currentTicket.idTicketStatus === 1) {
      // Verificar si ya hay otro ticket en estado 2 para este servicio con otro cajero
      const existingDispatchedTicket = await TicketRegistration.findOne({
        where: {
          idService: currentTicket.idService,
          idTicketStatus: 2,
          idCashier: { [Op.ne]: idCashier } // Diferente cajero
        },
        transaction: t
      });

      if (existingDispatchedTicket) {
        await t.rollback();
        return res.status(409).json({ 
          error: 'Este ticket ya está siendo atendido por otro cajero',
          conflictTicket: existingDispatchedTicket.correlativo 
        });
      }
    }

    // Siempre actualizar con los nuevos valores
    const updateData = {
      idTicketStatus: idTicketStatus || currentTicket.idTicketStatus,
      idCashier: idCashier || currentTicket.idCashier,
      ...(observations && { observations })
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
    });

    const io = require('../server/socket').getIo();
    const payload = toTicketPayload(updatedTicket);
    
    // Emitir eventos específicos según el tipo de cambio
    if (idTicketStatus === 2 && currentTicket.idTicketStatus === 1) {
      // Ticket fue despachado/asignado - notificar a todas las secretarias del servicio
      const room = updatedTicket.Service.prefix.toLowerCase();
      io.to(room).emit('ticket-assigned', {
        ...payload,
        assignedToCashier: idCashier,
        action: 'dispatched'
      });
      console.log(`[UPDATE] Ticket ${updatedTicket.correlativo} asignado a cajero ${idCashier}`);
      
    } else if (idTicketStatus === 4) {
      // Ticket fue completado - notificar para actualizar colas
      const room = updatedTicket.Service.prefix.toLowerCase();
      io.to(room).emit('ticket-completed', {
        ...payload,
        previousCashier: currentTicket.idCashier,
        action: 'completed'
      });
      console.log(`[UPDATE] Ticket ${updatedTicket.correlativo} completado por cajero ${currentTicket.idCashier}`);
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

// === LISTAR por STATUS (1, 2, o custom) incluyendo Client y Service ===
exports.getPendingTickets = async (req, res) => {
  try {
    const status = parseInt(req.query.status || 1, 10);
    console.log('Obteniendo tickets con status:', status);

    let whereCondition;
    if (status === 1) {
      // Si piden status 1, incluir también status 2 para CashierDashboard
      whereCondition = { idTicketStatus: { [Op.in]: [1, 2] } };
    } else {
      // Para otros status, mantener comportamiento específico
      whereCondition = { idTicketStatus: status };
    }

    const tickets = await TicketRegistration.findAll({
      where: whereCondition,
      include: [{ model: Client }, { model: Service }],
      order: [['createdAt', 'ASC']]
    });

    const payload = tickets.map((t) => toTicketPayload(t));
    res.json(payload);
  } catch (error) {
    console.error('Error al obtener tickets:', error);
    res.status(500).json({ error: error.message });
  }
};

// === DELETE ===
exports.delete = async (req, res) => {
  try {
    const deleted = await TicketRegistration.destroy({
      where: { idTicketRegistration: req.params.id }
    });
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
