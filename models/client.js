const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
    class Client extends Model {
        static associate(models) {
            Client.hasMany(models.TicketRegistration, {
                foreignKey: "idClient",
            });
          /*   Client.belongsTo(models.Cashier, {
                foreignKey: "idCashier",
            });
            Client.belongsTo(models.Service, {
                foreignKey: "idService",
            }); */
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
            dpi: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            name: {
                type: DataTypes.STRING(50),
                allowNull: false,
            },
           /*  idService:{
                type:DataTypes.INTEGER,
                allowNull:false
            },
            ticketNumber:{
                type:DataTypes.STRING(100),
                allowNull:false
            } */
        },
        {
            sequelize,
            modelName: "Client",
        }
    );
    return Client;
};
