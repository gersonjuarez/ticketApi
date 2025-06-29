// Controller for TicketRegistration CRUD operations
const { TicketRegistration } = require('../models');

exports.findAll = async (req, res) => {
  try {
    const tickets = await TicketRegistration.findAll();
    res.json(tickets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.findById = async (req, res) => {
  try {
    const ticket = await TicketRegistration.findByPk(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Not found' });
    res.json(ticket);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const newTicket = await TicketRegistration.create(req.body);
    res.status(201).json(newTicket);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const [updated] = await TicketRegistration.update(req.body, {
      where: { idTicketRegistration: req.params.id }
    });
    if (!updated) return res.status(404).json({ error: 'Not found' });
    const updatedTicket = await TicketRegistration.findByPk(req.params.id);
    res.json(updatedTicket);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const deleted = await TicketRegistration.destroy({
      where: { idTicketRegistration: req.params.id }
    });
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
