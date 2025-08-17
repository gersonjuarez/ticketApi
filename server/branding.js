// server/branding.js
const fs = require('fs');
const path = require('path');

let branding = {
  header: 'SISTEMA DE TURNOS',
  footer: 'Gracias por su visita',
  logoBase64: null,
  logoMime: 'image/png',
};

function loadBranding() {
  const logoPath = path.join(__dirname,'..', 'assets', 'LOGOTIPO.png');
  if (fs.existsSync(logoPath)) {
    const file = fs.readFileSync(logoPath);
    branding.logoBase64 = file.toString('base64');
  } else {
    console.warn('[branding] No se encontró assets/LOGOTIPO.png');
  }
}

function getBranding() {
  return branding;
}

module.exports = { loadBranding, getBranding };
