// models/ticketregistration.js
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class TicketRegistration extends Model {
    static associate(models) {
      TicketRegistration.belongsTo(models.TicketStatus, {
        foreignKey: "idTicketStatus",
      });
      TicketRegistration.belongsTo(models.Client, {
        foreignKey: "idClient",
      });
      TicketRegistration.belongsTo(models.Service, {
        foreignKey: "idService",
      });
      TicketRegistration.belongsTo(models.Cashier, {
        foreignKey: "idCashier",
      });

      // Relación inversa: un ticket puede tener muchos historiales
      TicketRegistration.hasMany(models.TicketHistory, {
        foreignKey: "idTicket",
      });
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
      turnNumber: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      idTicketStatus: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      idClient: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      idService: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      idCashier: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      status: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      correlativo: {
        type: DataTypes.STRING,
        allowNull: true,
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
