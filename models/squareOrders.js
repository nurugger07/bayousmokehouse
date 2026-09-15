const { pool } = require('../config/db');

async function upsertOrder({
  squareOrderId,
  salesDayId,
  orderedAt,
  subtotalMoneyCents,
  taxMoneyCents,
  tipMoneyCents,
  totalMoneyCents,
}) {
  const result = await pool.query(
    `INSERT INTO square_orders
        (square_order_id, sales_day_id, ordered_at, subtotal_money_cents, tax_money_cents, tip_money_cents, total_money_cents, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (square_order_id) DO UPDATE SET
        sales_day_id = EXCLUDED.sales_day_id,
        ordered_at = EXCLUDED.ordered_at,
        subtotal_money_cents = EXCLUDED.subtotal_money_cents,
        tax_money_cents = EXCLUDED.tax_money_cents,
        tip_money_cents = EXCLUDED.tip_money_cents,
        total_money_cents = EXCLUDED.total_money_cents,
        synced_at = now()
     RETURNING *`,
    [squareOrderId, salesDayId, orderedAt, subtotalMoneyCents, taxMoneyCents, tipMoneyCents, totalMoneyCents]
  );
  return result.rows[0];
}

// Replace-all rather than diffing — Square line items have no stable
// key we can rely on across re-syncs, and a full replace on every
// upsert is simple and always correct.
async function replaceLineItems(squareOrderId, items) {
  await pool.query('DELETE FROM square_order_line_items WHERE square_order_id = $1', [squareOrderId]);

  for (const item of items) {
    await pool.query(
      `INSERT INTO square_order_line_items (square_order_id, name, quantity, total_money_cents)
       VALUES ($1, $2, $3, $4)`,
      [squareOrderId, item.name, item.quantity, item.totalMoneyCents]
    );
  }
}

module.exports = { upsertOrder, replaceLineItems };
