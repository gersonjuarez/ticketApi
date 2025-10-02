// scripts/createUsers.js
"use strict";

const bcrypt = require("bcryptjs");
const path = require("path");

// Ajusta si tu entrypoint de modelos está en otra ruta
const db = require(path.join(__dirname, "..", "models"));

async function main() {
  const t = await db.sequelize.transaction();
  try {
    // --- Parámetros (puedes sobreescribir por env o args) ---
    const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
    const ADMIN_FULLNAME = process.env.ADMIN_FULLNAME || "Administrador General";
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@demo.com";

    const CAJERO_USERNAME = process.env.CAJERO_USERNAME || "cajero1";
    const CAJERO_PASSWORD = process.env.CAJERO_PASSWORD || "cajero123";
    const CAJERO_FULLNAME = process.env.CAJERO_FULLNAME || "Usuario Cajero";
    const CAJERO_EMAIL = process.env.CAJERO_EMAIL || "cajero@demo.com";

    // --- Buscar o crear roles ---
    let adminRole = await db.Role.findOne({ where: { name: "Admin" }, transaction: t });
    if (!adminRole) {
      adminRole = await db.Role.create({ name: "Admin", status: true, isCashier: false }, { transaction: t });
      console.log("Rol 'Admin' creado:", adminRole.idRole);
    } else {
      console.log("Rol 'Admin' existe:", adminRole.idRole);
    }

    let cajeroRole = await db.Role.findOne({ where: { name: "Cajero" }, transaction: t });
    if (!cajeroRole) {
      cajeroRole = await db.Role.create({ name: "Cajero", status: true, isCashier: true }, { transaction: t });
      console.log("Rol 'Cajero' creado:", cajeroRole.idRole);
    } else {
      // Asegurar bandera isCashier = true
      if (!cajeroRole.isCashier) {
        cajeroRole.isCashier = true;
        await cajeroRole.save({ transaction: t });
        console.log("Rol 'Cajero' actualizado: isCashier = true");
      } else {
        console.log("Rol 'Cajero' existe:", cajeroRole.idRole);
      }
    }

    // --- Buscar o crear un cajero (cashier) para asociar al usuario cajero ---
    let cashier = await db.Cashier.findOne({ transaction: t });
    if (!cashier) {
      cashier = await db.Cashier.create(
        { name: "Caja por defecto", idService: null, description: "Caja creada automáticamente para seeder", status: true },
        { transaction: t }
      );
      console.log("Cashier por defecto creado:", cashier.idCashier);
    } else {
      console.log("Usando cashier existente:", cashier.idCashier);
    }

    // --- Hashear contraseñas ---
    const hashedAdmin = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const hashedCajero = await bcrypt.hash(CAJERO_PASSWORD, 10);

    // --- Crear o actualizar usuario Admin (idempotente por username) ---
    let adminUser = await db.User.findOne({ where: { username: ADMIN_USERNAME }, transaction: t });
    if (!adminUser) {
      adminUser = await db.User.create({
        username: ADMIN_USERNAME,
        password: hashedAdmin,
        fullName: ADMIN_FULLNAME,
        email: ADMIN_EMAIL,
        status: true,
        idRole: adminRole.idRole,
        idCashier: null,
      }, { transaction: t });
      console.log("Usuario 'admin' creado (idUser):", adminUser.idUser);
    } else {
      // Opcional: actualizar password/email/fullName si quieres forzar
      let changed = false;
      if (adminUser.password !== hashedAdmin) { adminUser.password = hashedAdmin; changed = true; }
      if (adminUser.email !== ADMIN_EMAIL) { adminUser.email = ADMIN_EMAIL; changed = true; }
      if (adminUser.fullName !== ADMIN_FULLNAME) { adminUser.fullName = ADMIN_FULLNAME; changed = true; }
      if (adminUser.idRole !== adminRole.idRole) { adminUser.idRole = adminRole.idRole; changed = true; }
      if (changed) {
        await adminUser.save({ transaction: t });
        console.log("Usuario 'admin' actualizado.");
      } else {
        console.log("Usuario 'admin' ya existe y sin cambios.");
      }
    }

    // --- Crear o actualizar usuario Cajero ---
    let cajeroUser = await db.User.findOne({ where: { username: CAJERO_USERNAME }, transaction: t });
    if (!cajeroUser) {
      cajeroUser = await db.User.create({
        username: CAJERO_USERNAME,
        password: hashedCajero,
        fullName: CAJERO_FULLNAME,
        email: CAJERO_EMAIL,
        status: true,
        idRole: cajeroRole.idRole,
        idCashier: cashier.idCashier,
      }, { transaction: t });
      console.log("Usuario 'cajero1' creado (idUser):", cajeroUser.idUser);
    } else {
      let changed = false;
      if (cajeroUser.password !== hashedCajero) { cajeroUser.password = hashedCajero; changed = true; }
      if (cajeroUser.email !== CAJERO_EMAIL) { cajeroUser.email = CAJERO_EMAIL; changed = true; }
      if (cajeroUser.fullName !== CAJERO_FULLNAME) { cajeroUser.fullName = CAJERO_FULLNAME; changed = true; }
      if (cajeroUser.idRole !== cajeroRole.idRole) { cajeroUser.idRole = cajeroRole.idRole; changed = true; }
      if (cajeroUser.idCashier !== cashier.idCashier) { cajeroUser.idCashier = cashier.idCashier; changed = true; }
      if (changed) {
        await cajeroUser.save({ transaction: t });
        console.log("Usuario 'cajero1' actualizado.");
      } else {
        console.log("Usuario 'cajero1' ya existe y sin cambios.");
      }
    }

    await t.commit();
    console.log("Seed de usuarios completada correctamente.");
    process.exit(0);
  } catch (err) {
    await t.rollback();
    console.error("Error creando usuarios:", err);
    process.exit(1);
  }
}

main();
