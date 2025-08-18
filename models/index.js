"use strict";
const fs = require("fs");
const path = require("path");
const { Sequelize, DataTypes } = require("sequelize");

// Usa NODE_ENV para elegir bloque del config (development/test1/production)
const env = process.env.NODE_ENV || "development";

// Carga config.js en vez de config.json
const configPath = path.join(__dirname, "..", "config", "config.js");
const allConfigs = require(configPath);
const baseConfig = allConfigs[env] || {};

const db = {};

// Construye opciones finales de Sequelize
const makeOptions = (cfg) => {
  const opts = {
    ...cfg,
    logging: cfg.logging ?? false,
    pool: cfg.pool ?? { max: 15, min: 0, acquire: 30000, idle: 10000 },
  };

  // Si viene CA por env y no está en config, añádelo (Aiven/SSL)
  if (process.env.MYSQL_SSL_CA) {
    opts.dialectOptions = opts.dialectOptions || {};
    opts.dialectOptions.ssl = opts.dialectOptions.ssl || {};
    opts.dialectOptions.ssl.ca = opts.dialectOptions.ssl.ca || process.env.MYSQL_SSL_CA;
    // Recomendado en managed DB con certificados
    if (typeof opts.dialectOptions.ssl.rejectUnauthorized === "undefined") {
      opts.dialectOptions.ssl.rejectUnauthorized = true;
    }
  }

  return opts;
};

let sequelize;

// Prioridad 1: DATABASE_URL (producción en Aiven)
if (process.env.DATABASE_URL) {
  sequelize = new Sequelize(process.env.DATABASE_URL, makeOptions(baseConfig));
}
// Prioridad 2: config.url (si lo definiste en config.js)
else if (baseConfig.url) {
  sequelize = new Sequelize(baseConfig.url, makeOptions(baseConfig));
}
// Prioridad 3: username/password/host/port/database
else {
  const {
    database,
    username,
    password,
    host,
    port,
    dialect = "mysql",
  } = baseConfig;

  sequelize = new Sequelize(database, username, password, makeOptions({
    host,
    port,
    dialect,
  }));
}

// Auto-carga recursiva de modelos
const basename = path.basename(__filename);
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

Object.keys(db).forEach((name) => {
  if (db[name].associate) db[name].associate(db);
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
