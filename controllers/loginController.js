
const db = require("../models");
const bcryptjs = require("bcryptjs");
const User = db.User;
const Op = db.Sequelize.Op;
const sequelize = db.sequelize;



module.exports = {



            async register(req,res){

                const t = await sequelize.transaction();
                console.log("ENTRA PARA REGISTRAR: ",req.body);

                try {
                  const {user,password,idRole,idCashier}=req.body
    
                    let salt = bcryptjs.genSaltSync();
                   const passwordTemp = bcryptjs.hashSync(password, salt);
                    
                    const userr = await User.create(
                        {
                            user,
                            password:passwordTemp,
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

            },

            async login(req,res){

                const t = await sequelize.transaction();

                try {
                    
                    const {user,password}=req.body;
                    const userLogin= await User.findOne(
                        {
                            where:{user:user},
                            attributes:["user","idRole","idCashier","password"]
                        }
                    )

                    if (!userLogin) {
                        return res
                            .status(401)
                            .json({ errors: [{ msg: "Usuario o Contraseña Incorrecto." }] });
                    }
        
                    // Verificar la contraseña
                    const validPassword = bcryptjs.compareSync(
                        password,
                        userLogin.password
                    );
                    if (!validPassword) {
                        return res
                            .status(401)
                            .json({ errors: [{ msg: "Usuario o Contraseña Incorrecto." }] });
                    }

                   return res.send(userLogin);

                } catch (error) {
                    console.log("Valor de error: ",error)
                    res.status(500).json({
                        msg: "Ocurrio un error hable con el administrador",
                    });
                }



            }




}