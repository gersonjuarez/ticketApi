const { sequelize } = require('./models');

async function addDispatchedByUserColumn() {
  try {
    console.log('Conectando a la base de datos...');
    await sequelize.authenticate();
    console.log('✅ Conexión exitosa');
    
    // Verificar si la columna ya existe
    console.log('Verificando si la columna dispatchedByUser existe...');
    const [results] = await sequelize.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'ticketregistrations' 
      AND COLUMN_NAME = 'dispatchedByUser'
    `);
    
    if (results.length > 0) {
      console.log('✅ La columna dispatchedByUser ya existe');
      return;
    }
    
    console.log('Agregando columna dispatchedByUser...');
    // Agregar la columna
    await sequelize.query(`
      ALTER TABLE ticketregistrations 
      ADD COLUMN dispatchedByUser INT NULL 
      COMMENT 'ID del usuario que despachó el ticket'
    `);
    
    console.log('✅ Columna dispatchedByUser agregada exitosamente');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    try {
      await sequelize.close();
      console.log('Conexión cerrada');
    } catch (e) {
      console.error('Error cerrando conexión:', e.message);
    }
  }
}

console.log('Iniciando script para agregar columna...');
addDispatchedByUserColumn();
