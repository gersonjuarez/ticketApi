
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
          WHEN "forcedToCashierId" = ${cid} THEN 0
          WHEN "forcedToCashierId" IS NULL THEN 1
          ELSE 2
        END
      `),
      "ASC",
    ],
    ["idTicketStatus", "ASC"], // PENDIENTE(1) antes que EN_ATENCION(2) si se mezclan
    ["turnNumber", "ASC"], // ⬅️ FIFO por número de turno
    ["createdAt", "ASC"],
    ["updatedAt", "ASC"], // ⬅️ solo de desempate, al final
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

/* ============================
   TRANSFERIR TICKET
============================ */
exports.transfer = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const ticketId = parseInt(req.params.id, 10);
    const {
      toCashierId,
      performedByUserId,
      comment,
      autoAssignIfFree = false,
      fromCashierId: fromCashierIdRaw,
      keepOriginalNumber = false,
    } = req.body;

    if (!Number.isInteger(ticketId)) {
      await t.rollback();
      return res.status(400).json({ error: "ID de ticket inválido" });
    }
    if (!toCashierId || !performedByUserId) {
      await t.rollback();
      return res
        .status(400)
        .json({ error: "toCashierId y performedByUserId son requeridos" });
    }

    const ticket = await TicketRegistration.findByPk(ticketId, {
      include: [{ model: Service }, { model: Cashier }],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!ticket || ticket.status === false) {
      await t.rollback();
      return res.status(404).json({ error: "Ticket no encontrado" });
    }
    if ([STATUS.COMPLETADO, STATUS.CANCELADO].includes(ticket.idTicketStatus)) {
      await t.rollback();
      return res
        .status(400)
        .json({
          error: "No se puede trasladar un ticket cancelado o completado",
        });
    }
    if (ticket.idTicketStatus !== STATUS.EN_ATENCION) {
      await t.rollback();
      return res
        .status(400)
        .json({
          error: "ONLY_IN_ATTENTION",
          message: "Solo se puede trasladar un ticket que está en atención.",
        });
    }

    const fromCashierId = fromCashierIdRaw ?? ticket.idCashier ?? null;
    if (!fromCashierId || Number(ticket.idCashier) !== Number(fromCashierId)) {
      await t.rollback();
      return res
        .status(403)
        .json({
          error: "NOT_ATTENDING_CASHIER",
          message:
            "Solo la ventanilla que está atendiendo puede trasladar el ticket.",
        });
    }

    const fromCashier = await Cashier.findByPk(fromCashierId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!fromCashier) {
      await t.rollback();
      return res
        .status(404)
        .json({ error: "Ventanilla de origen no encontrada" });
    }
    if (fromCashier.allowTransfersOut === false) {
      await t.rollback();
      return res
        .status(403)
        .json({
          error: "La ventanilla de origen no permite trasladar tickets",
        });
    }
    if (fromCashier.isPaused || fromCashier.isOutOfService) {
      await t.rollback();
      return res
        .status(400)
        .json({
          error: "La ventanilla de origen está pausada o fuera de servicio",
        });
    }

    const toCashier = await Cashier.findByPk(toCashierId, {
      include: [
        { model: Service, attributes: ["idService", "prefix", "name"] },
      ],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!toCashier) {
      await t.rollback();
      return res
        .status(404)
        .json({ error: "Ventanilla de destino no encontrada" });
    }
    if (!toCashier.status || toCashier.isOutOfService) {
      await t.rollback();
      return res
        .status(400)
        .json({
          error: "La ventanilla de destino está inactiva o fuera de servicio",
        });
    }
    if (toCashier.allowTransfersIn === false) {
      await t.rollback();
      return res
        .status(403)
        .json({ error: "La ventanilla de destino no acepta traslados" });
    }

    // 🔒 Respeto de reserva
    if (
      ticket.forcedToCashierId &&
      Number(ticket.forcedToCashierId) !== Number(fromCashierId || 0)
    ) {
      await t.rollback();
      return res
        .status(403)
        .json({
          error: "El ticket está reservado para otra ventanilla",
          forcedToCashierId: ticket.forcedToCashierId,
        });
    }

    // 🧠 Ocupación destino
    const isDestBusy = !!(await TicketRegistration.findOne({
      where: {
        idCashier: toCashier.idCashier,
        idTicketStatus: STATUS.EN_ATENCION,
        status: true,
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    }));
    const autoAssign =
      typeof autoAssignIfFree === "string"
        ? autoAssignIfFree.toLowerCase() === "true"
        : !!autoAssignIfFree;

    const prevStatus = ticket.idTicketStatus;

    /* =======================================================
       PASO 1: Estado intermedio TRASLADO (5) + cerrar span origen
       (no aparece en TV porque TV sólo muestra 1 y 2)
    ======================================================= */
    await ticket.update(
      {
        idTicketStatus: STATUS.TRASLADO,
        // sigue momentáneamente asignado al cajero origen para trazabilidad
        idCashier: fromCashierId,
        forcedToCashierId: toCashier.idCashier, // reserva para destino
      },
      { transaction: t }
    );

    await TicketHistory.create(
      {
        idTicket: ticket.idTicketRegistration,
        fromStatus: prevStatus,
        toStatus: STATUS.TRASLADO,
        changedByUser: performedByUserId,
      },
      { transaction: t }
    );

    const nowClose = new Date();
    await Attendance.closeOpenSpan(
      { idTicket: ticket.idTicketRegistration, at: nowClose },
      t
    );

    // Anuncio sockets: transfiriendo (opcional)
    try {
      const ioTransf = require("../server/socket").getIo?.();
      if (ioTransf) {
        ioTransf.to(`cashier:${fromCashierId}`).emit("ticket-transferring", {
          idTicketRegistration: ticket.idTicketRegistration,
          correlativo: ticket.correlativo,
          fromCashierId,
          toCashierId: toCashier.idCashier,
          timestamp: Date.now(),
        });
        ioTransf
          .to(`cashier:${toCashier.idCashier}`)
          .emit("ticket-transferring", {
            idTicketRegistration: ticket.idTicketRegistration,
            correlativo: ticket.correlativo,
            fromCashierId,
            toCashierId: toCashier.idCashier,
            timestamp: Date.now(),
          });
      }
    } catch {}

    /* =======================================================
       PASO 2: Estado final en destino (cola=1 o en atención=2)
    ======================================================= */
    let newStatus = STATUS.PENDIENTE;
    let assignedNow = false;
    if (!isDestBusy && autoAssign) {
      newStatus = STATUS.EN_ATENCION;
      assignedNow = true;
    } else {
      newStatus = STATUS.PENDIENTE;
    }

    // ======== Rama: mantener número/servicio de origen ========
    if (keepOriginalNumber) {
      const updateData = {
      idTicketStatus: STATUS.PENDIENTE,         // 🔹 se va a la cola
  idCashier: null,                          // 🔹 no asignado todavía
  forcedToCashierId: toCashier.idCashier,   // 🔹 reservado solo para ese cajero
  dispatchedByUser: null,                   // 🔹 no despachado aún
        // NO tocamos idService/turnNumber/correlativo
      };

      await ticket.update(updateData, { transaction: t });

      await TicketTransferLog.create(
        {
          idTicketRegistration: ticket.idTicketRegistration,
          fromCashierId: fromCashierId || null,
          toCashierId: toCashier.idCashier,
          performedByUserId,
          comment: comment?.trim() || null,
        },
        { transaction: t }
      );

      await TicketHistory.create(
        {
          idTicket: ticket.idTicketRegistration,
          fromStatus: STATUS.TRASLADO,
          toStatus: newStatus,
          changedByUser: performedByUserId,
        },
        { transaction: t }
      );

      // Si quedó asignado en destino, abrimos span allí (mismo servicio de origen)
      if (assignedNow && newStatus === STATUS.EN_ATENCION) {
        await Attendance.rotateSpan(
          {
            idTicket: ticket.idTicketRegistration,
            idCashier: toCashier.idCashier,
            idService: ticket.idService,
            at: new Date(),
          },
          t
        );
      }

      await t.commit();

      // -------- Sockets --------
   const io3 = require("../server/socket").getIo?.();
if (io3) {
  const originPrefix = (ticket.Service?.prefix || "").toUpperCase();
  const originRoom = originPrefix.toLowerCase();
// ⚠️ Servicio de destino (visual para TV)
const destPrefix = (toCashier.Service?.prefix || "").toUpperCase();
const destModulo  = toCashier.Service?.name || "—";
  let usuarioName = "Sin cliente";
  try {
    const cli = await Client.findByPk(ticket.idClient);
    if (cli && cli.name) usuarioName = cli.name;
  } catch {}

const payload = {
  idTicketRegistration: ticket.idTicketRegistration,
  turnNumber: ticket.turnNumber,         // ✅ mantiene numeración de origen
  correlativo: ticket.correlativo,       // ✅ mantiene correlativo de origen
  // 👇 Mostrar SIEMPRE destino en la UI (TV/cajeros), aunque idService siga siendo el de origen
  prefix: destPrefix,                    // ✅ ahora muestra servicio de destino
  modulo: destModulo,                    // ✅ nombre del servicio destino
  idService: ticket.idService,           // ✅ NO tocar (trazabilidad)
  idTicketStatus: newStatus,
  idCashier: assignedNow ? toCashier.idCashier : null,
  forcedToCashierId: toCashier.idCashier,
  updatedAt: ticket.updatedAt,
  usuario: usuarioName,
};

  const transferred = {
    ticket: payload,
    fromCashierId: fromCashierId || null,
    toCashierId: toCashier.idCashier,
    queued: !assignedNow,
    timestamp: Date.now(),
  };

  // Cajeros
  io3.to(`cashier:${fromCashierId}`).emit("ticket-transferred", transferred);
  io3.to(`cashier:${toCashier.idCashier}`).emit("ticket-transferred", transferred);
  // ✅ TV también
  io3.to("tv").emit("ticket-transferred", transferred);

  if (assignedNow) {
    const assignedPayload = {
      ticket: payload,
      assignedToCashier: toCashier.idCashier,
      previousStatus: STATUS.TRASLADO,
      timestamp: Date.now(),
      attentionStartedAt: null,
    };
    io3.to(`cashier:${toCashier.idCashier}`).emit("ticket-assigned", assignedPayload);
    io3.to("tv").emit("ticket-assigned", assignedPayload); // ✅
  } else {
    // Mantener visible en origen como pendiente, si así lo quieres
    const queuedPayload = {
      ...payload,
      idTicketStatus: STATUS.PENDIENTE,
      idCashier: null,
    };
    io3.to(originRoom).emit("new-ticket", queuedPayload);
    io3.to(`cashier:${toCashier.idCashier}`).emit("update-current-display", {
      ticket: queuedPayload,
      isAssigned: false,
      timestamp: Date.now(),
    });
    // (opcional) También podrías informar a la TV que reapareció en cola en su servicio de origen:
    io3.to("tv").emit("new-ticket", queuedPayload); // ✅ opcional, útil si tu TV escucha este evento
  }

  io3.emit("ticket-updated", payload);
}

      // Liberar y tomar siguiente en origen
      try {
        const socketModule = require("../server/socket");
        if (fromCashierId) {
          const originPrefixLower = (
            ticket.Service?.prefix || ""
          ).toLowerCase(); // ⬅️ minúsculas
          await socketModule.pickNextForCashier?.(
            originPrefixLower,
            fromCashierId
          );
        }
      } catch (e) {
        console.error(
          "[transfer keepOriginalNumber] pickNextForCashier error:",
          e?.message || e
        );
      }

      return res.json({
        ok: true,
        ticketId: ticket.idTicketRegistration,
        fromCashierId: fromCashierId || null,
        toCashierId: toCashier.idCashier,
        assignedNow,
        queued: !assignedNow,
        correlativo: ticket.correlativo,
        turnNumber: ticket.turnNumber,
        attentionStartedAt: null,
        keptOriginalNumber: true,
      });
    }

    // ======== Rama: renumerar si cambia de servicio ========
    const destServiceId = Number(toCashier.idService);
    const originPrefix = (ticket.Service?.prefix || "").toUpperCase();
    const destPrefix = (toCashier.Service?.prefix || "").toUpperCase();

    const needsRenumber = Number(ticket.idService) !== destServiceId;
    let nextTurn = ticket.turnNumber;
    let nextCorrelativo = ticket.correlativo;

    if (needsRenumber) {
      const maxAttempts = 3;
      let okNum = false;
      let lastErr = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const n = await getNextTurnNumber(destServiceId, t);
          nextTurn = n;
          nextCorrelativo = `${destPrefix}-${padN(nextTurn, 3)}`;
          okNum = true;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt >= maxAttempts || !isUniqueError(err)) throw err;
        }
      }
      if (!okNum && lastErr) throw lastErr;
    }

    const updateData = {
      idTicketStatus: STATUS.PENDIENTE,
      idCashier: null,  
      forcedToCashierId: toCashier.idCashier,
      idService: destServiceId,
      dispatchedByUser: null,  
      ...(needsRenumber
        ? { turnNumber: nextTurn, correlativo: nextCorrelativo }
        : {}),
    };

    const tryUpdate = async () => {
      await ticket.update(updateData, { transaction: t });
    };

    if (needsRenumber) {
      let ok = false;
      let lastErr = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await tryUpdate();
          ok = true;
          break;
        } catch (err) {
          lastErr = err;
          if (isUniqueError(err) && attempt < 3) {
            // Pequeño backoff para dejar que se consoliden commits de otros writers
            await new Promise((r) =>
              setTimeout(r, 25 + Math.floor(Math.random() * 35))
            );
            const n = await getNextTurnNumber(destServiceId, t);
            nextTurn = n;
            nextCorrelativo = `${destPrefix}-${padN(nextTurn, 3)}`;
            updateData.turnNumber = nextTurn;
            updateData.correlativo = nextCorrelativo;
            continue;
          }
          throw err;
        }
      }
      if (!ok) throw lastErr;
    } else {
      await tryUpdate();
    }

    await TicketTransferLog.create(
      {
        idTicketRegistration: ticket.idTicketRegistration,
        fromCashierId: fromCashierId || null,
        toCashierId: toCashier.idCashier,
        performedByUserId,
        comment: comment?.trim() || null,
      },
      { transaction: t }
    );

    await TicketHistory.create(
      {
        idTicket: ticket.idTicketRegistration,
        fromStatus: STATUS.TRASLADO,
        toStatus: newStatus,
        changedByUser: performedByUserId,
      },
      { transaction: t }
    );

    const now = new Date();
    if (assignedNow && newStatus === STATUS.EN_ATENCION) {
      await Attendance.rotateSpan(
        {
          idTicket: ticket.idTicketRegistration,
          idCashier: toCashier.idCashier,
          idService: destServiceId,
          at: now,
        },
        t
      );
    }

    await t.commit();

    let attentionStartedAt = null;
    if (assignedNow && newStatus === STATUS.EN_ATENCION) {
      const openSpan = await TicketAttendance.findOne({
        where: { idTicket: ticket.idTicketRegistration, endedAt: null },
        order: [["startedAt", "DESC"]],
      });
      attentionStartedAt = openSpan ? openSpan.startedAt : null;
    }

const io3 = require("../server/socket").getIo?.();
if (io3) {
  const destRoom = destPrefix.toLowerCase();

  let usuarioName = "Sin cliente";
  try {
    const cli = await Client.findByPk(ticket.idClient);
    if (cli && cli.name) usuarioName = cli.name;
  } catch {}

  const payload = {
    idTicketRegistration: ticket.idTicketRegistration,
    turnNumber: nextTurn,
    correlativo: nextCorrelativo,
    prefix: destPrefix,
    idService: destServiceId,
    idTicketStatus: newStatus,
    idCashier: assignedNow ? toCashier.idCashier : null,
    forcedToCashierId: toCashier.idCashier,
    updatedAt: ticket.updatedAt,
    usuario: usuarioName,
    modulo: toCashier.Service?.name || "—",
  };

  if (originPrefix) {
    io3.to(originPrefix.toLowerCase()).emit("ticket-removed", {
      idTicketRegistration: ticket.idTicketRegistration,
      correlativo: nextCorrelativo,
      fromService: originPrefix,
      timestamp: Date.now(),
    });
    // (opcional) infórmalo en TV también si la TV reacciona a 'ticket-removed'
    io3.to("tv").emit("ticket-removed", {
      idTicketRegistration: ticket.idTicketRegistration,
      correlativo: nextCorrelativo,
      fromService: originPrefix,
      timestamp: Date.now(),
    });
  }

  const transferred = {
    ticket: payload,
    fromCashierId: fromCashierId || null,
    toCashierId: toCashier.idCashier,
    queued: !assignedNow,
    timestamp: Date.now(),
  };

  // Cajeros
  io3.to(`cashier:${fromCashierId}`).emit("ticket-transferred", transferred);
  io3.to(`cashier:${toCashier.idCashier}`).emit("ticket-transferred", transferred);
  // ✅ TV también
  io3.to("tv").emit("ticket-transferred", transferred);

  if (assignedNow) {
    const assignedPayload = {
      ticket: payload,
      assignedToCashier: toCashier.idCashier,
      previousStatus: STATUS.TRASLADO,
      timestamp: Date.now(),
      attentionStartedAt,
    };
    io3.to(`cashier:${toCashier.idCashier}`).emit("ticket-assigned", assignedPayload);
    io3.to("tv").emit("ticket-assigned", assignedPayload); // ✅

    // Si no quieres que se vea en cola en el destino, lo quitas del room del destino
    io3.to(destRoom).emit("ticket-removed", {
      idTicketRegistration: ticket.idTicketRegistration,
      correlativo: nextCorrelativo,
      fromService: destPrefix,
      timestamp: Date.now(),
    });
    // (opcional) también en TV
    io3.to("tv").emit("ticket-removed", {
      idTicketRegistration: ticket.idTicketRegistration,
      correlativo: nextCorrelativo,
      fromService: destPrefix,
      timestamp: Date.now(),
    });
  } else {
    const queuedPayload = {
      ...payload,
      idTicketStatus: STATUS.PENDIENTE,
      idCashier: null,
    };
    io3.to(destRoom).emit("new-ticket", queuedPayload);
    io3.to(`cashier:${toCashier.idCashier}`).emit("new-ticket", queuedPayload);
    io3.to(`cashier:${toCashier.idCashier}`).emit("update-current-display", {
      ticket: queuedPayload,
      isAssigned: false,
      timestamp: Date.now(),
    });
    // ✅ TV también para que aparezca en “En cola” del servicio destino
    io3.to("tv").emit("new-ticket", queuedPayload);
  }

  io3.emit("ticket-updated", payload);
}
    try {
      const socketModule = require("../server/socket");
      if (
        currentTicket.idTicketStatus === STATUS.EN_ATENCION &&
        (newStatus === STATUS.CANCELADO || newStatus === STATUS.COMPLETADO)
      ) {
        const freedCashierId = newCashierId || currentTicket.idCashier || null;
        if (freedCashierId) {
          const roomPrefix = (
            updatedTicket.Service?.prefix || ""
          ).toLowerCase();
          await socketModule.pickNextForCashier?.(roomPrefix, freedCashierId);
        }
      }
    } catch (e) {
      console.error("[update] pickNextForCashier error:", e?.message || e);
    }

    return res.json({
      ok: true,
      ticketId: ticket.idTicketRegistration,
      fromCashierId: fromCashierId || null,
      toCashierId: toCashier.idCashier,
      assignedNow,
      queued: !assignedNow,
      correlativo: nextCorrelativo,
      turnNumber: nextTurn,
      attentionStartedAt: attentionStartedAt || null,
      keptOriginalNumber: false,
    });
  } catch (err) {
    console.error("[transfer] error:", err);
    try {
      if (t.finished !== "commit") await t.rollback();
    } catch {}
    return res.status(500).json({ error: "No se pudo trasladar el ticket" });
  }
};  