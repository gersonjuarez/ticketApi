// models/ticketTransferLog.js
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class TicketTransferLog extends Model {
    static associate(models) {
      TicketTransferLog.belongsTo(models.TicketRegistration, {
        foreignKey: "idTicketRegistration",
        as: "ticket",
      });
      TicketTransferLog.belongsTo(models.Cashier, {
        foreignKey: "fromCashierId",
        as: "fromCashier",
      });
      TicketTransferLog.belongsTo(models.Cashier, {
        foreignKey: "toCashierId",
        as: "toCashier",
      });
      TicketTransferLog.belongsTo(models.User, {
        foreignKey: "performedByUserId",
        as: "performedBy",
      });
    }
  }

  TicketTransferLog.init(
    {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER,
      },
      idTicketRegistration: {
        allowNull: false,
        type: DataTypes.INTEGER,
      },
      fromCashierId: {
        allowNull: true,
        type: DataTypes.INTEGER,
      },
      toCashierId: {
        allowNull: false,
        type: DataTypes.INTEGER,
      },
      performedByUserId: {
        allowNull: false,
        type: DataTypes.INTEGER,
      },
      comment: {
        allowNull: true,
        type: DataTypes.STRING(500),
      },
      createdAt: {
        allowNull: false,
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "TicketTransferLog",
      tableName: "ticket_transfer_logs",
      timestamps: false, // en la tabla solo tenemos createdAt
      freezeTableName: true,
      indexes: [
        { fields: ["idTicketRegistration"] },
        { fields: ["fromCashierId"] },
        { fields: ["toCashierId"] },
        { fields: ["performedByUserId"] },
      ],
    }
  );

  return TicketTransferLog;
};
