const { pool } = require('../config/db');

async function upsertReturn({ squareReturnId, sourceOrderId, returnedAt, returnMoneyCents }) {
  const result = await pool.query(
    `INSERT INTO square_returns (square_return_id, source_order_id, returned_at, return_money_cents, synced_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (square_return_id) DO UPDATE SET
        source_order_id = EXCLUDED.source_order_id,
        returned_at = EXCLUDED.returned_at,
        return_money_cents = EXCLUDED.return_money_cents,
        synced_at = now()
     RETURNING *`,
    [squareReturnId, sourceOrderId, returnedAt, returnMoneyCents]
  );
  return result.rows[0];
}

module.exports = { upsertReturn };
