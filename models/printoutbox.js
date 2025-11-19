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
      ticket_id: { type: DataTypes.INTEGER, allowNull: true },
      location_id: { type: DataTypes.STRING(100), allowNull: false },

      payload: {
        type: DataTypes.TEXT,
        allowNull: false,
        get() {
          const raw = this.getDataValue("payload");
          if (!raw) return null;
          try { return JSON.parse(raw); } catch { return raw; }
        },
        set(val) {
          this.setDataValue("payload", typeof val === "string" ? val : JSON.stringify(val ?? {}));
        },
      },

      status: {
        type: DataTypes.ENUM("pending", "sent", "failed", "done", "dead"),
        allowNull: false,
        defaultValue: "pending",
      },

      attempts: { type: DataTypes.INTEGER, defaultValue: 0 },
      last_error: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: "PrintOutbox",
      tableName: "printoutbox",
      timestamps: true,
      freezeTableName: true,
    }
  );

  /* --------------------------------------------------
   🔥 HOOK DE SINCRONIZACIÓN (AQUÍ VA)
  -------------------------------------------------- */
  PrintOutbox.addHook("afterUpdate", async (job) => {
    if (!job.ticket_id) return;

    const TicketRegistration = sequelize.models.TicketRegistration;

    let newStatus = null;
    let printedAt = null;

    switch (job.status) {
      case "done":
        newStatus = "printed";
        printedAt = new Date();
        break;

      case "failed":
        newStatus = "failed";
        break;

      case "dead":
        newStatus = "dead";
        break;

      case "sent":
        newStatus = "sent";
        break;
    }

    if (newStatus) {
      await TicketRegistration.update(
        {
          printStatus: newStatus,
          ...(printedAt && { printedAt }),
        },
        { where: { idTicketRegistration: job.ticket_id } }
      );
    }
  });

  return PrintOutbox;
};
