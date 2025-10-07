// models/service_turn_counters.js
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class ServiceTurnCounter extends Model {
    static associate(models) {
      // opcional:
      ServiceTurnCounter.belongsTo(models.Service, { foreignKey: 'service_id' });
    }
  }

  ServiceTurnCounter.init(
    {
      service_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      turn_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        primaryKey: true,
      },
      next_number: {
        type: DataTypes.INTEGER,
        allowNull: false,
        // Si quieres empezar en 0 (y luego incrementas a 1):
        defaultValue: 0,
      },
    },
    {
      sequelize,
      modelName: 'ServiceTurnCounter',
      tableName: 'service_turn_counters',
      timestamps: false,
      freezeTableName: true,
    }
  );

  return ServiceTurnCounter;
};
