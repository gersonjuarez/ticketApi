// models/service.js
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Service extends Model {
    static associate(models) {
      Service.hasMany(models.Cashier, { foreignKey: "idService" });
      Service.hasMany(models.TicketRegistration, { foreignKey: "idService" });
    }
  }

  Service.init(
    {
      idService: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      prefix: {
        type: DataTypes.STRING(15),
      },
      value: {
        type: DataTypes.STRING(5),
        allowNull: false,
      },
      status: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      // createdAt / updatedAt los maneja Sequelize con timestamps:true
    },
    {
      sequelize,
      modelName: "Service",
      tableName: "services",   // <-- EXACTO como en MySQL
      timestamps: true,
      underscored: false,
      freezeTableName: true,   // evita pluralización automática
    }
  );

  return Service;
};
