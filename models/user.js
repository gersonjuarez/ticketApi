const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    class User extends Model {
        static associate(models) {
            User.belongsTo(models.Cashier, {
                foreignKey: "idCashier",
            });
            User.belongsTo(models.Role, {
                foreignKey: "idRole",
            });
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
            user: {
                type: DataTypes.STRING(25),
                allowNull: false,
            },
            password: {
                type: DataTypes.STRING(500),
                allowNull: false,
            },
            idRole:{
                type:DataTypes.INTEGER,
                allowNull:false
            },
            idCashier:{
                type:DataTypes.INTEGER,
                allowNull:false
            }
        },
        {
            sequelize,
            modelName: "User",
        }
    );
    return User;
};
