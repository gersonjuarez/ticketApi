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
            username: {
                type: DataTypes.STRING(30),
                allowNull: false,
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
            },
            status: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: true,
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
            timestamps: true,
        }
    );
    return User;
};
