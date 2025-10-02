// controllers/cashierPauseOverview.controller.js
const svc = require('../services/cashierPauseOverview.service');

/**
 * GET /reports/cashier-pauses/overview
 * 
 * Query:
 * - from, to: YYYY-MM-DD (opcionales; si faltan, el service puede usar defaults de “hoy”)
 * - statusType: 'PAUSE' | 'OUT_OF_SERVICE' (default: 'PAUSE')
 * - limitTopUsers: número (default 10)
 * - limitLongest: número (default 20)
 * - includeDetails: '0' | '1'  (default '1')
 * - groupByCashier: '0' | '1'  (default '0')
 * - limitPerCashier: número (default 50; aplica si groupByCashier=1)
 * - includeOpenNowRows: '0' | '1' (default '1')
 */
exports.getOverview = async (req, res, next) => {
  try {
    const {
      from,
      to,
      statusType = 'PAUSE',
      limitTopUsers = '10',
      limitLongest = '20',
      includeDetails = '1',
      groupByCashier = '0',
      limitPerCashier = '50',
      includeOpenNowRows = '1',
    } = req.query;

    const parsed = {
      from: typeof from === 'string' ? from : undefined,
      to: typeof to === 'string' ? to : undefined,
      statusType: statusType === 'OUT_OF_SERVICE' ? 'OUT_OF_SERVICE' : 'PAUSE',
      limitTopUsers: Number.isFinite(Number(limitTopUsers)) ? Number(limitTopUsers) : 10,
      limitLongest: Number.isFinite(Number(limitLongest)) ? Number(limitLongest) : 20,
      includeDetails: includeDetails === '1',
      groupByCashier: groupByCashier === '1',
      limitPerCashier: Number.isFinite(Number(limitPerCashier)) ? Number(limitPerCashier) : 50,
      includeOpenNowRows: includeOpenNowRows !== '0',
    };

    // (Opcional) Forzar rango:
    // if (!parsed.from || !parsed.to) {
    //   return res.status(400).json({ message: "Parámetros 'from' y 'to' son requeridos (YYYY-MM-DD)." });
    // }

    const data = await svc.overview(parsed);
    res.json(data);
  } catch (err) {
    next(err);
  }
};
