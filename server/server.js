// server/Servidor.js
const express = require("express");
const cors = require("cors");
const { createServer } = require("http");
const db = require("../models");
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
const { init, getIo } = require("./socket");
const { notFound, errorHandler } = require("../middlewares/errorHandler");
const authRequired = require("../middlewares/authRequired");
const { loadBranding } = require("./branding.js");
const ttsRoutes = require("../routes/tts");

const corsConfig = {
  origin: "*", // en prod: ['https://tu-admin.netlify.app', 'https://tu-app-web.netlify.app']
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

    this.middlewares();
    this.routes();

    this.shuttingDown = false;
    this.registerProcessHandlers();
  }

  middlewares() {
    this.app.use(cors(corsConfig));
    this.app.use(express.json({ limit: "200mb" }));
    this.app.use(express.urlencoded({ limit: "200mb", extended: false }));
  }

  routes() {
    // ✅ RUTAS DE SALUD (antes de todo)
    this.app.head("/", (_req, res) => res.status(200).end());
    this.app.get("/", (_req, res) => res.send("API OK"));
    this.app.get("/healthz", (_req, res) => res.status(200).send("ok"));
    this.app.get("/api/dbcheck", async (_req, res) => {
      try {
        await db.sequelize.authenticate();
        const [[r]] = await db.sequelize.query("SELECT 1 AS ok;");
        res.json({ ok: true, ping: r.ok });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    // Públicas
    this.app.use(this.paths.route, authRoutes);

    // Protegidas (si quieres aplicar auth global, descomenta la siguiente línea)
    // this.app.use(this.paths.route, authRequired);

    // Módulos
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

    this.app.use(notFound);
    this.app.use(errorHandler);
  }

  listen() {
    const httpServer = this.server.listen(this.port, () => {
      console.log("Servidor corriendo en puerto", this.port);
    });

    init(httpServer);

    db.sequelize
      .authenticate()
      .then(() => console.log("DB OK"))
      .catch((err) => console.error("Fallo conexión DB:", err?.message));
  }

  gracefulShutdown = (signal, code = 0) => {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    console.log(`[${signal}] Apagando con gracia...`);

    this.server.close(async () => {
      try {
        const io = getIo();
        await new Promise((res) => io.close(() => res()));
      } catch (e) {
        console.error("Error cerrando Socket.IO:", e);
      }
      try {
        await db.sequelize.close();
      } catch (e) {
        console.error("Error cerrando DB:", e);
      }
      console.log("Apagado completo.");
      process.exit(code);
    });

    setTimeout(() => {
      console.warn("Forzando salida por timeout...");
      process.exit(code);
    }, 10_000).unref();
  };

  registerProcessHandlers() {
    process.on("SIGTERM", () => this.gracefulShutdown("SIGTERM", 0));
    process.on("SIGINT", () => this.gracefulShutdown("SIGINT", 0));
    process.on("unhandledRejection", (reason) => {
      if (reason && reason.isOperational) {
        console.error("unhandledRejection (operational):", reason);
      } else {
        console.error("unhandledRejection:", reason);
        this.gracefulShutdown("unhandledRejection", 1);
      }
    });
    process.on("uncaughtException", (err) => {
      console.error("uncaughtException:", err);
      this.gracefulShutdown("uncaughtException", 1);
    });
  }
}

module.exports = Servidor;
