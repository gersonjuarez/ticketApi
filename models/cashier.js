// models/cashier.js
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Cashier extends Model {
    static associate(models) {
      Cashier.hasMany(models.User, { foreignKey: "idCashier" });
      Cashier.belongsTo(models.Service, { foreignKey: "idService" });

      // Historial de estados
      Cashier.hasMany(models.CashierStatusLog, {
        foreignKey: "idCashier",
        as: "statusLogs",
      });
    }
  }

  Cashier.init(
    {
      idCashier: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER,
      },
      name: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      idService: {
        type: DataTypes.INTEGER,
        allowNull: true, // puede ser NULL en tu BD
      },
      description: {
        type: DataTypes.TEXT("long"),
        allowNull: true,
      },
      status: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true, // ventanilla habilitada/inactiva lógica global
      },

      // NUEVO: banderas de estado operativo
      isPaused: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      isOutOfService: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Opcional: última razón visible rápida (snapshot)
      lastStateComment: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      lastStateAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      allowTransfersIn: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false, // esta ventanilla acepta que le trasladen tickets
      },
      allowTransfersOut: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false, // desde esta ventanilla se pueden trasladar tickets a otras
      },
    },
    {
      sequelize,
      modelName: "Cashier",
      tableName: "cashiers",
      timestamps: true,
      underscored: false,
      freezeTableName: true,
    }
  );

  return Cashier;
};
