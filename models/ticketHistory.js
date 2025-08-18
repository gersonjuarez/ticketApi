// models/tickethistory.js
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class TicketHistory extends Model {
    static associate(models) {
      TicketHistory.belongsTo(models.TicketRegistration, {
        foreignKey: "idTicket",
      });
      TicketHistory.belongsTo(models.User, {
        foreignKey: "changedByUser",
      });
    }
  }

  TicketHistory.init(
    {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER,
      },
      idTicket: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      fromStatus: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      toStatus: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      changedByUser: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      timestamp: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "TicketHistory",
      tableName: "tickethistories", 
      timestamps: true,
      freezeTableName: true,
    }
  );

  return TicketHistory;
};
