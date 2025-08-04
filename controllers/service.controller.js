// Controller for Service CRUD operations
const { Service } = require('../models');

exports.findAll = async (req, res) => {
  try {
    const services = await Service.findAll({where: { status: 1 }});
    res.json(services);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.findById = async (req, res) => {
  try {
    const service = await Service.findByPk(req.params.id);
    if (!service) return res.status(404).json({ error: 'Not found' });
    res.json(service);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const newService = await Service.create(req.body);
    res.status(201).json(newService);
    // Emitir solo si el servicio está activo (status === 1)
    if (global.io && newService.status === 1) {
      global.io.emit('new-service', newService);
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const [updated] = await Service.update(req.body, {
      where: { idService: req.params.id }
    });
    if (!updated) return res.status(404).json({ error: 'Not found' });
    const updatedService = await Service.findByPk(req.params.id);
    res.json(updatedService);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const deleted = await Service.destroy({
      where: { idService: req.params.id }
    });
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
