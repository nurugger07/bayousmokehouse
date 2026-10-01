jest.mock('../services/mailer', () => ({
  sendAdminAlert: jest.fn(),
}));

const { pool } = require('../config/db');
const { sendAdminAlert } = require('../services/mailer');
const { runMonthlyTaxReminder, isReminderDay } = require('../services/monthlyTaxReminder');

// pg reads DATE columns back as local-midnight Date objects, not UTC
// midnight, so comparing against `new Date('2026-11-01')` (which parses
// as UTC midnight) is fragile on any machine whose local TZ isn't UTC.
// Reading the column back as text sidesteps that entirely.
async function periodTextFor(jurisdictionId) {
  const result = await pool.query('SELECT period_start::text, period_end::text FROM tax_payments WHERE jurisdiction_id = $1', [
    jurisdictionId,
  ]);
  return result.rows[0];
}

async function seedLocationWithJurisdiction(jurisdictionId, saleDate, totalCents) {
  const location = await pool.query(`INSERT INTO sales_locations (name) VALUES ($1) RETURNING *`, [
    `Bayou Smokehouse @ Test Venue ${saleDate}-${totalCents}`,
  ]);
  await pool.query('INSERT INTO location_tax_jurisdictions (location_id, jurisdiction_id) VALUES ($1, $2)', [
    location.rows[0].id,
    jurisdictionId,
  ]);
  const day = await pool.query(`INSERT INTO sales_days (sale_date, location_id, location_source) VALUES ($1, $2, 'calendar') RETURNING *`, [
    saleDate,
    location.rows[0].id,
  ]);
  await pool.query(
    `INSERT INTO square_orders (square_order_id, sales_day_id, ordered_at, total_money_cents)
     VALUES ($1, $2, now(), $3)`,
    [`sq_${location.rows[0].id}_${saleDate}`, day.rows[0].id, totalCents]
  );
  return location.rows[0];
}

async function createJurisdiction({ name, level, taxRatePercent, schedule }) {
  const result = await pool.query(
    `INSERT INTO tax_jurisdictions (name, level, tax_rate_percent, schedule, day_of_month_due)
     VALUES ($1, $2, $3, $4, 20) RETURNING *`,
    [name, level, taxRatePercent, schedule]
  );
  return result.rows[0];
}

afterEach(async () => {
  jest.clearAllMocks();
  await pool.query(
    'TRUNCATE location_tax_jurisdictions, tax_payments, square_order_line_items, square_orders, sales_days, tax_jurisdictions, sales_locations RESTART IDENTITY CASCADE'
  );
});

afterAll(async () => {
  await pool.end();
});

describe('runMonthlyTaxReminder', () => {
  it('records revenue/estimated tax for a monthly jurisdiction and always includes it in the reminder', async () => {
    const jurisdiction = await createJurisdiction({ name: 'Colorado', level: 'state', taxRatePercent: 2.9, schedule: 'monthly' });
    // No orders whose gross is exactly $1000 needed -- total_money_cents
    // with no tip/tax/discount/service-charge IS the gross sales amount.
    await seedLocationWithJurisdiction(jurisdiction.id, '2026-11-14', 100000);

    const { dueRows } = await runMonthlyTaxReminder(new Date('2026-12-01T18:00:00Z'));

    expect(dueRows).toHaveLength(1);
    expect(dueRows[0].jurisdiction_name).toBe('Colorado');
    expect(dueRows[0].grossSalesCents).toBe(100000);
    expect(dueRows[0].estimatedTaxCents).toBe(2900); // 2.9% of $1000

    const stored = await pool.query('SELECT * FROM tax_payments WHERE jurisdiction_id = $1', [jurisdiction.id]);
    const period = await periodTextFor(jurisdiction.id);
    expect(period.period_start).toBe('2026-11-01');
    expect(period.period_end).toBe('2026-11-30');
    expect(stored.rows[0].reported_revenue_cents).toBe(100000);
    expect(stored.rows[0].estimated_tax_cents).toBe(2900);

    expect(sendAdminAlert).toHaveBeenCalledTimes(1);
    expect(sendAdminAlert.mock.calls[0][0].body).toContain('Colorado');
  });

  it('records a quarterly jurisdiction every month but only reminds in the quarter-ending month', async () => {
    const jurisdiction = await createJurisdiction({
      name: 'Town of Longmont',
      level: 'municipality',
      taxRatePercent: 3.5,
      schedule: 'quarterly',
    });
    await seedLocationWithJurisdiction(jurisdiction.id, '2026-10-10', 50000);

    // Reference month = October (quarter start, not quarter-ending) -- recorded, not reminded.
    const octRun = await runMonthlyTaxReminder(new Date('2026-11-01T18:00:00Z'));
    expect(octRun.dueRows).toHaveLength(0);
    expect(sendAdminAlert).not.toHaveBeenCalled();

    let stored = await pool.query('SELECT * FROM tax_payments WHERE jurisdiction_id = $1', [jurisdiction.id]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].reported_revenue_cents).toBe(50000);
    let period = await periodTextFor(jurisdiction.id);
    expect(period.period_start).toBe('2026-10-01');
    expect(period.period_end).toBe('2026-12-31');

    // More revenue in November, same quarter.
    await seedLocationWithJurisdiction(jurisdiction.id, '2026-11-20', 30000);

    // Reference month = December (quarter-ending) -- now reminded, and
    // the SAME row (same period) accumulates both months' revenue.
    const decRun = await runMonthlyTaxReminder(new Date('2027-01-01T18:00:00Z'));
    expect(decRun.dueRows).toHaveLength(1);
    expect(decRun.dueRows[0].grossSalesCents).toBe(80000);
    expect(sendAdminAlert).toHaveBeenCalledTimes(1);

    stored = await pool.query('SELECT * FROM tax_payments WHERE jurisdiction_id = $1', [jurisdiction.id]);
    expect(stored.rows).toHaveLength(1); // still one row, not two
    expect(stored.rows[0].reported_revenue_cents).toBe(80000);
    expect(stored.rows[0].estimated_tax_cents).toBe(2800); // 3.5% of $800
  });

  it('never overwrites an already-recorded payment, only the revenue/estimate fields', async () => {
    const jurisdiction = await createJurisdiction({ name: 'Colorado', level: 'state', taxRatePercent: 2.9, schedule: 'monthly' });
    await seedLocationWithJurisdiction(jurisdiction.id, '2026-11-14', 100000);

    await pool.query(
      `INSERT INTO tax_payments (jurisdiction_id, period_start, period_end, amount_paid_cents, paid_date, notes)
       VALUES ($1, '2026-11-01', '2026-11-30', 2900, '2026-12-15', 'Paid early')`,
      [jurisdiction.id]
    );

    await runMonthlyTaxReminder(new Date('2026-12-01T18:00:00Z'));

    const stored = await pool.query('SELECT * FROM tax_payments WHERE jurisdiction_id = $1', [jurisdiction.id]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].amount_paid_cents).toBe(2900);
    expect(stored.rows[0].notes).toBe('Paid early');
    expect(stored.rows[0].reported_revenue_cents).toBe(100000);
  });

  it('sends no email when there are no jurisdictions at all', async () => {
    const { dueRows } = await runMonthlyTaxReminder(new Date('2026-12-01T18:00:00Z'));
    expect(dueRows).toHaveLength(0);
    expect(sendAdminAlert).not.toHaveBeenCalled();
  });
});

describe('isReminderDay', () => {
  it("matches the target day in America/Denver, not the server's local timezone", () => {
    // 2026-12-01T05:00:00Z is still Nov 30 in Denver (MST, UTC-7) but
    // already Dec 1 in UTC -- this only passes if the check uses
    // America/Denver's calendar date, not the raw UTC date.
    const lateUtcButStillPriorDayInDenver = new Date('2026-12-01T05:00:00Z');
    expect(isReminderDay(30, lateUtcButStillPriorDayInDenver)).toBe(true);
    expect(isReminderDay(1, lateUtcButStillPriorDayInDenver)).toBe(false);
  });

  it('matches day 1 on the 1st of the month in Denver', () => {
    const firstOfMonthInDenver = new Date('2026-12-01T15:00:00Z'); // 8am MST
    expect(isReminderDay(1, firstOfMonthInDenver)).toBe(true);
  });

  it('does not match any other day', () => {
    const fifteenthInDenver = new Date('2026-12-15T15:00:00Z');
    expect(isReminderDay(1, fifteenthInDenver)).toBe(false);
  });
});
