const db = require("../../models");

const jwt = require("jsonwebtoken");
const { response, request } = require("express");

const Usuario = db.usuarios;
const generarJWT = (uid = "") => {
    return new Promise((resolve, reject) => {
        const payload = { uid };

        jwt.sign(
            payload,
            process.env.SECRETORPRIVATEKEY,
            {
                expiresIn: "9h",
            },
            (err, token) => {
                if (err) {
                    console.log(err);
                    // eslint-disable-next-line prefer-promise-reject-errors
                    reject("No se pudo generar el token");
                } else {
                    resolve(token);
                }
            }
        );
    });
};

module.exports = {
    generarJWT,
};
