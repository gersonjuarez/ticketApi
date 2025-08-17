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
  idTicketStatus: ticket.idTicketStatus,
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
    const socketPayload = toTicketPayload(createdTicket, client, service);

    if (io) {
      io.to(room).emit('new-ticket', socketPayload);
      io.emit('new-ticket', socketPayload);

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

    const tickets = await TicketRegistration.findAll({
      where: { idService: service.idService, status: true },
      order: [['turnNumber', 'ASC']],
    });

    const payload = tickets.map((t) => ({
      idTicketRegistration: t.idTicketRegistration,
      turnNumber: t.turnNumber,
      correlativo: t.correlativo,
      createdAt: t.createdAt,
      prefix: service.prefix,
      name: service.name,
    }));

    return res.json(payload);
  } catch (err) {
    next(err);
  }
};

/** UPDATE (emite ticket-updated enriquecido) */
exports.update = async (req, res) => {
  try {
    const [updated] = await TicketRegistration.update(req.body, {
      where: { idTicketRegistration: req.params.id },
    });
    if (!updated) return res.status(404).json({ error: 'Not found' });

    // Traer con relaciones para emitir
    const updatedTicket = await TicketRegistration.findByPk(req.params.id, {
      include: [{ model: Client }, { model: Service }],
    });

    const io = require('../server/socket').getIo?.();
    if (io && updatedTicket) {
      const payload = toTicketPayload(updatedTicket);
      io.emit('ticket-updated', payload);
    }

    res.json(updatedTicket);
  } catch (error) {
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
    });
  if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
