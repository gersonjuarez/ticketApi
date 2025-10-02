const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class PrintOutbox extends Model {
    static associate(models) {
      PrintOutbox.belongsTo(models.TicketRegistration, { foreignKey: "ticket_id" });
    }
  }

  PrintOutbox.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
      ticket_id: { type: DataTypes.INTEGER, allowNull: true }, // puede venir null (jobs sin ticket)
      location_id: { type: DataTypes.STRING(100), allowNull: false },

    
      payload: {
        type: DataTypes.TEXT,
        allowNull: false,
        get() {
          const raw = this.getDataValue("payload");
          if (raw == null) return null;
          if (typeof raw === "object") return raw;
          try { return JSON.parse(raw); } catch { return raw; }
        },
        set(val) {
          if (typeof val === "string") {
            this.setDataValue("payload", val);
          } else {
            this.setDataValue("payload", JSON.stringify(val ?? {}));
          }
        },
      },

    
      status: {
        type: DataTypes.ENUM("pending", "sent", "failed", "done", "dead"),
        allowNull: false,
        defaultValue: "pending",
      },

      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      last_error: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: "PrintOutbox",
      tableName: "printoutbox",
      timestamps: true,
      freezeTableName: true,
      indexes: [
        { fields: ["status"] },
        { fields: ["ticket_id"] },
      ],
    }
  );

  return PrintOutbox;
};
