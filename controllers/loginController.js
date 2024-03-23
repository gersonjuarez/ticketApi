
const db = require("../models");
const bcryptjs = require("bcryptjs");
const User = db.User;
const Op = db.Sequelize.Op;
const sequelize = db.sequelize;



module.exports = {



            async login(req,res){

                const t = await sequelize.transaction();
                console.log("ENTRA PARA REGISTRAR: ",req.body);

                try {
                    return
                    let user="Mario";
                    let password="Prueba123";
                    let idRole=1;
                    let idCashier=1;
                    let salt = bcryptjs.genSaltSync();
                    password = bcryptjs.hashSync(password, salt);
                    
                    const userr = await User.create(
                        {
                            user,
                            password,
                            idRole,
                            idCashier
                        },
                        { transaction: t }
                    );

                    await t.commit();

                    res.status(200).json("Usuario registrado")
                
                } catch (error) {
                    console.log("error: " + error);

                    await t.rollback();
                    res.status(400).json({ error: error});
                }

            }




}