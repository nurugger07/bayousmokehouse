const { pool } = require('../config/db');

async function listPaymentsForJurisdiction(jurisdictionId) {
  const result = await pool.query('SELECT * FROM tax_payments WHERE jurisdiction_id = $1 ORDER BY period_start DESC', [jurisdictionId]);
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

// Used by the monthly job to record/refresh a period's revenue and
// estimated tax. On conflict (same jurisdiction + period already has a
// row), only those two columns are touched — amount_paid_cents,
// paid_date, receipt_drive_url, and notes are left exactly as Johnny
// entered them, whether that happened before or after this runs.
async function upsertRevenueEstimate(jurisdictionId, { periodStart, periodEnd, reportedRevenueCents, estimatedTaxCents }) {
  const result = await pool.query(
    `INSERT INTO tax_payments (jurisdiction_id, period_start, period_end, reported_revenue_cents, estimated_tax_cents)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (jurisdiction_id, period_start, period_end) DO UPDATE SET
        reported_revenue_cents = EXCLUDED.reported_revenue_cents,
        estimated_tax_cents = EXCLUDED.estimated_tax_cents,
        updated_at = now()
     RETURNING *`,
    [jurisdictionId, periodStart, periodEnd, reportedRevenueCents, estimatedTaxCents]
  );
  return result.rows[0];
}

module.exports = {
  listPaymentsForJurisdiction,
  createPayment,
  upsertRevenueEstimate,
};
