const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
    class Cashier extends Model {
        static associate(models) {
            Cashier.hasMany(models.User, {
                foreignKey: "idCashier",
            });
            Cashier.belongsTo(models.Service, {
                foreignKey: "idService",
            });
            Cashier.hasMany(models.TicketRegistration, {
                foreignKey: "idCashier",
            });
        }
    }
    Cashier.init(
      
        {
            idCashier: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: DataTypes.INTEGER,
            },
            name: {
                type: DataTypes.STRING(15),
                allowNull: false,
            },
            descripcion: {
                type: DataTypes.STRING(30),
            },
            idService:{
                type:DataTypes.INTEGER,
                allowNull:false
            },
            status: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: true,
            },
        },
        {
            sequelize,
            modelName: "Cashier",
            timestamps: true,
        }
    );
    return Cashier;
};
