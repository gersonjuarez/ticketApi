"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // SERVICES
    await queryInterface.createTable("services", {
      idService: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      name: { type: Sequelize.STRING(100), allowNull: false },
      prefix: { type: Sequelize.STRING(15), allowNull: true },
      value: { type: Sequelize.STRING(5), allowNull: false },
      description: { type: Sequelize.TEXT("long"), allowNull: true },
      status: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    // CASHIERS
    await queryInterface.createTable("cashiers", {
      idCashier: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      name: { type: Sequelize.STRING(50), allowNull: false },
      idService: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "services", key: "idService" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      description: { type: Sequelize.TEXT("long"), allowNull: true },
      status: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      isPaused: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      isOutOfService: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      lastStateComment: { type: Sequelize.STRING(500), allowNull: true },
      lastStateAt: { type: Sequelize.DATE, allowNull: true },
      allowTransfersIn: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      allowTransfersOut: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    // CLIENTS
    await queryInterface.createTable("clients", {
      idClient: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      name: { type: Sequelize.STRING(50), allowNull: false },
      dpi: { type: Sequelize.STRING(15), allowNull: true },
      telefono: { type: Sequelize.STRING(20), allowNull: true },
      correo: { type: Sequelize.STRING(50), allowNull: true },
      status: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    // ROLES
    await queryInterface.createTable("roles", {
      idRole: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      name: { type: Sequelize.STRING(20), allowNull: false },
      status: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      isCashier: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    // MODULES
    await queryInterface.createTable("modules", {
      idModule: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      name: { type: Sequelize.STRING(50), allowNull: false },
      route: { type: Sequelize.STRING(100), allowNull: false },
      description: { type: Sequelize.TEXT("long"), allowNull: true },
      status: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    // ROLEMODULES
    await queryInterface.createTable("rolemodules", {
      idRoleModule: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      idRole: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "roles", key: "idRole" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      idModule: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "modules", key: "idModule" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.addIndex("rolemodules", ["idRole"]);
    await queryInterface.addIndex("rolemodules", ["idModule"]);

    // USERS
    await queryInterface.createTable("users", {
      idUser: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      username: { type: Sequelize.STRING(30), allowNull: false },
      password: { type: Sequelize.STRING(100), allowNull: false },
      fullName: { type: Sequelize.STRING(100), allowNull: false },
      email: { type: Sequelize.STRING(100), allowNull: false },
      status: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      idRole: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "roles", key: "idRole" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT"
      },
      idCashier: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "cashiers", key: "idCashier" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.addIndex("users", ["idRole"]);
    await queryInterface.addIndex("users", ["idCashier"]);

    // TICKETSTATUS
    await queryInterface.createTable("ticketstatus", {
      idTicketStatus: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      name: { type: Sequelize.STRING(30), allowNull: false },
      status: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    // TICKETREGISTRATIONS (BÁSICO)
    await queryInterface.createTable("ticketregistrations", {
      idTicketRegistration: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      turnNumber: { type: Sequelize.INTEGER, allowNull: false },
      idTicketStatus: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "ticketstatus", key: "idTicketStatus" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT"
      },
      idClient: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "clients", key: "idClient" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT"
      },
      idService: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "services", key: "idService" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT"
      },
      idCashier: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "cashiers", key: "idCashier" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      dispatchedByUser: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "users", key: "idUser" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      forcedToCashierId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "cashiers", key: "idCashier" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      status: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      correlativo: { type: Sequelize.STRING(50), allowNull: true },

      // NUEVOS CAMPOS (impresión + idempotencia)
      idempotency_key: { type: Sequelize.STRING(64), allowNull: true, unique: true },
      print_status: {
        type: Sequelize.ENUM("pending", "sent", "failed"),
        allowNull: false,
        defaultValue: "pending",
      },
      printed_at: { type: Sequelize.DATE, allowNull: true },

      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.addIndex("ticketregistrations", ["idTicketStatus"]);
    await queryInterface.addIndex("ticketregistrations", ["idClient"]);
    await queryInterface.addIndex("ticketregistrations", ["idService"]);
    await queryInterface.addIndex("ticketregistrations", ["idCashier"]);
    await queryInterface.addIndex("ticketregistrations", ["dispatchedByUser"]);
    await queryInterface.addIndex("ticketregistrations", ["forcedToCashierId"]);
    await queryInterface.addIndex("ticketregistrations", ["idempotency_key"], { unique: true });

    // Columna generada para índice único por día
    await queryInterface.sequelize.query(`
      ALTER TABLE ticketregistrations
      ADD COLUMN created_on DATE
      GENERATED ALWAYS AS (DATE(createdAt)) STORED
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE ticketregistrations
      ADD UNIQUE KEY uq_service_day_turn (idService, created_on, turnNumber)
    `);

    // TICKETHISTORIES
    await queryInterface.createTable("tickethistories", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      idTicket: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "ticketregistrations", key: "idTicketRegistration" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      fromStatus: { type: Sequelize.INTEGER, allowNull: false },
      toStatus: { type: Sequelize.INTEGER, allowNull: false },
      changedByUser: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "users", key: "idUser" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT"
      },
      timestamp: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.addIndex("tickethistories", ["idTicket"]);
    await queryInterface.addIndex("tickethistories", ["changedByUser"]);

    // TICKET_TRANSFER_LOGS
    await queryInterface.createTable("ticket_transfer_logs", {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      idTicketRegistration: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "ticketregistrations", key: "idTicketRegistration" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      fromCashierId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "cashiers", key: "idCashier" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      toCashierId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "cashiers", key: "idCashier" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT"
      },
      performedByUserId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "users", key: "idUser" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT"
      },
      comment: { type: Sequelize.STRING(500), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.addIndex("ticket_transfer_logs", ["idTicketRegistration"]);
    await queryInterface.addIndex("ticket_transfer_logs", ["fromCashierId"]);
    await queryInterface.addIndex("ticket_transfer_logs", ["toCashierId"]);
    await queryInterface.addIndex("ticket_transfer_logs", ["performedByUserId"]);

    // CASHIER_STATUS_LOGS
    await queryInterface.createTable("cashier_status_logs", {
      idCashierStatusLog: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      idCashier: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "cashiers", key: "idCashier" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      statusType: { type: Sequelize.ENUM("PAUSE", "OUT_OF_SERVICE"), allowNull: false },
      comment: { type: Sequelize.STRING(500), allowNull: false },
      startedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      endedAt: { type: Sequelize.DATE, allowNull: true },
      performedByUserId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "users", key: "idUser" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT"
      },
      closedByUserId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "users", key: "idUser" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn("NOW") },
    });

    await queryInterface.addIndex("cashier_status_logs", ["idCashier", "statusType", "endedAt"]);

    // ===== NUEVAS TABLAS PARA CONTROL SÓLIDO =====

    // 1) Contador diario por servicio
    await queryInterface.createTable("servicedailycounter", {
      service_id: { type: Sequelize.INTEGER, allowNull: false, primaryKey: true, references: { model: "services", key: "idService" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      day: { type: Sequelize.DATEONLY, allowNull: false, primaryKey: true },
      next: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
    });

    // 2) Outbox de impresión
    await queryInterface.createTable("printoutbox", {
      id: { type: Sequelize.BIGINT, autoIncrement: true, primaryKey: true },
      ticket_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "ticketregistrations", key: "idTicketRegistration" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      location_id: { type: Sequelize.STRING(100), allowNull: true },
      payload: { type: Sequelize.JSON, allowNull: false }, // en MariaDB será LONGTEXT detrás, ok
      status: { type: Sequelize.ENUM("pending", "sent", "failed"), allowNull: false, defaultValue: "pending" },
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      last_error: { type: Sequelize.TEXT, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updatedAt: { type: Sequelize.DATE, allowNull: true, defaultValue: null },
    });

    await queryInterface.addIndex("printoutbox", ["status"]);
    await queryInterface.addIndex("printoutbox", ["ticket_id"]);
  },

  async down(queryInterface, Sequelize) {
    // Orden inverso respetando FKs y ENUMs
    await queryInterface.removeIndex("printoutbox", ["ticket_id"]);
    await queryInterface.removeIndex("printoutbox", ["status"]);
    await queryInterface.dropTable("printoutbox");

    await queryInterface.dropTable("servicedailycounter");

    await queryInterface.dropTable("cashier_status_logs");
    await queryInterface.dropTable("ticket_transfer_logs");
    await queryInterface.dropTable("tickethistories");

    // Quitar unique + columna generada + nuevas cols de ticketregistrations
    await queryInterface.sequelize.query(`ALTER TABLE ticketregistrations DROP INDEX uq_service_day_turn`);
    await queryInterface.sequelize.query(`ALTER TABLE ticketregistrations DROP COLUMN created_on`);

    await queryInterface.removeIndex("ticketregistrations", ["idempotency_key"]);
    await queryInterface.removeColumn("ticketregistrations", "printed_at");
    await queryInterface.removeColumn("ticketregistrations", "print_status");
    await queryInterface.removeColumn("ticketregistrations", "idempotency_key");

    // Estos índices “normales” no es obligatorio quitarlos (Sequelize los quitará con la tabla)
    await queryInterface.dropTable("ticketregistrations");
    await queryInterface.dropTable("ticketstatus");
    await queryInterface.dropTable("users");
    await queryInterface.dropTable("rolemodules");
    await queryInterface.dropTable("modules");
    await queryInterface.dropTable("roles");
    await queryInterface.dropTable("clients");
    await queryInterface.dropTable("cashiers");
    await queryInterface.dropTable("services");

    // Nota: en MySQL/MariaDB no hace falta DROP TYPE de ENUM; en Postgres sí.
  },
};
