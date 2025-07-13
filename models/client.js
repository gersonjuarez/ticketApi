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
            name: {
                type: DataTypes.STRING(50),
                allowNull: false,
            },
            dpi: {
                type: DataTypes.STRING(15),
                allowNull: false,
            },
            telefono: {
                type: DataTypes.STRING(20),
                allowNull: true,
            },
            correo: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },
            status: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: true,
            },
        },
        {
            sequelize,
            modelName: "Client",
            timestamps: true,
        }
    );
    return Client;
};
