// models/cashierStatusLog.js
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class CashierStatusLog extends Model {
    static associate(models) {
      CashierStatusLog.belongsTo(models.Cashier, {
        foreignKey: "idCashier",
        as: "cashier",
      });
      CashierStatusLog.belongsTo(models.User, {
        foreignKey: "performedByUserId",
        as: "performedBy",
      });
      CashierStatusLog.belongsTo(models.User, {
        foreignKey: "closedByUserId",
        as: "closedBy",
      });
    }
  }

  CashierStatusLog.init(
    {
      idCashierStatusLog: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER,
      },
      idCashier: {
        allowNull: false,
        type: DataTypes.INTEGER,
      },
      // PAUSE | OUT_OF_SERVICE
      statusType: {
        allowNull: false,
        type: DataTypes.ENUM("PAUSE", "OUT_OF_SERVICE"),
      },
      comment: {
        allowNull: false,
        type: DataTypes.STRING(500),
      },
      // inicio/fin del intervalo
      startedAt: {
        allowNull: false,
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      endedAt: {
        allowNull: true,
        type: DataTypes.DATE,
      },
      // quién ejecutó la acción
      performedByUserId: {
        allowNull: false,
        type: DataTypes.INTEGER,
      },
      // quién reanudó (al cerrar el intervalo)
      closedByUserId: {
        allowNull: true,
        type: DataTypes.INTEGER,
      },
    },
    {
      sequelize,
      modelName: "CashierStatusLog",
      tableName: "cashier_status_logs",
      timestamps: true,
      underscored: false,
      freezeTableName: true,
      indexes: [
        { fields: ["idCashier", "statusType", "endedAt"] },
      ],
    }
  );

  return CashierStatusLog;
};
