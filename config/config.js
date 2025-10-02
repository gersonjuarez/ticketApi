require('dotenv').config();

module.exports = {
  development: {
    username: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || '765446538',
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || '3306',
    dialect: 'mysql',
    pool: {
      max: 15,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    logging: false,
  },

  test1: {
    username: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'tickets',
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || '3306',
    dialect: 'mysql',
    pool: {
      max: 15,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    logging: false,
  },

  production: {
    url: process.env.DATABASE_URL,   // cadena completa MySQL de Aiven
    dialect: 'mysql',
    logging: false,
    dialectOptions: {
      ssl: {
        ca: process.env.MYSQL_SSL_CA, // PEM de Aiven
        rejectUnauthorized: true,
      },
    },
    pool: {
      max: 15,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
  },
};
