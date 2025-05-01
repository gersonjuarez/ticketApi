const { Router } = require("express");

const router = Router();

const loginController = require("../controllers/loginController.js");


router.post("/register",loginController.register);
router.get("/login",loginController.login);


module.exports = router;
