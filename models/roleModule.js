// models/rolemodule.js
module.exports = (sequelize, DataTypes) => {
  const RoleModule = sequelize.define(
    "RoleModule",
    {
      idRoleModule: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER,
      },
      idRole: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      idModule: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: "RoleModule",
      tableName: "rolemodules", 
      timestamps: true,        
      freezeTableName: true,    
    }
  );

  RoleModule.associate = (models) => {
    RoleModule.belongsTo(models.Role, {
      foreignKey: "idRole",
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
    RoleModule.belongsTo(models.Module, {
      foreignKey: "idModule",
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
  };

  return RoleModule;
};
