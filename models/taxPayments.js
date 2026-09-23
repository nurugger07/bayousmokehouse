const { pool } = require('../config/db');

async function listPaymentsForJurisdiction(jurisdictionId) {
  const result = await pool.query(
    'SELECT * FROM tax_payments WHERE jurisdiction_id = $1 ORDER BY period_start DESC',
    [jurisdictionId]
  );
  return result.rows;
}

async function createPayment(jurisdictionId, fields) {
  const result = await pool.query(
    `INSERT INTO tax_payments
        (jurisdiction_id, period_start, period_end, reported_revenue_cents,
         estimated_tax_cents, amount_paid_cents, paid_date, receipt_drive_url, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      jurisdictionId,
      fields.periodStart,
      fields.periodEnd,
      fields.reportedRevenueCents,
      fields.estimatedTaxCents,
      fields.amountPaidCents,
      fields.paidDate || null,
      fields.receiptDriveUrl || null,
      fields.notes || null,
    ]
  );
  return result.rows[0];
}

module.exports = {
  listPaymentsForJurisdiction,
  createPayment,
};
