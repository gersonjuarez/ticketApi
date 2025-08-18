// models/client.js
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Client extends Model {
    static associate(models) {
      Client.hasMany(models.TicketRegistration, {
        foreignKey: "idClient",
      });

    }
  }

  Client.init(
    {
      idClient: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER,
      },
      name: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      dpi: {
        type: DataTypes.STRING(15),
        allowNull: true,
      },
      telefono: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      correo: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      status: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      // createdAt / updatedAt los maneja Sequelize por timestamps:true
    },
    {
      sequelize,
      modelName: "Client",
      tableName: "clients",   // <-- EXACTO como en MySQL
      timestamps: true,
      underscored: false,
      freezeTableName: true,  // evita pluralización automática
    }
  );

  return Client;
};
