const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class TicketRegistration extends Model {
    static associate(models) {
      TicketRegistration.belongsTo(models.TicketStatus, { foreignKey: "idTicketStatus" });
      TicketRegistration.belongsTo(models.Client, { foreignKey: "idClient" });
      TicketRegistration.belongsTo(models.Service, { foreignKey: "idService" });
      TicketRegistration.belongsTo(models.Cashier, { foreignKey: "idCashier" });

      TicketRegistration.belongsTo(models.User, {
        foreignKey: "dispatchedByUser",
        as: "DispatchedBy",
      });

      TicketRegistration.hasMany(models.TicketHistory, { foreignKey: "idTicket" });

      TicketRegistration.belongsTo(models.Cashier, {
        foreignKey: "forcedToCashierId",
        as: "ForcedToCashier",
      });

      TicketRegistration.hasMany(models.TicketTransferLog, {
        foreignKey: "idTicketRegistration",
        as: "transferLogs",
      });

      if (models.PrintOutbox) {
        TicketRegistration.hasMany(models.PrintOutbox, {
          foreignKey: "ticket_id",
          as: "printJobs",
        });
      }
    }
  }

TicketRegistration.init(
  {
    idTicketRegistration: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.INTEGER,
    },
    turnNumber: { type: DataTypes.INTEGER, allowNull: false },
    idTicketStatus: { type: DataTypes.INTEGER, allowNull: false },
    idClient: { type: DataTypes.INTEGER, allowNull: false },
    idService: { type: DataTypes.INTEGER, allowNull: false },
    idCashier: { type: DataTypes.INTEGER, allowNull: true },
    forcedToCashierId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "Si se fuerza el ticket a una caja específica",
    },
    dispatchedByUser: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "ID del usuario que despachó el ticket",
    },
    status: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    correlativo: { type: DataTypes.STRING(50), allowNull: true },

    // ===== NUEVOS CAMPOS =====
    idempotencyKey: {
      type: DataTypes.STRING(64),
      allowNull: true,
      unique: true,
      field: "idempotency_key",
      comment: "Para reintentos del mismo request sin duplicar ticket",
    },

    // ⬇⬇ Ajuste: admite los estados que realmente usamos en el código
    printStatus: {
      type: DataTypes.ENUM("pending", "sent", "printed", "error", "failed"),
      allowNull: false,
      defaultValue: "pending",
      field: "print_status",
    },
    printedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "printed_at",
    },

    // ✅ AGREGA ESTE CAMPO FALTANTE
transferredAt: {
  type: DataTypes.DATE,
  allowNull: true,
  field: "transferred_at",  
},
  },
  {
    sequelize,
    modelName: "TicketRegistration",
    tableName: "ticketregistrations",
    timestamps: true,
    freezeTableName: true,
  }
);

  return TicketRegistration;
};
