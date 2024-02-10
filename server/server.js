const express = require("express");
const cors = require("cors");
const { createServer } = require("http");


/* const db = require("../models");
 */
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



  // Rutas de mi aplicación

  this.routes();


 }



 middlewares() {

  // CORS

  this.app.use(cors(corsConfig));

 
  this.app.use(express.json({ limit: "200mb" }));

  this.app.use(express.urlencoded({ limit: "200mb", extended: false }));

 }


 routes() {


 }



 listen() {

  this.server.listen(this.port, () => {

 console.log("Servidor corriendo en puerto", this.port);

  });

 }

}




module.exports = Servidor;