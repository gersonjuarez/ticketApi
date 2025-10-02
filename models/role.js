// models/role.js
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Role extends Model {
    static associate(models) {
      // Rol -> muchos usuarios
      Role.hasMany(models.User, {
        foreignKey: "idRole",
      });

      // Rol <-> Módulos (tabla de unión rolemodules)
      Role.belongsToMany(models.Module, {
        through: models.RoleModule,
        foreignKey: "idRole",
        otherKey: "idModule",
      });
    }
  }

  Role.init(
    {
      idRole: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER,
      },
      name: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },
      status: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      // NUEVO: bandera para marcar si el rol es de Cajero
      isCashier: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // createdAt / updatedAt los maneja Sequelize con timestamps:true
    },
    {
      sequelize,
      modelName: "Role",
      tableName: "roles",
      timestamps: true,
      underscored: false,
      freezeTableName: true,
    }
  );

  return Role;
};
