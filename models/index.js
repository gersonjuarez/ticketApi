"use strict";
const fs = require("fs");
const path = require("path");
const { Sequelize, DataTypes } = require("sequelize");

const env = process.env.NODE_ENV || "development";
const configPath = path.join(__dirname, "..", "config", "config.js");
const allConfigs = require(configPath);
const baseConfig = allConfigs[env] || {};

const db = {};
const basename = path.basename(__filename);

const makeOptions = (cfg) => {
  const opts = {
    ...cfg,
    logging: cfg.logging ?? false,
    pool: cfg.pool ?? { max: 15, min: 0, acquire: 30000, idle: 10000 },
  };

  // ✅ Escribir SIEMPRE en UTC desde Sequelize (aplica en MySQL)
  opts.timezone = "+00:00";

  // ✅ Forzar UTC en el driver + leer DATETIME/TIMESTAMP como string (o cámbialo a Date si prefieres)
  opts.dialectOptions = {
    ...(cfg.dialectOptions || {}),
    timezone: "Z", // UTC
    dateStrings: true,
    typeCast: function (field, next) {
      // Lee DATETIME/TIMESTAMP como string plano "YYYY-MM-DD HH:mm:ss"
      if (field.type === "DATETIME" || field.type === "TIMESTAMP") return field.string();
      return next();
    },
  };

  // SSL opcional por env (Aiven / PlanetScale / etc.)
  if (process.env.MYSQL_SSL_CA) {
    opts.dialectOptions.ssl = opts.dialectOptions.ssl || {};
    opts.dialectOptions.ssl.ca = opts.dialectOptions.ssl.ca || process.env.MYSQL_SSL_CA;
    if (typeof opts.dialectOptions.ssl.rejectUnauthorized === "undefined") {
      opts.dialectOptions.ssl.rejectUnauthorized = true;
    }
  }

  return opts;
};

let sequelize;
if (process.env.DATABASE_URL) {
  sequelize = new Sequelize(process.env.DATABASE_URL, makeOptions(baseConfig));
} else if (baseConfig.url) {
  sequelize = new Sequelize(baseConfig.url, makeOptions(baseConfig));
} else {
  const {
    database, username, password, host, port, dialect = "mysql",
  } = baseConfig;
  sequelize = new Sequelize(database, username, password, makeOptions({
    host, port, dialect,
  }));
}

/**
 * ✅ Al iniciar, fijar time_zone de la SESIÓN MySQL en UTC.
 * Esto asegura que funciones como NOW()/CURDATE() se evalúen en UTC.
 * (Se ejecuta una sola vez; si falla, solo avisa por consola).
 */
(async () => {
  try {
    await sequelize.authenticate();
    await sequelize.query("SET time_zone = '+00:00'");
    console.log("[db] session time_zone set to +00:00 (UTC)");
  } catch (e) {
    console.warn("[db] could not SET time_zone:", e?.message || e);
  }
})();

// Auto-carga recursiva de modelos (mantiene tu estructura)
const files = [];
const walk = (dir) => {
  const entries = fs.readdirSync(dir);
  for (const e of entries) {
    if (e.startsWith(".")) continue;
    if (e === basename) continue;
    const full = path.join(dir, e);
    const stat = fs.statSync(full);
    if (stat.isFile() && e.endsWith(".js")) files.push(full);
    else if (stat.isDirectory()) walk(full);
  }
};
walk(__dirname);

files.forEach((file) => {
  const model = require(file)(sequelize, DataTypes);
  db[model.name] = model;
});

// Asociaciones
Object.keys(db).forEach((name) => {
  if (db[name].associate) db[name].associate(db);
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
