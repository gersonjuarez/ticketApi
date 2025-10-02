// logger.js
const path = require('path');
const fs = require('fs');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const isProd = process.env.NODE_ENV === 'production';

const enumerateErrorFormat = winston.format((info) => {
  if (info instanceof Error) {
    return Object.assign({}, info, {
      message: info.message,
      stack: info.stack,
    });
  }
  return info;
});

const baseFormat = winston.format.combine(
  enumerateErrorFormat(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  enumerateErrorFormat(),
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return stack
      ? `[${timestamp}] ${level}: ${message}\n${stack}${rest}`
      : `[${timestamp}] ${level}: ${message}${rest}`;
  })
);

const transports = [
  new DailyRotateFile({
    dirname: LOG_DIR,
    filename: 'app-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '30d',
    level: isProd ? 'info' : 'debug',
  }),
  new DailyRotateFile({
    dirname: LOG_DIR,
    filename: 'error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '60d',
    level: 'error',
  }),
];

if (!isProd) {
  transports.push(new winston.transports.Console({ level: 'debug', format: consoleFormat }));
} else {
  transports.push(new winston.transports.Console({ level: 'info', format: baseFormat }));
}

const logger = winston.createLogger({
  level: isProd ? 'info' : 'debug',
  format: baseFormat,
  transports,
  exitOnError: false, // nunca matar el proceso
});

// Helper para clonar con metadatos (p.ej. requestId, userId, etc.)
function withMeta(baseLogger, meta = {}) {
  return {
    error: (msg, more = {}) => baseLogger.error(msg, { ...meta, ...more }),
    warn:  (msg, more = {}) => baseLogger.warn(msg,  { ...meta, ...more }),
    info:  (msg, more = {}) => baseLogger.info(msg,  { ...meta, ...more }),
    http:  (msg, more = {}) => baseLogger.http ? baseLogger.http(msg, { ...meta, ...more }) : baseLogger.info(msg, { ...meta, ...more }),
    debug: (msg, more = {}) => baseLogger.debug(msg, { ...meta, ...more }),
    child: (m = {}) => withMeta(baseLogger, { ...meta, ...m }),
  };
}

module.exports = { logger, withMeta };
