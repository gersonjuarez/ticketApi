// Controller for Cashier CRUD operations
const { Cashier } = require('../models');

exports.findAll = async (req, res) => {
  try {
    const cashiers = await Cashier.findAll();
    res.json(cashiers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.findById = async (req, res) => {
  try {
    const cashier = await Cashier.findByPk(req.params.id);
    if (!cashier) return res.status(404).json({ error: 'Not found' });
    res.json(cashier);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const newCashier = await Cashier.create(req.body);
    res.status(201).json(newCashier);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const [updated] = await Cashier.update(req.body, {
      where: { idCashier: req.params.id }
    });
    if (!updated) return res.status(404).json({ error: 'Not found' });
    const updatedCashier = await Cashier.findByPk(req.params.id);
    res.json(updatedCashier);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const deleted = await Cashier.destroy({
      where: { idCashier: req.params.id }
    });
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
