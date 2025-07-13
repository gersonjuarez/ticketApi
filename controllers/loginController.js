
const { Model } = require("sequelize");
const db = require("../models");
const bcryptjs = require("bcryptjs");
const User = db.User;
const Service = db.Service;
const Cashier = db.Cashier;
const Op = db.Sequelize.Op;
const sequelize = db.sequelize;



module.exports = {



            async register(req,res){

                const t = await sequelize.transaction();
                console.log("ENTRA PARA REGISTRAR: ",req.body);

                try {
                  const {userName,password,idRole,idCashier,email,fullName}=req.body
    
                    let salt = bcryptjs.genSaltSync();
                   const passwordTemp = bcryptjs.hashSync(password, salt);
                    
                    const userr = await User.create(
                        {
                            username:userName,
                            email,
                            fullName,
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
                    console.log("ENTRA PARA LOGEAR: ",req.body);
                    const {user,password}=req.body;
                    const userLogin= await User.findOne(
                        {
                            where:[
                                {username:user},
                                { status:true}],
                            include:[
                                {
                                    model: Cashier,
                                    attributes: ["idCashier", "name"],
                                    include: [
                                        {
                                            model: Service,
                                            attributes: ["idService", "name", "prefix"]
                                        }
                                    ]
                                },
                                
                            ],
                            attributes:["username","idRole","idCashier","password","email","fullName","status"],
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

                    return res.send({
                        username: userLogin.username,
                        fullName: userLogin.fullName,
                        email: userLogin.email,
                        idRole: userLogin.idRole,
                        idCashier: userLogin.idCashier,
                        status: userLogin.status,
                        cashier: {
                            idCashier: userLogin.Cashier.idCashier,
                            name: userLogin.Cashier.name,
                            service: {
                                idService: userLogin.Cashier.Service.idService,
                                name: userLogin.Cashier.Service.name,
                                prefix: userLogin.Cashier.Service.prefix
                            }
                        }
                    });

                } catch (error) {
                    console.log("Valor de error: ",error)
                    res.status(500).json({
                        msg: "Ocurrio un error hable con el administrador",
                    });
                }



            }




}