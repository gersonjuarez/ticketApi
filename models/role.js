const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
    class Role extends Model {
        static associate(models) {
            
            Role.hasMany(models.User, {
                foreignKey: "idRole",
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
            role: {
                type: DataTypes.STRING(25),
                allowNull: false,
            },
            status: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
       
        },
        {
            sequelize,
            modelName: "Role",
        }
    );
    return Role;
};
