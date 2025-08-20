// server/socket.js
const { Server } = require("socket.io");

let io;

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
    });

    io.on("connection", (socket) => {
      console.log("[socket] Cliente conectado:", socket.id);

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

      /**
       * Nuevo: Suscripción global para TVs (no depende de prefix)
       */
      socket.on("subscribe-tv", () => {
        socket.join("tv");
        console.log(`[socket] ${socket.id} suscrito al room global 'tv'`);
      });

      /**
       * Evento de llamada de ticket.
       * Si se envía un prefix, emite a ese room y también a 'tv'.
       * Si no, emite a todos.
       */
      socket.on("call-ticket", (payload = {}) => {
        try {
          const { prefix } = payload || {};
          if (typeof prefix === "string" && prefix.trim()) {
            const room = prefix.toLowerCase();
            io.to(room).emit("call-ticket", payload);
            console.log(`[socket] call-ticket → room '${room}':`, payload);
          }
          // siempre emitir a TVs
          io.to("tv").emit("call-ticket", payload);
          console.log("[socket] call-ticket → room 'tv':", payload);
        } catch (e) {
          console.error("[socket] call-ticket handler error:", e?.message || e);
        }
      });

      /**
       * (Opcional) ping-pong sencillo para debug/monitor
       */
      socket.on("ping-check", () => {
        socket.emit("pong-check", { at: Date.now() });
      });

      socket.on("disconnect", (reason) => {
        console.log(
          `[socket] Cliente desconectado: ${socket.id}. Motivo: ${reason}`
        );
        // Si deseas limpiar mapas externos por socket.id, hazlo aquí.
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
};
