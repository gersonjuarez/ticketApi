const cron = require("node-cron");
const { TicketRegistration, Service } = require("../models");
const { logger } = require("../logger");
const { formatInTimeZone } = require("date-fns-tz");

const GUATEMALA_TZ = "America/Guatemala";
const STATUS = {
  PENDIENTE: 1,
  EN_ATENCION: 2,
  CANCELADO: 4,
};

/**
 * Cancela todos los tickets pendientes (status 1) que no han sido atendidos.
 * Se ejecuta automáticamente a las 7:00 PM hora de Guatemala.
 */
async function cancelPendingTickets() {
  try {
    const now = new Date();
    const timeStr = formatInTimeZone(now, GUATEMALA_TZ, "yyyy-MM-dd HH:mm:ss");

    logger.info(`🕐 [AUTO-CANCEL] Iniciando cancelación automática a las ${timeStr}`);

    // Obtener todos los tickets pendientes
    const pendingTickets = await TicketRegistration.findAll({
      where: {
        idTicketStatus: STATUS.PENDIENTE,
        status: true,
      },
      include: [{ model: Service, attributes: ["prefix", "name"] }],
    });

    if (pendingTickets.length === 0) {
      logger.info("✅ [AUTO-CANCEL] No hay tickets pendientes para cancelar");
      return { cancelled: 0, tickets: [] };
    }

    // Actualizar todos a estado CANCELADO
    const ticketIds = pendingTickets.map((t) => t.idTicketRegistration);
    
    const [updatedCount] = await TicketRegistration.update(
      {
        idTicketStatus: STATUS.CANCELADO,
        observations: "Cancelado automáticamente al cierre del día",
        updatedAt: now,
      },
      {
        where: {
          idTicketRegistration: ticketIds,
        },
      }
    );

    logger.info(`✅ [AUTO-CANCEL] ${updatedCount} tickets cancelados automáticamente`, {
      count: updatedCount,
      tickets: pendingTickets.map((t) => ({
        id: t.idTicketRegistration,
        correlativo: t.correlativo,
        service: t.Service?.prefix || "N/A",
      })),
    });

    // Emitir eventos de Socket.IO para notificar a todos los clientes
    const socketModule = require("../server/socket");
    const io = socketModule.getIo?.();

    if (io) {
      // Emitir evento para cada ticket cancelado
      for (const ticket of pendingTickets) {
        const room = ticket.Service?.prefix?.toLowerCase() || "";
        const cancelledPayload = {
          idTicketRegistration: ticket.idTicketRegistration,
        };

        // Notificar a la room del servicio
        if (room) {
          io.to(room).emit("ticket-cancelled", cancelledPayload);
        }

        // Notificar a TVs
        io.to("tv").emit("ticket-cancelled", cancelledPayload);
      }

      // Emitir evento general de cancelación masiva
      io.emit("tickets-auto-cancelled", {
        count: updatedCount,
        timestamp: now,
        reason: "auto-cancel-end-of-day",
      });

      logger.info("📡 [AUTO-CANCEL] Eventos Socket.IO emitidos");
    }

    return {
      cancelled: updatedCount,
      tickets: pendingTickets.map((t) => ({
        id: t.idTicketRegistration,
        correlativo: t.correlativo,
        service: t.Service?.name || "N/A",
      })),
    };
  } catch (error) {
    logger.error("❌ [AUTO-CANCEL] Error al cancelar tickets pendientes", {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Inicializa el cron job que se ejecuta a las 7:00 PM hora de Guatemala.
 * 
 * Expresión cron: "0 19 * * *"
 * - 0: minuto 0
 * - 19: hora 19 (7 PM)
 * - *: todos los días del mes
 * - *: todos los meses
 * - *: todos los días de la semana
 * 
 * NOTA: node-cron usa la zona horaria del servidor. Si el servidor está en UTC,
 * necesitarás ajustar la hora. En Render/Heroku (UTC), 7 PM Guatemala = 1 AM UTC del día siguiente.
 */
function initAutoCancelCron() {
  // 🌎 Guatemala está en UTC-6
  // Si tu servidor está en UTC, 7 PM Guatemala = 1 AM UTC del día siguiente
  // Ajusta según tu infraestructura:
  
  // OPCIÓN A: Si tu servidor está configurado con timezone de Guatemala
  const guatemalaSchedule = "0 19 * * *"; // 7:00 PM Guatemala
  
  // OPCIÓN B: Si tu servidor está en UTC (Render, Heroku, etc.)
  // const utcSchedule = "0 1 * * *"; // 1:00 AM UTC = 7:00 PM Guatemala (día anterior)

  const schedule = guatemalaSchedule; // Cambia esto según tu infraestructura

  const task = cron.schedule(
    schedule,
    async () => {
      logger.info("⏰ [AUTO-CANCEL] Cron job ejecutándose...");
      try {
        await cancelPendingTickets();
      } catch (error) {
        logger.error("❌ [AUTO-CANCEL] Falló la ejecución del cron", {
          error: error.message,
        });
      }
    },
    {
      scheduled: true,
      timezone: GUATEMALA_TZ, // 🔥 Esto asegura que cron use la zona horaria de Guatemala
    }
  );

  logger.info(`✅ [AUTO-CANCEL] Cron job inicializado: ${schedule} (${GUATEMALA_TZ})`);
  
  return task;
}

module.exports = {
  cancelPendingTickets,
  initAutoCancelCron,
};
