// Controller for TicketStatus CRUD operations
const { TicketStatus } = require('../models');

exports.findAll = async (req, res) => {
  try {
    const statuses = await TicketStatus.findAll();
    res.json(statuses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.findById = async (req, res) => {
  try {
    const status = await TicketStatus.findByPk(req.params.id);
    if (!status) return res.status(404).json({ error: 'Not found' });
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const newStatus = await TicketStatus.create(req.body);
    res.status(201).json(newStatus);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const [updated] = await TicketStatus.update(req.body, {
      where: { idTicketStatus: req.params.id }
    });
    if (!updated) return res.status(404).json({ error: 'Not found' });
    const updatedStatus = await TicketStatus.findByPk(req.params.id);
    res.json(updatedStatus);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const deleted = await TicketStatus.destroy({
      where: { idTicketStatus: req.params.id }
    });
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
