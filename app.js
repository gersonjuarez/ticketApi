require("dotenv").config();
const Servidor = require("./server/server"); 

const server = new Servidor();
server.listen();
