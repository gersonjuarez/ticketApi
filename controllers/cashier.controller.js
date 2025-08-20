// Controller for Cashier CRUD operations
const { Op, fn, col, literal } = require('sequelize');
const db = require('../models');
const { Cashier, User, Service, sequelize } = db; // <-- AQUI

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
    if (!cashier) return res.status(404).json({ error: "Not found" });
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
      where: { idCashier: req.params.id },
    });
    if (!updated) return res.status(404).json({ error: "Not found" });
    const updatedCashier = await Cashier.findByPk(req.params.id);
    res.json(updatedCashier);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    const deleted = await Cashier.destroy({
      where: { idCashier: req.params.id },
    });
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ deleted: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// NUEVO: lista usuarios asignados a la ventanilla
exports.findAssignedUsers = async (req, res) => {
  try {
    const id = req.params.id;
    const cashier = await Cashier.findByPk(id);
    if (!cashier) return res.status(404).json({ error: "Not found" });

    const users = await User.findAll({
      where: { idCashier: id },
      attributes: [
        "idUser",
        "fullName",
        "username",
        "email",
        "status",
        "idRole",
        "idCashier",
      ],
      order: [["fullName", "ASC"]],
    });

    res.json({ cashier, users });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
// controllers/users.controller.js (o donde tengas este handler)

exports.assignCashier = async (req, res) => {
  const { id } = req.params; // id del usuario
  const { idCashier, idService } = req.body;

  if (!idCashier || !idService) {
    return res.status(400).json({ error: "idCashier e idService son requeridos" });
  }

  const t = await sequelize.transaction();
  try {
    // 1) Usuario
    const user = await User.findByPk(id, { transaction: t });
    if (!user) {
      await t.rollback();
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    if (user.status === false) {
      await t.rollback();
      return res.status(400).json({ error: "Usuario inactivo" });
    }

    // 2) Ventanilla + su servicio
    const cashier = await Cashier.findByPk(idCashier, {
      include: [{ model: Service, attributes: ["idService", "name", "prefix"] }],
      transaction: t,
    });
    if (!cashier) {
      await t.rollback();
      return res.status(404).json({ error: "Ventanilla no encontrada" });
    }
    if (cashier.status === false) {
      await t.rollback();
      return res.status(400).json({ error: "Ventanilla inactiva" });
    }
    if (Number(cashier.idService) !== Number(idService)) {
      await t.rollback();
      return res.status(400).json({ error: "La ventanilla no pertenece al servicio seleccionado" });
    }

    // 3) VALIDACIÓN: ¿la ventanilla ya está ocupada por otro usuario?
    // Permitimos reasignar si es el mismo usuario (idUser === id)
    const alreadyTaken = await User.findOne({
      where: {
        idCashier: cashier.idCashier,
        idUser: { [Op.ne]: Number(id) }, // distinto usuario
        // opcional: solo considerar usuarios activos
        // status: true,
      },
      attributes: ['idUser', 'username', 'fullName'],
      transaction: t,
      lock: t.LOCK.UPDATE, // ayuda en concurrencia
    });

    if (alreadyTaken) {
      await t.rollback();
      return res.status(409).json({
        error: "CASHIER_TAKEN",
        message: `La ventanilla ya está asignada a ${alreadyTaken.fullName || alreadyTaken.username}`,
      });
    }

    // 4) Actualiza asignación (el servicio queda implícito por la ventanilla)
    await user.update({ idCashier: cashier.idCashier }, { transaction: t });

    await t.commit();
    return res.json({
      ok: true,
      user: {
        idUser: user.idUser,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        idRole: user.idRole,
        idCashier: user.idCashier,
        status: user.status,
      },
      cashier: {
        idCashier: cashier.idCashier,
        name: cashier.name,
      },
      service: cashier.Service
        ? {
            idService: cashier.Service.idService,
            name: cashier.Service.name,
            prefix: cashier.Service.prefix,
          }
        : null,
    });
  } catch (error) {
    if (t.finished !== "commit") await t.rollback();
    console.error(error);
    // Si usas el índice UNIQUE (abajo), un choque lanzará error de DB → devuelve 409
    if (error?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        error: "CASHIER_TAKEN",
        message: "La ventanilla ya está asignada a otro usuario",
      });
    }
    return res.status(500).json({ error: "No se pudo asignar la ventanilla" });
  }
};

