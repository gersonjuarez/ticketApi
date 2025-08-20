-- Agregar columna dispatchedByUser a la tabla ticketregistrations
ALTER TABLE ticketregistrations 
ADD COLUMN dispatchedByUser INT NULL 
COMMENT 'ID del usuario que despachó el ticket';

-- Agregar clave foránea (opcional, depende de tu configuración)
-- ALTER TABLE ticketregistrations 
-- ADD FOREIGN KEY (dispatchedByUser) REFERENCES users(idUser);
