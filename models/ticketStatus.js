const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
    class TicketStatus extends Model {
        static associate(models) {
            TicketStatus.hasMany(models.TicketRegistration, {
                foreignKey: "idTicketStatus",
            });
          /*   TicketStatus.hasMany(models.Cashier, {
                foreignKey: "idTicketStatus",
            }); */
           
        }
    }
    TicketStatus.init(
      
        {
            idTicketStatus: {
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
                type: DataTypes.INTEGER,
            },
            name: {
                type: DataTypes.STRING(15),
                allowNull: false,
            },
            status: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 1,

            },
           
        },
        {
            sequelize,
            modelName: "TicketStatus",
            timestamps: true,
        }
    );
    return TicketStatus;
};
