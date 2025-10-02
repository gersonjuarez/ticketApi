// services/attendance.service.js
const { Op } = require('sequelize');
const { TicketAttendance } = require('../models');

async function findOpenSpan(ticketId, t = null) {
  return TicketAttendance.findOne({
    where: { idTicket: ticketId, endedAt: { [Op.is]: null } },
    transaction: t,
    lock: t?.LOCK?.UPDATE,
  });
}

async function openSpan({ idTicket, idCashier, idService, at = new Date() }, t = null) {
  const open = await findOpenSpan(idTicket, t);
  if (open) return open;
  return TicketAttendance.create(
    { idTicket, idCashier, idService, startedAt: at, endedAt: null },
    { transaction: t }
  );
}

async function closeOpenSpan({ idTicket, at = new Date() }, t = null) {
  const open = await findOpenSpan(idTicket, t);
  if (!open) return null;
  await open.update({ endedAt: at }, { transaction: t });
  return open;
}

async function rotateSpan({ idTicket, idCashier, idService, at = new Date() }, t = null) {
  const open = await findOpenSpan(idTicket, t);
  if (open && open.idCashier === idCashier) return open;
  if (open) await open.update({ endedAt: at }, { transaction: t });
  return openSpan({ idTicket, idCashier, idService, at }, t);
}

module.exports = { findOpenSpan, openSpan, closeOpenSpan, rotateSpan };
