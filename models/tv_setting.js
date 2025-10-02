// models/tv_setting.js
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class TvSetting extends Model {
    static associate(_models) {}
  }

  TvSetting.init(
    {
      idSetting: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER,
      },
      /** key única, ej: 'marqueeText' */
      key: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
      },
      /** valor (texto largo, JSON, etc.) */
      value: {
        type: DataTypes.TEXT('long'),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'TvSetting',
      tableName: 'tv_settings',
      timestamps: true,
      underscored: false,
      freezeTableName: true,
    }
  );

  return TvSetting;
};
