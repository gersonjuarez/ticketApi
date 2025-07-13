let io;
module.exports = {
  init: (httpServer) => {
    const Server = require('socket.io').Server;
    io = new Server(httpServer, { cors: { origin: '*' } });
    io.on('connection', (socket) => {
      console.log('Cliente conectado', socket.id);
      socket.on('join', (room) => {
        console.log(`Socket ${socket.id} joined room '${room}'`);
        socket.join(room);
      });
    });
    return io;
  },
  getIo: () => {
    if (!io) throw new Error('Socket.IO no inicializado');
    return io;
  }
};
