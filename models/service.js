const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
    class Service extends Model {
        static associate(models) {
            Service.hasMany(models.Cashier, {
                foreignKey: "idService",
            });
        
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
            }
        },
        {
            sequelize,
            modelName: "Service",
        }
    );
    return Service;
};
