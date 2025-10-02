// models/ticketattendance.js
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class TicketAttendance extends Model {
    static associate(models) {
      // FK -> ticketregistrations.idTicketRegistration
      TicketAttendance.belongsTo(models.TicketRegistration, {
        as: 'ticket',
        foreignKey: 'idTicket',
        targetKey: 'idTicketRegistration',
      });

      // FK -> cashiers.idCashier
      TicketAttendance.belongsTo(models.Cashier, {
        as: 'cashier',
        foreignKey: 'idCashier',
        targetKey: 'idCashier',
      });

      // FK -> services.idService
      TicketAttendance.belongsTo(models.Service, {
        as: 'service',
        foreignKey: 'idService',
        targetKey: 'idService',
      });
    }
  }

  TicketAttendance.init(
    {
      idAttendance: {
        type: DataTypes.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      idTicket: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'ticketregistrations',    // nombre EXACTO de la tabla
          key: 'idTicketRegistration',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },

      idCashier: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'cashiers',
          key: 'idCashier',
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },

      idService: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'services',
          key: 'idService',
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },

      startedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },

      endedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'TicketAttendance',
      tableName: 'ticketattendance',  // coincide con tu CREATE TABLE
      freezeTableName: true,
      timestamps: true,               // createdAt / updatedAt
      underscored: false,
      indexes: [
        { fields: ['idTicket'] },
        { fields: ['idCashier'] },
        { fields: ['idService'] },
        { fields: ['startedAt'] },
        { fields: ['endedAt'] },
      ],
    }
  );

  return TicketAttendance;
};
