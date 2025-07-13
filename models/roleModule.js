module.exports = (sequelize, DataTypes) => {
    const RoleModule = sequelize.define('RoleModule', {
        idRoleModule: {
            allowNull: false,
            autoIncrement: true,
            primaryKey: true,
            type: DataTypes.INTEGER,
        },
        idRole: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        idModule: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
    }, {
        timestamps: true,
    });
    return RoleModule;
};
