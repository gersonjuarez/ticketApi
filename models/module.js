const { Model } = require("sequelize");
module.exports = (sequelize, DataTypes) => {
    class Module extends Model {
        static associate(models) {
            Module.belongsToMany(models.Role, { through: models.RoleModule, foreignKey: 'idModule' });
        }
    }
    Module.init({
        idModule: {
            allowNull: false,
            autoIncrement: true,
            primaryKey: true,
            type: DataTypes.INTEGER,
        },
        name: {
            type: DataTypes.STRING(50),
            allowNull: false,
        },
        route: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },
        status: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
    }, {
        sequelize,
        modelName: "Module",
        timestamps: true,
    });
    return Module;
};
