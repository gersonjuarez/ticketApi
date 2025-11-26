// server/Servidor.js
const express = require("express");
const cors = require("cors");
const { createServer } = require("http");
const morgan = require("morgan");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const db = require("../models");

// Swagger
const swaggerUi = require("swagger-ui-express");
const { swaggerSpec } = require("../swagger");

// Rutas
const authRoutes = require("../routes/auth.routes.js");
const ticketRegistrationRoutes = require("../routes/ticketRegistration.routes");
const ticketStatusRoutes = require("../routes/ticketStatus.routes");
const clientRoutes = require("../routes/client.routes");
const serviceRoutes = require("../routes/service.routes");
const cashierRoutes = require("../routes/cashier.routes");
const dashbordRoutes = require("../routes/dashboard.routes.js");
const userRoutes = require("../routes/user.routes.js");
const rolesRoutes = require("../routes/roles.routes.js");
const modulesRoutes = require("../routes/modules.routes.js");
const authRoutesPer = require("../routes/auth.js");
const historyRoutes = require("../routes/ticketHistory.routes.js");
const ttsRoutes = require("../routes/tts");
const reportsRoutes = require("../routes/reports.routes.js");
const tvMediaRoutes = require("../routes/tv_media.routes");
const tvSettingRoutes = require("../routes/tv_setting.routes");
const autoCancelRoutes = require("../routes/autoCancelTickets.routes");
// Socket.IO
const { init, getIo } = require("./socket");

// Middlewares de error
const { notFound, errorHandler } = require("../middlewares/errorHandler");
const authRequired = require("../middlewares/authRequired");

// Branding (si aplica)
const { loadBranding } = require("./branding.js");

// Logger
const { logger, withMeta } = require("../logger");

const corsConfig = {
  origin: "*", // En prod: ['https://tu-admin.netlify.app', 'https://tu-app-web.netlify.app']
  credentials: false,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

class Servidor {
  constructor() {
    loadBranding();
    this.app = express();
    this.port = process.env.PORT || 3001;
    this.paths = { route: "/api" };
    this.server = createServer(this.app);

    this.shuttingDown = false;

    this.middlewares();
    this.routes();
    this.registerProcessHandlers();
  }

  middlewares() {
    // ==== Request ID + request-scoped logger ====
    this.app.use((req, _res, next) => {
      req.id = req.headers["x-request-id"] || uuidv4();
      req.log = withMeta(logger, { requestId: req.id });
      next();
    });
    // === Archivos estáticos subidos ===
    const uploadDir = path.join(__dirname, "..", "uploads");
    this.app.use(
      "/uploads",
      express.static(uploadDir, {
        setHeaders(res) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        },
      })
    );
    // ==== CORS & parsers ====
    this.app.use(cors(corsConfig));
    this.app.use(express.json({ limit: "200mb" }));
    this.app.use(express.urlencoded({ limit: "200mb", extended: false }));

    // ==== Access logs (morgan -> Winston) ====
    morgan.token("id", (req) => req.id);
    const accessStream = {
      write: (message) => logger.info(message.trim()),
    };
    this.app.use(
      morgan(
        ":id :remote-addr :method :url :status :res[content-length] - :response-time ms",
        { stream: accessStream }
      )
    );
  }

  routes() {
    // ===== Rutas de salud / ping (antes de todo) =====
    this.app.head("/", (_req, res) => res.status(200).end());
    this.app.get("/", (_req, res) => res.send("API OK"));
    this.app.get("/healthz", (_req, res) => res.status(200).send("ok"));
    this.app.get("/api/dbcheck", async (req, res) => {
      try {
        await db.sequelize.authenticate();
        const [[r]] = await db.sequelize.query("SELECT 1 AS ok;");
        req.log.info("DB check OK");
        res.json({ ok: true, ping: r.ok });
      } catch (e) {
        req.log.error("DB check FAIL", { error: e.message });
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    // ===== Swagger UI / Spec =====
    // if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_DOCS === 'true') { ... }
    this.app.get("/docs.json", (_req, res) => res.json(swaggerSpec));
    this.app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

    // ===== Rutas públicas =====
    this.app.use(this.paths.route, authRoutes);

    // ===== Protegidas global (opcional) =====
    // this.app.use(this.paths.route, authRequired);

    // ===== Módulos =====
    this.app.use(this.paths.route, ticketRegistrationRoutes);
    this.app.use(this.paths.route, ticketStatusRoutes);
    this.app.use(this.paths.route, clientRoutes);
    this.app.use(this.paths.route, serviceRoutes);
    this.app.use(this.paths.route, cashierRoutes);
    this.app.use(this.paths.route, dashbordRoutes);
    this.app.use(this.paths.route, userRoutes);
    this.app.use(this.paths.route, rolesRoutes);
    this.app.use(this.paths.route, modulesRoutes);
    this.app.use(this.paths.route, authRoutesPer);
    this.app.use("/api/tts", ttsRoutes);
    this.app.use(this.paths.route, historyRoutes);
    this.app.use(this.paths.route, reportsRoutes);
    this.app.use(this.paths.route, tvMediaRoutes);
    this.app.use(this.paths.route, tvSettingRoutes);
    this.app.use(this.paths.route, autoCancelRoutes);

    // ===== Middlewares de 404 y errores =====
    this.app.use(notFound);
    this.app.use(errorHandler);
  }

  listen() {
    const httpServer = this.server.listen(this.port, () => {
      logger.info("Servidor corriendo", {
        port: this.port,
        docs: `http://localhost:${this.port}/docs`,
        spec: `http://localhost:${this.port}/docs.json`,
      });
    });

    // Inicializar Socket.IO sobre el server HTTP
    init(httpServer);
    logger.info("Socket.IO inicializado");

    // Inicializar cron job de auto-cancelación
    const { initAutoCancelCron } = require("../services/autoCancelTickets.service");
    initAutoCancelCron();

    // Verificar conexión DB al arranque
    db.sequelize
      .authenticate()
      .then(() => logger.info("DB OK"))
      .catch((err) =>
        logger.error("Fallo conexión DB", { error: err?.message })
      );
  }

  gracefulShutdown = (signal, code = 0) => {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    logger.warn("Apagando con gracia...", { signal, code });

    this.server.close(async () => {
      // Cerrar Socket.IO
      try {
        const io = getIo();
        await new Promise((res) => io.close(() => res()));
        logger.info("Socket.IO cerrado");
      } catch (e) {
        logger.error("Error cerrando Socket.IO", { error: e?.message });
      }

      // Cerrar DB
      try {
        await db.sequelize.close();
        logger.info("DB cerrada");
      } catch (e) {
        logger.error("Error cerrando DB", { error: e?.message });
      }

      logger.info("Apagado completo");
      process.exit(code);
    });

    // Fallback por si algo queda colgado
    setTimeout(() => {
      logger.error("Forzando salida por timeout...");
      process.exit(code);
    }, 10_000).unref();
  };

  registerProcessHandlers() {
    process.on("SIGTERM", () => this.gracefulShutdown("SIGTERM", 0));
    process.on("SIGINT", () => this.gracefulShutdown("SIGINT", 0));

    process.on("unhandledRejection", (reason) => {
      if (reason && reason.isOperational) {
        logger.warn("unhandledRejection (operational)", { reason });
      } else {
        logger.error("unhandledRejection", { reason });
        this.gracefulShutdown("unhandledRejection", 1);
      }
    });

    process.on("uncaughtException", (err) => {
      logger.error("uncaughtException", {
        error: err?.message,
        stack: err?.stack,
      });
      this.gracefulShutdown("uncaughtException", 1);
    });
  }
}

module.exports = Servidor;
