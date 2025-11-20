// controllers/cashierPauseOverview.controller.js
const svc = require('../services/cashierPauseOverview.service');

/**
 * GET /reports/cashier-pauses/overview
 *
 * Query params:
 * - from, to: YYYY-MM-DD (opcionales)
 * - statusType: 'PAUSE' | 'OUT_OF_SERVICE'
 * - limitTopUsers: número (default 10)
 * - limitLongest: número (default 20)
 * - pageLongest: número (default 1)      👈 NUEVO
 * - includeDetails: '0' | '1'  (default '1')
 * - groupByCashier: '0' | '1'  (default '0')
 * - limitPerCashier: number (default 50)
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
      pageLongest = '1',              // 👈 NUEVO
      includeDetails = '1',
      groupByCashier = '0',
      limitPerCashier = '50',
      includeOpenNowRows = '1',
    } = req.query;

    /** =========================
     * PARSE & VALIDACIÓN
     * ========================= */
    const parsed = {
      from: typeof from === 'string' ? from : undefined,
      to: typeof to === 'string' ? to : undefined,

      statusType: statusType === 'OUT_OF_SERVICE' ? 'OUT_OF_SERVICE' : 'PAUSE',

      limitTopUsers:
        Number.isFinite(Number(limitTopUsers))
          ? Number(limitTopUsers)
          : 10,

      limitLongest:
        Number.isFinite(Number(limitLongest))
          ? Number(limitLongest)
          : 20,

      pageLongest:
        Number.isFinite(Number(pageLongest))
          ? Number(pageLongest)
          : 1, // 👈 DEFAULT page 1

      includeDetails: includeDetails === '1',

      groupByCashier: groupByCashier === '1',

      limitPerCashier:
        Number.isFinite(Number(limitPerCashier))
          ? Number(limitPerCashier)
          : 50,

      includeOpenNowRows: includeOpenNowRows !== '0',
    };

    /** =========================
     * LLAMADA AL SERVICIO
     * ========================= */
    const data = await svc.overview(parsed);

    return res.json(data);
  } catch (err) {
    console.error('Error en cashierPauseOverview.controller:', err);
    next(err);
  }
};
