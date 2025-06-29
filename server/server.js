const express = require("express");
const cors = require("cors");
const { createServer } = require("http");
const db = require("../models");
const user = require("../routes/auth.routes.js");
const ticketRegistrationRoutes = require("../routes/ticketRegistration.routes");
const ticketStatusRoutes = require("../routes/ticketStatus.routes");
const clientRoutes = require("../routes/client.routes");
const serviceRoutes = require("../routes/service.routes");
const cashierRoutes = require("../routes/cashier.routes");

/* const db = require("../models");
 */
// configuracion de cors para definir que peticiones permitira la api y el origen al cual rendirle los datos
const corsConfig = {

/*     methods: ['GET','POST','DELETE','UPDATE','PUT','PATCH'],

 */ origin: "*",

 credentials: false,

};




class Servidor {

 constructor() {

  this.app = express();

  this.port = process.env.PORT;

  this.paths = {

   route: "/api",

  };

  this.server = createServer(this.app);

  this.middlewares();

   this.routes();




 }



 middlewares() {

  // CORS

  this.app.use(cors({

   origin: "*",
    
    
    }));

 
  this.app.use(express.json({ limit: "200mb" }));

  this.app.use(express.urlencoded({ limit: "200mb", extended: false }));

 }


    routes() {
      this.app.use(this.paths.route,user);
    this.app.use(this.paths.route, ticketRegistrationRoutes);
    this.app.use(this.paths.route, ticketStatusRoutes);
    this.app.use(this.paths.route, clientRoutes);
    this.app.use(this.paths.route, serviceRoutes);
    this.app.use(this.paths.route, cashierRoutes);

    }



 listen() {

  this.server.listen(this.port, () => {
    db.sequelize.sync();
 console.log("Servidor corriendo en puerto", this.port);

  });

 }

}




module.exports = Servidor;