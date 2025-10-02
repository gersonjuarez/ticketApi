// models/tv_media.js
const { Model } = require('sequelize');

// Mantén youtube para compatibilidad con datos viejos,
// pero el backend NO lo devuelve en endpoints (ver ALLOWED_TYPES en controller).
const TYPES = ['youtube', 'image', 'video', 'presentation'];

module.exports = (sequelize, DataTypes) => {
  class TvMedia extends Model {
    static associate(_models) {
      // Sin asociaciones por ahora
    }
  }

  TvMedia.init(
    {
      idMedia: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER,
      },

      /**
       * Tipos soportados:
       * - image:        imagen fija (PNG/JPG/GIF/WebP)
       * - video:        archivo de video (MP4, etc.)
       * - presentation: PDF/PPTX/Slides embebibles (iframe)
       * - youtube:      legado (NO USAR), se mantiene por compatibilidad
       */
      type: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: {
          isIn: [TYPES],
        },
      },

      /** Título visible (opcional) */
      title: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },

      /** Texto que va debajo (editable) */
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      /**
       * URL del recurso:
       *  - image:        URL pública de imagen
       *  - video:        URL pública del mp4 u otro contenedor
       *  - presentation: URL embebible (PDF/PPTX/Slides)
       *  - youtube:      (legado) URL de YouTube
       */
      url: {
        type: DataTypes.STRING(1024),
        allowNull: false,
      },

      /** Miniatura opcional (para el panel admin) */
      thumbUrl: {
        type: DataTypes.STRING(1024),
        allowNull: true,
      },

      /** Duración sugerida (segundos) para rotación de image/presentation */
      durationSec: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 30,
        validate: { min: 3, max: 600 },
      },

      /** Activo o no */
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      /** Orden en playlist */
      orderIndex: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      /** Ventana de vigencia opcional */
      startAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      endAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'TvMedia',
      tableName: 'tv_media',
      timestamps: true,
      underscored: false,
      freezeTableName: true,
      indexes: [
        { fields: ['isActive'] },
        { fields: ['orderIndex'] },
        { fields: ['type'] },
        { fields: ['startAt'] },
        { fields: ['endAt'] },
      ],
    }
  );

  TvMedia.TYPES = TYPES;
  return TvMedia;
};
