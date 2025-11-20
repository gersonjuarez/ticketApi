const { sequelize, ServiceTurnCounter } = require("../models");
const { Transaction } = require("sequelize");
const { format } = require("date-fns");

async function getNextTurnNumberAtomic(idService) {
  const today = format(new Date(), "yyyy-MM-dd");

  return await sequelize.transaction(
    { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE },
    async (t) => {
      const [affected] = await ServiceTurnCounter.update(
        { next_number: sequelize.literal("next_number + 1") },
        {
          where: { service_id: idService, turn_date: today },
          transaction: t,
        }
      );

      if (affected === 1) {
        const row = await ServiceTurnCounter.findOne({
          where: { service_id: idService, turn_date: today },
          transaction: t,
        });

        return row.next_number;
      }

      await ServiceTurnCounter.create(
        {
          service_id: idService,
          turn_date: today,
          next_number: 1,
        },
        { transaction: t }
      );

      return 1;
    }
  );
}

module.exports = { getNextTurnNumberAtomic };
