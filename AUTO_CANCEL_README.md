# 🕐 Sistema de Auto-Cancelación de Tickets

## 📋 Descripción

Este sistema cancela automáticamente todos los tickets pendientes (status = 1) que no han sido atendidos a las **7:00 PM hora de Guatemala** todos los días.

## ✨ Características

- ✅ **Automático**: Se ejecuta sin intervención manual
- ✅ **Zona horaria correcta**: Usa `America/Guatemala` 
- ✅ **Eventos Socket.IO**: Notifica en tiempo real a todas las pantallas (cajeros, TVs, admin)
- ✅ **Sin afectar lógica**: Solo cambia tickets pendientes, no toca atención ni completados
- ✅ **Logs detallados**: Registra todo en Winston logger
- ✅ **Endpoint de prueba**: Puedes probar manualmente

## 🚀 ¿Cómo funciona?

### 1. Cron Job
Se ejecuta a las **19:00 (7 PM)** cada día usando `node-cron`:

```javascript
// services/autoCancelTickets.service.js
cron.schedule("0 19 * * *", async () => {
  await cancelPendingTickets();
}, {
  timezone: "America/Guatemala"
});
```

### 2. Proceso de Cancelación

1. Busca todos los tickets con:
   - `idTicketStatus = 1` (PENDIENTE)
   - `status = true` (activos)

2. Los actualiza a:
   - `idTicketStatus = 4` (CANCELADO)
   - `observations = "Cancelado automáticamente al cierre del día"`

3. Emite eventos Socket.IO:
   - A cada room de servicio (prefix)
   - A la room "tv"
   - Evento global `tickets-auto-cancelled`

### 3. Notificaciones en Tiempo Real

Cuando se cancela un ticket, se emite:

```javascript
// Para cada ticket
io.to(serviceRoom).emit("ticket-cancelled", {
  idTicketRegistration: ticketId
});

io.to("tv").emit("ticket-cancelled", {
  idTicketRegistration: ticketId
});

// Evento general
io.emit("tickets-auto-cancelled", {
  count: 10,
  timestamp: "2025-11-25T19:00:00",
  reason: "auto-cancel-end-of-day"
});
```

## 🧪 Probar Manualmente

Puedes ejecutar la cancelación manualmente con:

### Desde Postman/Insomnia:
```
POST http://localhost:3001/api/tickets/auto-cancel
```

### Desde el navegador:
```bash
curl -X POST http://localhost:3001/api/tickets/auto-cancel
```

### Respuesta:
```json
{
  "ok": true,
  "message": "5 tickets cancelados automáticamente",
  "cancelled": 5,
  "tickets": [
    {
      "id": 123,
      "correlativo": "A-001",
      "service": "Atención General"
    },
    ...
  ]
}
```

## ⚙️ Configuración

### Zona Horaria del Servidor

El cron está configurado con `timezone: "America/Guatemala"`, por lo que **siempre se ejecutará a las 7 PM hora de Guatemala** sin importar dónde esté el servidor.

Si tu servidor está en **UTC** (Render, Heroku), el cron se encarga de la conversión automáticamente.

### Cambiar la Hora

Si quieres cambiar la hora de ejecución, edita `services/autoCancelTickets.service.js`:

```javascript
// Expresión cron: "minuto hora * * *"
const schedule = "0 19 * * *"; // 7:00 PM

// Ejemplos:
// "0 20 * * *"  -> 8:00 PM
// "30 18 * * *" -> 6:30 PM
// "0 22 * * 1-5" -> 10:00 PM solo lunes a viernes
```

## 📊 Logs

Todos los logs se registran en Winston:

```
✅ [AUTO-CANCEL] Cron job inicializado: 0 19 * * * (America/Guatemala)
⏰ [AUTO-CANCEL] Cron job ejecutándose...
🕐 [AUTO-CANCEL] Iniciando cancelación automática a las 2025-11-25 19:00:00
✅ [AUTO-CANCEL] 5 tickets cancelados automáticamente
📡 [AUTO-CANCEL] Eventos Socket.IO emitidos
```

## 🔒 Seguridad

- ✅ Solo afecta tickets con `idTicketStatus = 1` (PENDIENTE)
- ✅ No toca tickets en atención (status 2)
- ✅ No afecta tickets ya completados o cancelados
- ✅ Registra auditoría completa en logs
- ✅ Actualiza `observations` para trazabilidad

## 🛠️ Archivos Modificados

```
ticketApi/
├── services/
│   └── autoCancelTickets.service.js    ⬅️ NUEVO: Lógica del cron
├── routes/
│   └── autoCancelTickets.routes.js     ⬅️ NUEVO: Endpoint de prueba
├── server/
│   └── server.js                       ⬅️ MODIFICADO: Inicia el cron
├── controllers/
│   └── ticketRegistration.controller.js ⬅️ MODIFICADO: Fix payload
└── package.json                        ⬅️ MODIFICADO: +node-cron
```

## 🚀 Deployment en Producción

1. **Hacer commit de los cambios:**
   ```bash
   git add .
   git commit -m "feat: auto-cancel pending tickets at 7 PM Guatemala time"
   git push
   ```

2. **Render detectará los cambios** y hará redeploy automático

3. **Verificar en los logs** que el cron se inicializó:
   ```
   ✅ [AUTO-CANCEL] Cron job inicializado: 0 19 * * * (America/Guatemala)
   ```

4. **Esperar a las 7 PM** o usar el endpoint de prueba

## ❓ FAQ

### ¿Y si no hay tickets pendientes?
Se registra en logs: `✅ [AUTO-CANCEL] No hay tickets pendientes para cancelar`

### ¿Afecta tickets en atención?
No, solo cancela tickets con `idTicketStatus = 1` (PENDIENTE)

### ¿Puedo desactivarlo temporalmente?
Sí, comenta la línea en `server/server.js`:
```javascript
// initAutoCancelCron(); // ⬅️ Comentar para desactivar
```

### ¿Funciona en local y producción?
Sí, funciona en ambos. La zona horaria `America/Guatemala` se maneja automáticamente.

## 📝 Notas Finales

- El cron usa **node-cron** v3.0.3
- La zona horaria es **America/Guatemala** (UTC-6)
- Los eventos Socket.IO mantienen sincronizadas todas las pantallas
- Los logs se guardan en Winston para auditoría completa
