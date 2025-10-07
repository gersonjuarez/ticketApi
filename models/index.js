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

  // ⬇⬇ CLAVE: siempre trabajar en UTC desde Sequelize
  opts.timezone = '+00:00'; // escribe en UTC (válido para MySQL)

  // ⬇⬇ CLAVE: leer DATETIME como string (YYYY-MM-DD HH:mm:ss) sin cast local
  opts.dialectOptions = {
    ...(cfg.dialectOptions || {}),
    dateStrings: true,
    typeCast: function (field, next) {
      // MySQL DATETIME -> string plano
      if (field.type === 'DATETIME') return field.string();
      return next();
    },
  };

  // SSL opcional por env (Aiven / managed DB)
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

// Auto-carga recursiva de modelos
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
