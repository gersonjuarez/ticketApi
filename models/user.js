// models/user.js
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      User.belongsTo(models.Cashier, { foreignKey: "idCashier" });
      User.belongsTo(models.Role,    { foreignKey: "idRole" });
    }
  }

  User.init(
    {
      idUser: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER,
      },
      username: {
        type: DataTypes.STRING(30),
        allowNull: false,
        // unique: true, // si quieres forzar unicidad desde el modelo
      },
      password: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      fullName: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING(100),
        allowNull: false,
        // unique: true, // idem
        // validate: { isEmail: true }, // opcional
      },
      status: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      idRole: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      idCashier: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // createdAt / updatedAt los maneja Sequelize por timestamps:true
    },
    {
      sequelize,
      modelName: "User",
      tableName: "users",     // <-- EXACTO como en MySQL
      timestamps: true,
      underscored: false,
      freezeTableName: true,  // evita pluralización automática
    }
  );

  return User;
};
