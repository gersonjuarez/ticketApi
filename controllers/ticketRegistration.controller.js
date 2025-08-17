// controllers/ticketController.js
const { Op } = require('sequelize');
const { TicketRegistration, Client, Service, sequelize } = require('../models');

// ---- helper para unificar el payload que espera el front ----
const toTicketPayload = (ticket, client = null, service = null) => ({
  idTicketRegistration: ticket.idTicketRegistration,
  correlativo: ticket.correlativo,
  usuario: (client?.name ?? ticket.Client?.name) || 'Sin cliente',
  modulo: (service?.name ?? ticket.Service?.name) || '—',
  createdAt: ticket.createdAt,
  idTicketStatus: ticket.idTicketStatus,
});

// === LISTAR PENDIENTES (status 1) con filtro opcional por prefijo ===
exports.findAll = async (req, res) => {
  try {
    const { prefix } = req.query;
    const where = {
      idTicketStatus: 1,
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

// === LISTAR POR PREFIX (todos status con status=true) ===
exports.getTicketsByPrefix = async (req, res, next) => {
  try {
    const { prefix } = req.params;
    const service = await Service.findOne({ where: { prefix } });
    if (!service) return res.status(404).json({ message: 'Servicio no encontrado.' });

    const tickets = await TicketRegistration.findAll({
      where: { idService: service.idService, status: true },
      order: [['turnNumber', 'ASC']]
    });

    const payload = tickets.map((t) => ({
      idTicketRegistration: t.idTicketRegistration,
      turnNumber: t.turnNumber,
      correlativo: t.correlativo,
      createdAt: t.createdAt,
      prefix: service.prefix,
      name: service.name
    }));

    return res.json(payload);
  } catch (err) {
    next(err);
  }
};

// === UPDATE (emite ticket-updated enriquecido) ===
exports.update = async (req, res) => {
  try {
    const [updated] = await TicketRegistration.update(req.body, {
      where: { idTicketRegistration: req.params.id }
    });
    if (!updated) return res.status(404).json({ error: 'Not found' });

    // Traemos el ticket con relaciones para emitir datos completos
    const updatedTicket = await TicketRegistration.findByPk(req.params.id, {
      include: [{ model: Client }, { model: Service }],
    });

    const io = require('../server/socket').getIo();
    const payload = toTicketPayload(updatedTicket); // <-- incluye usuario, modulo e idTicketStatus
    io.emit('ticket-updated', payload);

    res.json(updatedTicket);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// === LISTAR por STATUS (1 ó 2) incluyendo Client y Service ===
exports.getPendingTickets = async (req, res) => {
  try {
    const status = parseInt(req.query.status || 1, 10);
    console.log('Obteniendo tickets con status:', status);

    const tickets = await TicketRegistration.findAll({
      where: { idTicketStatus: status },
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
