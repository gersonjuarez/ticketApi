const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
    class TicketStatus extends Model {
        static associate(models) {
            TicketStatus.hasMany(models.TicketRegistration, {
                foreignKey: "idTicketStatus",
            });
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
                type: DataTypes.STRING(30),
                allowNull: false,
            },
            status: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: true,
            },
        },
        {
            sequelize,
            modelName: "TicketStatus",
            tableName: "ticketstatus", // fuerza tabla singular
            freezeTableName: true,      // evita pluralización
            timestamps: true,
        }
    );
    return TicketStatus;
};
