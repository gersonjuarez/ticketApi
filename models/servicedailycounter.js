// models/servicedailycounter.js
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class ServiceDailyCounter extends Model {
    static associate(models) {
      ServiceDailyCounter.belongsTo(models.Service, {
        foreignKey: "service_id",
      });
    }
  }

  ServiceDailyCounter.init(
    {
      service_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      day: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        primaryKey: true,
        comment: "Fecha (día) para el contador",
      },
      next: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        comment: "Siguiente número a asignar",
      },
    },
    {
      sequelize,
      modelName: "ServiceDailyCounter",
      tableName: "servicedailycounter",
      timestamps: false,
      freezeTableName: true,
    }
  );

  return ServiceDailyCounter;
};
