// Controller for TicketRegistration CRUD operations
const { TicketRegistration } = require('../models');
const { Op } = require('sequelize');

exports.findAll = async (req, res) => {
  try {
    const { prefix } = req.query;
    const where = {
      idTicketStatus: 1, // Only pending tickets
      ...(prefix ? { correlativo: { [Op.like]: `${prefix}-%` } } : {})
    };
    const tickets = await TicketRegistration.findAll({ where });
    res.json(tickets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.findAllDispatched = async (req, res) => {
  try {
    const { prefix } = req.query;
    const where = {
      idTicketStatus: 2, // Only dispatched tickets
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
    const ticket = await TicketRegistration.findByPk(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Not found' });
    res.json(ticket);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// POST /api/ticket-registration
// POST /api/ticket-registration
exports.create = async (req, res, next) => {
  try {
    const { dpi, name, idService: idServiceRaw } = req.body;
    const idService = typeof idServiceRaw === 'string' ? parseInt(idServiceRaw, 10) : idServiceRaw;

    console.log("VALOR DE BODY: ", req.body);

    // Validación básica de nombre
    if (!name || name.trim() === "") {
      return res.status(400).json({ message: 'El nombre es obligatorio.' });
    }

    // Validación opcional de DPI (si se envía)
    if (dpi && !/^\d{13}$/.test(dpi)) {
      return res.status(400).json({ message: 'El DPI debe tener 13 dígitos numéricos.' });
    }

    // 1) Cliente: buscar o crear (si viene DPI); crear sin buscar si es null
    const Client = require('../models').Client;
    let client;

    if (dpi) {
      [client] = await Client.findOrCreate({
        where: { dpi },
        defaults: { name, dpi }
      });
    } else {
      client = await Client.create({ name, dpi: null });
    }

    console.log("valor de client:", client);

    // 2) Validar servicio
    const Service = require('../models').Service;
    const service = await Service.findByPk(idService);
    console.log("VALOR DE SERVICIO:", service);

    if (!service) {
      return res.status(404).json({ message: 'Servicio no encontrado.' });
    }

    // 3) Obtener último turno y generar nuevo
    const lastTurn = await require('../models').TicketRegistration.max('turnNumber', {
      where: { idService }
    }) || 0;

    console.log("VALOR DE LASTTURN:", lastTurn);

    const turnNumber = lastTurn + 1;
    const correlativo = `${service.prefix}-${turnNumber}`;

    // 4) Crear ticket
    let ticket;
    try {
      ticket = await require('../models').TicketRegistration.create({
        turnNumber,
        idTicketStatus: 1,
        idClient: client.idClient,
        idService,
        idCashier: null,
        status: true,
        correlativo
      });
    } catch (err) {
      console.error('Sequelize Error:', err.message);
      console.error('SQL:', err.sql);
      console.error('Parameters:', err.parameters);
      return next(err);
    }

    // 5) Emitir por socket.io al room del servicio
    const io = require('../server/socket').getIo();
    const room = service.prefix.toLowerCase();

    console.log(`🔔 Emitting new-ticket to room → '${room}'`);
    io.to(room).emit('new-ticket', {
      idTicketRegistration: ticket.idTicketRegistration,
      turnNumber,
      correlativo,
      prefix: room,
      name: service.name,
      createdAt: ticket.createdAt
    });

    // Emitir broadcast global también
    io.emit('new-ticket', {
      idTicketRegistration: ticket.idTicketRegistration,
      turnNumber,
      correlativo,
      prefix: room,
      name: service.name,
      createdAt: ticket.createdAt
    });

    return res.status(201).json(ticket);
  } catch (err) {
    next(err);
  }
};


// GET /api/ticket-registration/:prefix
exports.getTicketsByPrefix = async (req, res, next) => {
  try {
    const { prefix } = req.params;
    const Service = require('../models').Service;
    const service = await Service.findOne({ where: { prefix } });
    if (!service) return res.status(404).json({ message: 'Servicio no encontrado.' });

    // traer sólo pendientes (status = true) y ordenados
    const tickets = await require('../models').TicketRegistration.findAll({
      where: {
        idService: service.idService,
        status: true
      },
      order: [['turnNumber', 'ASC']]
    });

    // mapear payload para frontend
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

exports.update = async (req, res) => {
  try {
    const [updated] = await TicketRegistration.update(req.body, {
      where: { idTicketRegistration: req.params.id }
    });
    if (!updated) return res.status(404).json({ error: 'Not found' });
    const updatedTicket = await TicketRegistration.findByPk(req.params.id);
    // Emitir por socket el ticket actualizado
    const io = require('../server/socket').getIo();
    // Emitir por socket el ticket actualizado con el mismo formato que new-ticket
    io.emit('ticket-updated', {
      idTicketRegistration: updatedTicket.idTicketRegistration,
      turnNumber: updatedTicket.turnNumber,
      correlativo: updatedTicket.correlativo,
      prefix: updatedTicket.prefix, // Asegúrate que el modelo tiene este campo, si no, obtén el service
      name: updatedTicket.name,     // idem
      createdAt: updatedTicket.createdAt
    });
    res.json(updatedTicket);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
exports.getPendingTickets = async (req, res) => {
  try {
    const Client = require('../models').Client;

    const tickets = await TicketRegistration.findAll({
      where: { idTicketStatus: 1 },
      include: [{ model: Client }],
      order: [['createdAt', 'ASC']]
    });

    const payload = tickets.map((t) => ({
      idTicketRegistration: t.idTicketRegistration,
      correlativo: t.correlativo,
      usuario: t.Client?.dpi || t.Client?.name || 'Sin cliente',
      modulo: t.modulo || '—', // puedes ajustar según tu lógica
      createdAt: t.createdAt,
      idTicketStatus: t.idTicketStatus
    }));

    res.json(payload);
  } catch (error) {
    console.error('Error al obtener tickets pendientes:', error);
    res.status(500).json({ error: error.message });
  }
};
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
