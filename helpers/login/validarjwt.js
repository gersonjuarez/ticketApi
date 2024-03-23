const db = require("../../models");
const Usuario = db.usuarios;
const jwt = require("jsonwebtoken");

verifyToken = async (req, res, next) => {
    console.log(
        "en validacion: " + JSON.stringify(req.headers["authorization"])
    );
    /*     const token = req.headers["authorization"];
     */
    let token = req.headers["x-access-token"] || req.headers["authorization"];

    if (!token || token === "undefined") {
        return res
            .status(401)
            .json({ errors: [{ msg: "Usuario No Autorizado." }] });
    }
    try {
        const { uid } = jwt.verify(token, process.env.SECRETORPRIVATEKEY);
        console.log("UID:" + uid);
        const usuario = await Usuario.findByPk(uid);
        console.log("USUARIO:" + JSON.stringify(usuario));
        // Usuario existente
        if (!usuario) {
            return res
                .status(401)
                .json({ errors: [{ msg: "Token inválido." }] });
        }
        // USUARIO ACTIVO
        if (!usuario.estado_aprobacion) {
            return res
                .status(401)
                .json({ errors: [{ msg: "Token inválido." }] });
        }
        // aunque el token sea valido, verificamos si el usuario existe y si esta activo
        // de lo contrario no pasas la peticion
        req.user = usuario;

        next();
    } catch (err) {
        console.log("dentro de errr: " + err);
        return res.status(401).json({ errors: [{ msg: "Token inválido." }] });
    }
};
module.exports = verifyToken;
