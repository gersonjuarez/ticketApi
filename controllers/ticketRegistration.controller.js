
const { Op, Transaction } = require("sequelize");
const {
  TicketRegistration,
  TicketAttendance,
  TicketHistory,
  TicketTransferLog,
  Client,
  Service,
  Cashier,
  PrintOutbox,
  sequelize,
} = require("../models");
const Attendance = require("../services/attendance.service");
const tz = require('date-fns-tz');

// Helpers nuevos (asegúrate de tener los archivos en utils/)
const { getNextTurnNumber, padN } = require("../utils/turnNumbers");
const { fmtGuatemalaYYYYMMDDHHmm } = require("../utils/time-tz");
// Prioriza tickets reservados para el cajero dado (0 = mayor prioridad)
// Prioriza reservados para el cajero y asegura FIFO real por turnNumber
const buildOrderForCashier = (cashierId = 0) => {
  const cid = Number(cashierId) || 0;
  return [
    [
      sequelize.literal(`
        CASE
          WHEN "forcedToCashierId" = ${cid} THEN 0   -- prioridad: reservados para mí
          WHEN "forcedToCashierId" IS NULL THEN 1    -- luego los normales
          ELSE 2                                     -- y al final los forzados a otros
        END
      `),
      "ASC",
    ],
    ["idTicketStatus", "ASC"],       // pendientes primero
    
    // ✅ NUEVO ORDEN: Primero por si es trasladado, luego por creación
   [
  sequelize.literal(`
    CASE 
      WHEN transferred_at IS NULL THEN 0
      ELSE 1
    END
  `),
  "ASC"
],
    ["createdAt", "ASC"],           // FIFO real por creación
    ["turnNumber", "ASC"],          // Solo como desempate
    
    ["updatedAt", "ASC"],
    ["transferredAt", "ASC"],       // Los trasladados van al final
  ];
};


const applyServiceOrForced = (baseWhere, svcId, idCashierQ, respectForced) => {
  if (!svcId) return baseWhere;
  if (respectForced && idCashierQ) {
    // Muestra tickets del servicio actual O reservados para mí O en atención conmigo
    const orBlock = {
      [Op.or]: [
        { idService: svcId },
        { forcedToCashierId: idCashierQ },
        { idCashier: idCashierQ },
      ],
    };
    return baseWhere[Op.and]
      ? { ...baseWhere, [Op.and]: [...baseWhere[Op.and], orBlock] }
      : { ...baseWhere, [Op.and]: [orBlock] };
  }
  // Comportamiento clásico si no hay cashier/respectForced
  return { ...baseWhere, idService: svcId };
};
/* ============================
   Constantes de estado
============================ */
const STATUS = {
  PENDIENTE: 1,
  EN_ATENCION: 2,
  COMPLETADO: 3,
  CANCELADO: 4,
  TRASLADO: 5, // <— NUEVO
};

/* ============================
   Helpers locales ligeros
============================ */
const s = (v, def = "") => (v === null || v === undefined ? def : String(v));

async function getServiceByPrefix(prefix) {
  if (!prefix) return null;
  return Service.findOne({
    where: sequelize.where(
      sequelize.fn("upper", sequelize.col("prefix")),
      String(prefix).toUpperCase()
    ),
  });
}

const isUniqueError = (err) => {
  if (!err) return false;
  const msg = String(err.message || "").toLowerCase();
  return (
    err.name === "SequelizeUniqueConstraintError" ||
    msg.includes("unique") ||
    msg.includes("duplicate") ||
    msg.includes("duplicada") ||
    msg.includes("duplicado")
  );
};

/** Clausula de visibilidad por servicio respetando la “bandera” forcedToCashierId */
const addForcedVisibilityClause = (baseWhere, idCashierQ, respectForced) => {
  if (!respectForced) return baseWhere;
  if (!idCashierQ) return baseWhere;
  const orForced = {
    [Op.or]: [{ forcedToCashierId: null }, { forcedToCashierId: idCashierQ }],
  };
  return baseWhere[Op.and]
    ? { ...baseWhere, [Op.and]: [...baseWhere[Op.and], orForced] }
    : { ...baseWhere, [Op.and]: [orForced] };
};

const toTicketPayload = (ticket, client = null, service = null, overrides = {}) => ({
  idTicketRegistration: ticket.idTicketRegistration,
  turnNumber: ticket.turnNumber,
  correlativo: ticket.correlativo,
  prefix: (overrides.prefix ?? service?.prefix ?? ticket.Service?.prefix) || undefined,
  usuario: (client?.name ?? ticket.Client?.name) || "Sin cliente",
  modulo: (overrides.modulo ?? (service?.name ?? ticket.Service?.name)) || "—",
  createdAt: ticket.createdAt,
  updatedAt: ticket.updatedAt,
  idTicketStatus: ticket.idTicketStatus,
  idCashier: ticket.idCashier,
  dispatchedByUser: ticket.dispatchedByUser,
  idService: ticket.idService,
  idClient: ticket.idClient,
  status: ticket.status,
  forcedToCashierId: ticket.forcedToCashierId ?? null,
});

const toCreatedTicketPayload = ({
  ticket,
  client,
  service,
  cashier = null,
}) => ({
  idTicketRegistration: ticket.idTicketRegistration,
  turnNumber: ticket.turnNumber,
  correlativo: ticket.correlativo,
  prefix: service.prefix,
  createdAt: ticket.createdAt,
  idTicketStatus: ticket.idTicketStatus,
  client: client
    ? { idClient: client.idClient, name: client.name, dpi: client.dpi || null }
    : null,
  service: {
    idService: service.idService,
    name: service.name,
    prefix: service.prefix,
  },
  idCashier: ticket.idCashier ?? null,
  cashier: cashier
    ? { idCashier: cashier.idCashier, name: cashier.name }
    : null,
});

/* ============================
   Listados simples
============================ */

exports.findAll = async (req, res) => {
  try {
    const { prefix, idCashier: idCashierRaw, respectForced } = req.query;
    const idCashierQ = Number.isFinite(Number(idCashierRaw))
      ? Number(idCashierRaw)
      : 0;

    // ✅ default = true
    const respect = respectForced !== "false";

    let where = { idTicketStatus: STATUS.PENDIENTE };

    let svc = null;
    if (prefix) {
      svc = await getServiceByPrefix(prefix);
      if (!svc) return res.json([]);
      // ⬇️ clave: OR por servicio/forced/idCashier
      where = applyServiceOrForced(where, svc.idService, idCashierQ, respect);
    }

    // ⬇️ clave: oculta los reservados a otros
    where = addForcedVisibilityClause(where, idCashierQ, respect);

    const tickets = await TicketRegistration.findAll({
      where,
      include: [{ model: Service }, { model: Client }],
      order: buildOrderForCashier(idCashierQ),
    });

    res.json(tickets.map((t) => toTicketPayload(t, t.Client, t.Service)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.findAllDispatched = async (req, res) => {
  try {
    const { prefix, idCashier: idCashierRaw, respectForced } = req.query;
    const idCashierQ = Number.isFinite(Number(idCashierRaw))
      ? Number(idCashierRaw)
      : 0;
    const respect = respectForced !== "false"; // ✅ default true

    let where = { idTicketStatus: STATUS.EN_ATENCION };

    let svc = null;
    if (prefix) {
      svc = await getServiceByPrefix(prefix);
      if (!svc) return res.json([]);
      // ⬇️ ver en atención conmigo aunque el servicio no coincida
      where = applyServiceOrForced(where, svc.idService, idCashierQ, respect);
    }

    where = addForcedVisibilityClause(where, idCashierQ, respect);

    const tickets = await TicketRegistration.findAll({
      where,
      include: [{ model: Service }, { model: Client }],
      order: buildOrderForCashier(idCashierQ),
    });
    res.json(tickets.map((t) => toTicketPayload(t, t.Client, t.Service)));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.findById = async (req, res) => {
  try {
    const ticket = await TicketRegistration.findByPk(req.params.id, {
      include: [{ model: Client }, { model: Service }],
    });
    if (!ticket) return res.status(404).json({ error: "Not found" });
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
      typeof idServiceRaw === "string"
        ? parseInt(idServiceRaw, 10)
        : idServiceRaw;

    // Validaciones
    if (!name || name.trim() === "") {
      return res.status(400).json({ message: "El nombre es obligatorio." });
    }
    if (dpi && !/^\d{13}$/.test(dpi)) {
      return res
        .status(400)
        .json({ message: "El DPI debe tener 13 dígitos numéricos." });
    }

    // 1) Cliente
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
      return res.status(404).json({ message: "Servicio no encontrado." });
    }

    // 3) Reintento de creación con transacción (colisiones únicas)
    const maxAttempts = 3;
    let createdTicket = null;
    let lastErr = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const t = await sequelize.transaction({
        isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED,
      });
      try {
        // Número de turno por día (America/Guatemala) + correlativo 3 dígitos
        const turnNumber = await getNextTurnNumber(idService, t);
        const correlativo = `${service.prefix}-${padN(turnNumber, 3)}`;

        const ticket = await TicketRegistration.create(
          {
            turnNumber,
            idTicketStatus: STATUS.PENDIENTE,
            idClient: client.idClient,
            idService,
            idCashier: null,
            status: true,
            correlativo,
            forcedToCashierId: null,
            printStatus: "pending",
          },
          { transaction: t }
        );

        await t.commit();
        createdTicket = ticket;
        lastErr = null;
        break;
      } catch (err) {
        try {
          if (t.finished !== "commit") await t.rollback();
        } catch {}
        lastErr = err;
        if (isUniqueError(err) && attempt < maxAttempts) {
          // pequeño backoff aleatorio
          await new Promise((r) =>
            setTimeout(r, Math.floor(Math.random() * 25) + 10)
          );
          continue;
        }
        break;
      }
    }

    if (!createdTicket) {
      if (lastErr) return next(lastErr);
      return res.status(500).json({ message: "No se pudo crear el ticket." });
    }

    // ====== SOCKETS ======
    const io = require("../server/socket").getIo?.();
    const room = String(service.prefix || "").toLowerCase();
    const socketPayload = toTicketPayload(createdTicket, client, service);

    if (io) {
      io.to(room).emit("new-ticket", socketPayload);
      io.to("tv").emit("new-ticket", socketPayload);
    }

    // ====== COLA DE IMPRESIÓN ======
    if (locationId) {
      const existing = await PrintOutbox.findOne({
        where: {
          ticket_id: createdTicket.idTicketRegistration,
          status: { [Op.in]: ["pending", "sent"] },
        },
      });

      if (!existing) {
        const printPayload = {
          type: "escpos",
          header: "SISTEMA DE TURNOS",
          subHeader: s(service.name, ""),
          ticketNumber: s(socketPayload.correlativo, "---"),
          name: s(client?.name, ""),
          dpi: s(client?.dpi, ""),
          service: s(service.name, ""),
          footer: "Gracias por su visita",
          dateTime: fmtGuatemalaYYYYMMDDHHmm(new Date()),
        };

        const TTL_MS = 60_000;
        const expiresAt = new Date(Date.now() + TTL_MS);

        const newJob = await PrintOutbox.create({
          ticket_id: createdTicket.idTicketRegistration,
          location_id: locationId,
          payload: printPayload,
          status: "pending",
          attempts: 0,
          expires_at: expiresAt,
        });

        const socketModule = require("../server/socket");
        const io2 = socketModule.getIo?.();
        if (io2) {
          await newJob.update({
            status: "sent",
            attempts: (newJob.attempts || 0) + 1,
            last_error: null,
          });

          await TicketRegistration.update(
            { printStatus: "sent" },
            {
              where: {
                idTicketRegistration: createdTicket.idTicketRegistration,
              },
            }
          );

          io2.to(`bridge:${locationId}`).emit("print-ticket", {
            jobId: newJob.id,
            type: printPayload.type,
            payload: printPayload,
          });
        }
      }
    }

    // Respuesta
    const responsePayload = toCreatedTicketPayload({
      ticket: createdTicket,
      client,
      service,
      cashier: null,
    });

    return res.status(201).json(responsePayload);
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
};

/* ============================
   Otros listados / update / delete
============================ */

exports.getTicketsByPrefix = async (req, res, next) => {
  try {
    const { prefix } = req.params;
    const { idCashier: idCashierRaw, respectForced } = req.query;
    const idCashierQ = Number.isFinite(Number(idCashierRaw))
      ? Number(idCashierRaw)
      : 0;
    const respect = respectForced !== "false";

    const service = await getServiceByPrefix(prefix);
    if (!service)
      return res.status(404).json({ message: "Servicio no encontrado." });

    let where = {
      status: true,
      idTicketStatus: STATUS.PENDIENTE,
    };
    where = applyServiceOrForced(where, service.idService, idCashierQ, respect);
    where = addForcedVisibilityClause(where, idCashierQ, respect);

    const tickets = await TicketRegistration.findAll({
      where,
      order: buildOrderForCashier(idCashierQ),
    });

    const payload = tickets.map((t) => ({
      idTicketRegistration: t.idTicketRegistration,
      turnNumber: t.turnNumber,
      correlativo: t.correlativo,
      createdAt: t.createdAt,
      prefix: service.prefix,
      name: service.name,
      forcedToCashierId: t.forcedToCashierId ?? null,
    }));

    return res.json(payload);
  } catch (err) {
    next(err);
  }
};

// controllers/ticketRegistration.controller.js

exports.getTicketsForCashier = async (req, res) => {
  try {
    const cashierId = parseInt(req.query.idCashier || 0, 10);
    if (!cashierId) {
      return res.status(400).json({ error: "idCashier requerido" });
    }

    const autoClaimReserved =
      String(req.query.autoClaimReserved || "").toLowerCase() === "true";

    const cashier = await Cashier.findByPk(cashierId, {
      include: [
        { model: Service, attributes: ["idService", "prefix", "name"] },
      ],
    });
    if (!cashier || !cashier.status) {
      return res
        .status(404)
        .json({ error: "Ventanilla no encontrada o inactiva" });
    }
    const svcId = Number(cashier.idService);

    const currentTicket = await TicketRegistration.findOne({
      where: {
        idTicketStatus: STATUS.EN_ATENCION,
        idCashier: cashierId,
        status: true,
      },
      include: [{ model: Client }, { model: Service }],
      order: [["turnNumber", "ASC"]],
    });

    const queueWhere = {
      status: true,
      idTicketStatus: STATUS.PENDIENTE,
      [Op.or]: [
        { forcedToCashierId: cashierId }, // (a) reservados para mí
        { [Op.and]: [{ idService: svcId }, { forcedToCashierId: null }] }, // (b) del servicio sin reserva
      ],
    };

    const queueTickets = await TicketRegistration.findAll({
      where: queueWhere,
      include: [{ model: Client }, { model: Service }],
      order: [
        [
          sequelize.literal(`
            CASE
              WHEN "forcedToCashierId" = ${cashierId} THEN 0
              WHEN "forcedToCashierId" IS NULL THEN 1
              ELSE 2
            END
          `),
          "ASC",
        ],
        ["turnNumber", "ASC"], // ⬅️ FIFO real
        ["createdAt", "ASC"],
        ["updatedAt", "ASC"],
      ],
    });

    const response = {
      current: currentTicket
        ? toTicketPayload(
            currentTicket,
            currentTicket.Client,
            currentTicket.Service
          )
        : null,
      queue: queueTickets.map((t) => toTicketPayload(t, t.Client, t.Service)),
    };

    if (
      response.current &&
      response.current.idTicketStatus === STATUS.EN_ATENCION
    ) {
      const openSpan = await TicketAttendance.findOne({
        where: {
          idTicket: response.current.idTicketRegistration,
          endedAt: null,
        },
        order: [["startedAt", "DESC"]],
      });
      response.currentAttentionStartedAt = openSpan ? openSpan.startedAt : null;
    }

    if (!currentTicket && autoClaimReserved) {
      const reserved = await TicketRegistration.findOne({
        where: {
          status: true,
          idTicketStatus: STATUS.PENDIENTE,
          forcedToCashierId: cashierId,
        },
        include: [{ model: Client }, { model: Service }],
        order: buildOrderForCashier(cashierId),
      });

      if (reserved) {
        response.nextReserved = toTicketPayload(
          reserved,
          reserved.Client,
          reserved.Service
        );
      }
    }

    return res.json(response);
  } catch (error) {
    console.error("[getTicketsForCashier] Error:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.update = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { idCashier, idTicketStatus, observations } = req.body;
    const ticketId = req.params.id;

    const currentTicket = await TicketRegistration.findByPk(ticketId, {
      include: [{ model: Client }, { model: Service }],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!currentTicket) {
      await t.rollback();
      return res.status(404).json({ error: "Ticket no encontrado" });
    }

    // === Validaciones de reserva / carreras para EN_ATENCION ===
    if (idTicketStatus === STATUS.EN_ATENCION) {
      // reservado a otro
      if (
        currentTicket.forcedToCashierId &&
        Number(currentTicket.forcedToCashierId) !== Number(idCashier)
      ) {
        await t.rollback();
        return res.status(403).json({
          error: "TICKET_FORCED_TO_OTHER_CASHIER",
          message: "Este ticket está reservado para otra ventanilla",
          forcedToCashierId: currentTicket.forcedToCashierId,
        });
      }

      // ya en atención por otro cajero
      if (
        currentTicket.idTicketStatus === STATUS.EN_ATENCION &&
        currentTicket.idCashier &&
        currentTicket.idCashier !== idCashier
      ) {
        await t.rollback();
        return res.status(409).json({
          error: "Este ticket ya está siendo atendido por otro cajero",
          conflictTicket: currentTicket.correlativo,
          currentCashier: currentTicket.idCashier,
        });
      }

      // 🔒 Bloquear fila del cajero y validar que no tenga otro ticket en atención
      const cashierRow = await Cashier.findByPk(idCashier, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!cashierRow || !cashierRow.status || cashierRow.isOutOfService) {
        await t.rollback();
        return res.status(409).json({ error: 'La ventanilla no está operativa' });
      }

      const concurrent = await TicketRegistration.findOne({
        where: {
          status: true,
          idTicketStatus: STATUS.EN_ATENCION,
          idCashier,
          idTicketRegistration: { [Op.ne]: Number(ticketId) },
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (concurrent) {
        await t.rollback();
        return res.status(409).json({
          error: 'CASHIER_BUSY',
          message: 'Ya hay un ticket en atención en esta ventanilla.',
          conflictTicket: concurrent.correlativo,
        });
      }
    }

    const newStatus = idTicketStatus ?? currentTicket.idTicketStatus;
    const newCashierId = idCashier ?? currentTicket.idCashier ?? null;

    const updateData = {
      idTicketStatus: newStatus,
      idCashier: newCashierId,
      ...(observations && { observations }),
      ...(newStatus === STATUS.EN_ATENCION &&
        currentTicket.idTicketStatus === STATUS.PENDIENTE && {
          dispatchedByUser: req.body.changedByUser || req.body.idUser || 1,
        }),
    };

    const [updated] = await TicketRegistration.update(updateData, {
      where: { idTicketRegistration: ticketId },
      transaction: t,
    });

    if (!updated) {
      await t.rollback();
      return res.status(404).json({ error: "No se pudo actualizar" });
    }

    const now = new Date();
    if (newStatus === STATUS.EN_ATENCION) {
      await Attendance.rotateSpan(
        {
          idTicket: Number(ticketId),
          idCashier: newCashierId,
          idService: currentTicket.idService,
          at: now,
        },
        t
      );
    } else if (
      currentTicket.idTicketStatus === STATUS.EN_ATENCION &&
      newStatus !== STATUS.EN_ATENCION
    ) {
      await Attendance.closeOpenSpan(
        { idTicket: Number(ticketId), at: now },
        t
      );
    }

    await TicketHistory.create(
      {
        idTicket: ticketId,
        fromStatus: currentTicket.idTicketStatus,
        toStatus: newStatus,
        changedByUser: req.body.changedByUser || 1,
      },
      { transaction: t }
    );

    await t.commit();

    let attentionStartedAt = null;
    if (newStatus === STATUS.EN_ATENCION) {
      const openSpan = await TicketAttendance.findOne({
        where: { idTicket: Number(ticketId), endedAt: null },
        order: [["startedAt", "DESC"]],
      });
      attentionStartedAt = openSpan ? openSpan.startedAt : null;
    }

    const updatedTicket = await TicketRegistration.findByPk(ticketId, {
      include: [{ model: Client }, { model: Service }],
    });

    const io2 = require("../server/socket").getIo?.();
    const payload = toTicketPayload(
      updatedTicket,
      updatedTicket.Client,
      updatedTicket.Service
    );

    if (io2) {
      if (
        newStatus === STATUS.EN_ATENCION &&
        currentTicket.idTicketStatus === STATUS.PENDIENTE
      ) {
        const socketModule = require("../server/socket");
        const room = updatedTicket.Service.prefix.toLowerCase();

        const assignedPayload = {
          ticket: payload,
          assignedToCashier: newCashierId,
          previousStatus: currentTicket.idTicketStatus,
          timestamp: Date.now(),
          attentionStartedAt,
        };

        if (socketModule.emitToAvailableCashiers) {
          await socketModule.emitToAvailableCashiers(
            updatedTicket.Service.prefix,
            "ticket-assigned",
            assignedPayload,
            newCashierId
          );
          const io3 = require("../server/socket").getIo?.();
          io3 && io3.to(`cashier:${newCashierId}`).emit("ticket-assigned", assignedPayload);
        } else {
          io2.to(room).emit("ticket-assigned", assignedPayload);
          io2.to(`cashier:${newCashierId}`).emit("ticket-assigned", assignedPayload);
        }

        io2.to("tv").emit("ticket-assigned", assignedPayload);

     } else if (newStatus === STATUS.COMPLETADO) {
  const room = updatedTicket.Service.prefix.toLowerCase();
  const completedPayload = {
    ticket: payload,
    completedByCashier: currentTicket.idCashier,
    previousStatus: currentTicket.idTicketStatus,
    timestamp: Date.now(),
  };
  io2.to(room).emit("ticket-completed", completedPayload);
  io2.to("tv").emit("ticket-completed", completedPayload);
// 🔁 Refrescar la cola del servicio completado
const socketModule = require("../server/socket");
if (socketModule.redistributeTickets) {
  await socketModule.redistributeTickets(updatedTicket.Service.prefix);
  io2.to(room).emit("queue-updated");
  io2.to("tv").emit("queue-updated");
  console.log(`[update] 🔁 Redistribución después de COMPLETADO en ${updatedTicket.Service.prefix}`);
}
    } else if (newStatus === STATUS.CANCELADO) {
  const room = updatedTicket.Service.prefix.toLowerCase();
  const cancelledPayload = {
    ticket: payload,
    cancelledByCashier: currentTicket.idCashier,
    previousStatus: currentTicket.idTicketStatus,
    timestamp: Date.now(),
  };
  io2.to(room).emit("ticket-cancelled", cancelledPayload);
  io2.to("tv").emit("ticket-cancelled", cancelledPayload);

  // 🔁 Refrescar la cola del servicio cancelado
  const socketModule = require("../server/socket");
  if (socketModule.redistributeTickets) {
    await socketModule.redistributeTickets(updatedTicket.Service.prefix);
    io2.to(room).emit("queue-updated");
    io2.to("tv").emit("queue-updated");
    console.log(`[update] 🔁 Redistribución después de CANCELADO en ${updatedTicket.Service.prefix}`);
  }
}

      io2.emit("ticket-updated", payload);
    }

    try {
      const socketModule = require("../server/socket");
      if (
        currentTicket.idTicketStatus === STATUS.EN_ATENCION &&
        (newStatus === STATUS.CANCELADO || newStatus === STATUS.COMPLETADO)
      ) {
        const freedCashierId = newCashierId || currentTicket.idCashier || null;
        if (freedCashierId) {
          await socketModule.pickNextForCashier?.(
            updatedTicket.Service.prefix,
            freedCashierId
          );
        }
      }
    } catch (e) {
      console.error("[update] pickNextForCashier error:", e?.message || e);
    }

    res.json(updatedTicket);
  } catch (error) {
    if (t.finished !== "commit") await t.rollback();
    console.error("Error al actualizar ticket:", error);
    res.status(400).json({ error: error.message });
  }
};


exports.getPendingTickets = async (req, res) => {
  try {
    const { idCashier: idCashierRaw, respectForced, prefix } = req.query;
    const idCashierQ = Number.isFinite(Number(idCashierRaw))
      ? Number(idCashierRaw)
      : 0;
    const respect = respectForced !== "false"; // ✅ default true

    let where = {
      idTicketStatus: parseInt(req.query.status || STATUS.PENDIENTE, 10),
    };

    let svc = null;
    if (prefix) {
      svc = await getServiceByPrefix(prefix);
      if (!svc) return res.json([]);
      where = applyServiceOrForced(where, svc.idService, idCashierQ, respect);
    }

    where = addForcedVisibilityClause(where, idCashierQ, respect);

    const tickets = await TicketRegistration.findAll({
      where,
      include: [{ model: Client }, { model: Service }],
      order: buildOrderForCashier(idCashierQ),
    });

    res.json(tickets.map((t) => toTicketPayload(t)));
  } catch (error) {
    console.error("Error al obtener tickets:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const deleted = await TicketRegistration.destroy({
      where: { idTicketRegistration: req.params.id },
    });
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.findAllLive = async (req, res) => {
  try {
    const {
      prefix,
      statuses,
      idCashier: idCashierRaw,
      respectForced,
    } = req.query;
    const idCashierQ = Number.isFinite(Number(idCashierRaw))
      ? Number(idCashierRaw)
      : 0;
    const respect = respectForced !== "false"; // ✅ default true

    let ids = [STATUS.PENDIENTE, STATUS.EN_ATENCION];
    if (statuses) {
      ids = String(statuses)
        .split(",")
        .map((s) => parseInt(s, 10))
        .filter(Number.isFinite);
      if (ids.length === 0) ids = [STATUS.PENDIENTE, STATUS.EN_ATENCION];
    }

    let where = { status: true, idTicketStatus: { [Op.in]: ids } };

    let svc = null;
    if (prefix) {
      svc = await getServiceByPrefix(prefix);
      if (!svc) return res.json([]);
      where = applyServiceOrForced(where, svc.idService, idCashierQ, respect);
    }

    where = addForcedVisibilityClause(where, idCashierQ, respect);

    const rows = await TicketRegistration.findAll({
      where,
      include: [{ model: Client }, { model: Service }],
      order: buildOrderForCashier(idCashierQ),
    });

    const payload = rows.map((t) => toTicketPayload(t, t.Client, t.Service));
    return res.json(payload);
  } catch (err) {
    console.error("findAllLive error:", err);
    return res
      .status(500)
      .json({
        error: "SERVER_ERROR",
        message: "No se pudieron obtener tickets",
      });
  }
};
// ============================================
// TRANSFERENCIA DE TICKET ENTRE SERVICIOS/CAJEROS
// ============================================
exports.transfer = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const idTicketRegistration =
      Number(req.params.id) || Number(req.body.idTicketRegistration);
    const {
      toCashierId,
      fromCashierId = null,
      performedByUserId = 1,
      comment = null,
    } = req.body;

    if (!idTicketRegistration || !toCashierId) {
      await transaction.rollback();
      return res.status(400).json({
        ok: false,
        message:
          "Parámetros incompletos: idTicketRegistration y toCashierId son requeridos.",
      });
    }

    const ticket = await TicketRegistration.findByPk(idTicketRegistration, {
      include: [
        { model: Service, attributes: ["idService", "prefix", "name"] },
        { model: Client, attributes: ["idClient", "name", "dpi"] },
      ],
      transaction,
    });

    if (!ticket) throw new Error("Ticket no encontrado.");
    if (ticket.idTicketStatus !== STATUS.EN_ATENCION)
      throw new Error("Solo se pueden transferir tickets en atención.");

    const fromServiceId = ticket.idService;

    const cashierDestino = await Cashier.findByPk(toCashierId, {
      include: [{ model: Service, attributes: ["idService", "prefix", "name"] }],
      transaction,
    });
    if (!cashierDestino) throw new Error("Cajero destino no encontrado.");

    const prefixDestino = cashierDestino.Service.prefix;
    const serviceDestinoId = cashierDestino.Service.idService;

    // 🔹 Cerrar asistencias activas
    await TicketAttendance.update(
      { endedAt: new Date() },
      {
        where: { idTicket: idTicketRegistration, endedAt: null },
        transaction,
      }
    );

    // 🔹 Actualizar ticket: no cambia número ni correlativo
    ticket.idService = serviceDestinoId;
    ticket.idCashier = null;
    ticket.idTicketStatus = STATUS.PENDIENTE;
    ticket.forcedToCashierId = null;
    ticket.transferredAt = new Date(); // ✅ marca traslado
    ticket.updatedAt = new Date();

    await ticket.save({ transaction });

    await TicketHistory.create(
      {
        idTicket: idTicketRegistration,
        fromStatus: STATUS.EN_ATENCION,
        toStatus: STATUS.PENDIENTE,
        changedByUser: performedByUserId,
        timestamp: new Date(),
      },
      { transaction }
    );

    if (TicketTransferLog) {
      await TicketTransferLog.create(
        {
          idTicketRegistration,
          fromService: fromServiceId,
          toService: serviceDestinoId,
          fromCashierId,
          toCashierId,
          performedByUserId,
          comment,
          createdAt: new Date(),
        },
        { transaction }
      );
    }

    await transaction.commit();

    const socketModule = require("../server/socket");
    const io = socketModule.getIo?.();

    if (io) {
      const roomDestino = prefixDestino.toLowerCase();
      const roomOrigen = ticket.Service.prefix.toLowerCase();

      // 🎯 payload para socket
      const socketPayload = {
        idTicketRegistration: ticket.idTicketRegistration,
        turnNumber: ticket.turnNumber,
        correlativo: ticket.correlativo,
        prefix: prefixDestino,
        usuario: ticket.Client?.name || "Sin cliente",
        modulo: cashierDestino.Service.name,
        createdAt: ticket.createdAt,
        idTicketStatus: STATUS.PENDIENTE,
        idCashier: null,
        idService: serviceDestinoId,
        status: ticket.status,
        forcedToCashierId: null,
        transferredAt: ticket.transferredAt,
      };

      // 🚫 NO usar "new-ticket" (eso lo pone como prioridad)
      // ✅ Emitimos "ticket-transferred" con flag queued
      io.to(roomDestino).emit("ticket-transferred", {
        ticket: socketPayload,
        fromCashierId,
        toCashierId,
        queued: true, // 👉 indica que debe ir al final de la cola
      });

      io.to("tv").emit("ticket-transferred", {
        ticket: socketPayload,
        queued: true,
      });

      // 🔁 Redistribuye y actualiza las colas destino y origen
      if (socketModule.redistributeTickets) {
        await socketModule.redistributeTickets(prefixDestino);
        await socketModule.redistributeTickets(roomOrigen);
        io.to(roomDestino).emit("queue-updated", { prefix: prefixDestino });
        io.to(roomOrigen).emit("queue-updated", { prefix: roomOrigen });
        io.to("tv").emit("queue-updated");
        console.log(`[transfer] 🔁 Redistribución forzada entre ${roomOrigen} → ${roomDestino}`);
      }

      // 🔔 Notifica al cajero origen (para liberar su vista)
      if (fromCashierId) {
        io.to(`cashier:${fromCashierId}`).emit("ticket-transferred", {
          ticket: socketPayload,
          fromCashierId,
          toCashierId,
          queued: false,
        });
      }
    }

    return res.json({
      ok: true,
      message:
        "Ticket transferido al final de la cola sin cambiar correlativo.",
      ticket,
    });
  } catch (e) {
    if (transaction) await transaction.rollback();
    return res.status(500).json({
      ok: false,
      message: e.message,
      details: e.errors?.map((er) => er.message) || null,
    });
  }
};
