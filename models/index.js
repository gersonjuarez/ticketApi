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

  // ✅ GUARDAR en hora local Guatemala (-06:00)
  // (Sequelize convertirá los Date JS a -06:00 al escribir en DATETIME/TIMESTAMP)
  opts.timezone = "-06:00";

  // ✅ Leer DATETIME/TIMESTAMP como string "YYYY-MM-DD HH:mm:ss" (sin cast a otra zona)
  opts.dialectOptions = {
    ...(cfg.dialectOptions || {}),
    dateStrings: true,
    typeCast: function (field, next) {
      if (field.type === "DATETIME" || field.type === "TIMESTAMP") return field.string();
      return next();
    },
  };

  // ✅ Asegurar la zona horaria por SESIÓN en CADA conexión del pool
  // (NOW(), CURDATE(), etc. devolverán hora local -06:00)
  const basePool = opts.pool || {};
  opts.pool = {
    ...basePool,
    afterCreate: (conn, done) => {
      // mysql2
      conn.query("SET time_zone = '-06:00';", (err) => done(err, conn));
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
 * (Opcional) Fijar time_zone de la PRIMERA conexión también a -06:00.
 * El ajuste real y robusto es el de pool.afterCreate (arriba).
 */
(async () => {
  try {
    await sequelize.authenticate();
    await sequelize.query("SET time_zone = '-06:00'");
    console.log("[db] session time_zone set to -06:00 (America/Guatemala)");
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
