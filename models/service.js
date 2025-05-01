const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
    class Service extends Model {
        static associate(models) {
            Service.hasMany(models.Cashier, {
                foreignKey: "idService",
            });
            Service.hasMany(models.TicketRegistration, {
                foreignKey: "idService",
            });
           /*  Service.hasMany(models.Client, {
                foreignKey: "idService",
            }); */
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
                type: DataTypes.STRING(15),
                allowNull: false,
            },
            prefix: {
                type: DataTypes.STRING(15),
            },
            value:{
                type:DataTypes.STRING(5),
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
            modelName: "Service",
            timestamps: true,

        }
    );
    return Service;
};
