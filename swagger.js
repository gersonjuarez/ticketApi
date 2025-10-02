// src/swagger.js
const swaggerJSDoc = require('swagger-jsdoc');
const pkg = require('./package.json');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Ticket API',
      version: pkg.version || '1.0.0',
      description: 'API de ventanillas, usuarios y servicios (con historial de estados).',
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Desarrollo' },
      // { url: 'https://tu-dominio.com', description: 'Producción' },
    ],
    components: {
      securitySchemes: {
        // ajusta si usas JWT / Bearer
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Cashier: {
          type: 'object',
          properties: {
            idCashier: { type: 'integer' },
            name: { type: 'string' },
            idService: { type: ['integer','null'] },
            description: { type: ['string','null'] },
            status: { type: 'boolean' },
            isPaused: { type: 'boolean' },
            isOutOfService: { type: 'boolean' },
            lastStateComment: { type: ['string','null'] },
            lastStateAt: { type: ['string','null'], format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CashierStatusLog: {
          type: 'object',
          properties: {
            idCashierStatusLog: { type: 'integer' },
            idCashier: { type: 'integer' },
            statusType: { type: 'string', enum: ['PAUSE', 'OUT_OF_SERVICE'] },
            comment: { type: 'string' },
            startedAt: { type: 'string', format: 'date-time' },
            endedAt: { type: ['string','null'], format: 'date-time' },
            performedByUserId: { type: 'integer' },
            closedByUserId: { type: ['integer','null'] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Service: {
          type: 'object',
          properties: {
            idService: { type: 'integer' },
            name: { type: 'string' },
            prefix: { type: 'string' },
          },
        },
        User: {
          type: 'object',
          properties: {
            idUser: { type: 'integer' },
            fullName: { type: 'string' },
            username: { type: 'string' },
            email: { type: 'string', format: 'email' },
            idRole: { type: 'integer' },
            status: { type: 'boolean' },
            idCashier: { type: ['integer','null'] },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: { error: { type: 'string' }, message: { type: 'string' } },
        },
      },
    },
  },
  apis: [
    './routes/**/*.js',
    './controllers/**/*.js',
  ],
};

const swaggerSpec = swaggerJSDoc(options);
module.exports = { swaggerSpec };
