const request = require('supertest');
const app = require('../app');
const { pool } = require('../config/db');

const CORRECT_PASSWORD = process.env.ADMIN_TEST_PASSWORD;

async function loggedInAgent() {
  const agent = request.agent(app);
  await agent.post('/admin/login').type('form').send({ password: CORRECT_PASSWORD });
  return agent;
}

async function seedOneVisitWithAnOrder() {
  const location = await pool.query(
    "INSERT INTO sales_locations (name) VALUES ('Bayou Smokehouse @ Berthoud Brewery') RETURNING *"
  );
  const day = await pool.query(
    `INSERT INTO sales_days (sale_date, location_id, location_source, calendar_event_summary)
     VALUES ('2026-08-14', $1, 'calendar', $2) RETURNING *`,
    [location.rows[0].id, location.rows[0].name]
  );
  await pool.query(
    `INSERT INTO square_orders (square_order_id, sales_day_id, ordered_at, subtotal_money_cents, tax_money_cents, tip_money_cents, total_money_cents)
     VALUES ('sq_test_order', $1, now(), 2000, 200, 300, 2500) RETURNING id`,
    [day.rows[0].id]
  );
  return { location: location.rows[0], day: day.rows[0] };
}

afterEach(async () => {
  await pool.query('TRUNCATE square_order_line_items, square_orders, sales_days, sales_locations RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await pool.end();
});

describe('admin sales report auth', () => {
  it('redirects unauthenticated requests to the login page', async () => {
    const res = await request(app).get('/admin/sales/totals');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/admin/login');
  });
});

describe('admin sales reports', () => {
  it('shows sales totals for the seeded visit, filtered to its date', async () => {
    const { location } = await seedOneVisitWithAnOrder();
    const agent = await loggedInAgent();

    const res = await agent.get('/admin/sales/totals?startDate=2026-08-14&endDate=2026-08-14');

    expect(res.status).toBe(200);
    expect(res.text).toContain(location.name);
    expect(res.text).toContain('$25.00');
    expect(res.text).toContain('data-sortable'); // column sorting wired up
  });

  it('shows item sales, tax totals, and tip totals for the same visit', async () => {
    const { location } = await seedOneVisitWithAnOrder();
    await pool.query(
      "INSERT INTO square_order_line_items (square_order_id, name, quantity, total_money_cents) SELECT id, 'Pork Belly Sliders', 2, 2500 FROM square_orders WHERE square_order_id = 'sq_test_order'"
    );
    const agent = await loggedInAgent();

    const items = await agent.get('/admin/sales/items?startDate=2026-08-14&endDate=2026-08-14');
    expect(items.text).toContain('Pork Belly Sliders');

    const tax = await agent.get('/admin/sales/tax?startDate=2026-08-14&endDate=2026-08-14');
    expect(tax.text).toContain('$2.00');

    const tips = await agent.get('/admin/sales/tips?startDate=2026-08-14&endDate=2026-08-14');
    expect(tips.text).toContain('$3.00');
    expect([items.status, tax.status, tips.status]).toEqual([200, 200, 200]);
    expect(location.name).toBeTruthy(); // sanity — location exists for the filter dropdown
  });

  it('filters out a location\'s visit when the date range excludes it', async () => {
    await seedOneVisitWithAnOrder();
    const agent = await loggedInAgent();

    const res = await agent.get('/admin/sales/totals?startDate=2026-01-01&endDate=2026-01-31');

    expect(res.status).toBe(200);
    expect(res.text).toContain('No sales in this range');
  });

  it('shows the weekly totals report, grouped by month', async () => {
    // Weekly totals filters on square_orders.ordered_at directly (it's
    // not location-based), so this needs an explicit in-range timestamp
    // rather than seedOneVisitWithAnOrder's now().
    const { day } = await seedOneVisitWithAnOrder();
    await pool.query(
      `INSERT INTO square_orders (square_order_id, sales_day_id, ordered_at, subtotal_money_cents, tax_money_cents, tip_money_cents, total_money_cents)
       VALUES ('sq_weekly_test_order', $1, '2026-08-03T18:00:00Z', 2000, 80, 0, 2080)`,
      [day.id]
    );
    const agent = await loggedInAgent();

    const res = await agent.get('/admin/sales/weekly?startDate=2026-08-01&endDate=2026-08-31');

    expect(res.status).toBe(200);
    expect(res.text).toContain('August');
    expect(res.text).toContain('$20.00');
  });
});

describe('admin manage locations', () => {
  it('re-parses a pasted full address into city/state', async () => {
    const location = await pool.query("INSERT INTO sales_locations (name) VALUES ('Bayou Smokehouse @ Test Venue') RETURNING *");
    const agent = await loggedInAgent();

    await agent
      .post(`/admin/sales/locations/${location.rows[0].id}/city-state`)
      .type('form')
      .send({ cityState: '123 Main St, Loveland, CO 80537, USA' });

    const updated = await pool.query('SELECT city_state FROM sales_locations WHERE id = $1', [location.rows[0].id]);
    expect(updated.rows[0].city_state).toBe('Loveland, CO');

    const res = await agent.get('/admin/sales/locations');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Loveland, CO');
  });

  it('accepts an already-clean "City, ST" value directly, unchanged', async () => {
    const location = await pool.query("INSERT INTO sales_locations (name) VALUES ('Bayou Smokehouse @ Another Venue') RETURNING *");
    const agent = await loggedInAgent();

    await agent.post(`/admin/sales/locations/${location.rows[0].id}/city-state`).type('form').send({ cityState: 'Berthoud, CO' });

    const updated = await pool.query('SELECT city_state FROM sales_locations WHERE id = $1', [location.rows[0].id]);
    expect(updated.rows[0].city_state).toBe('Berthoud, CO');
  });

  it('renames a location', async () => {
    const location = await pool.query("INSERT INTO sales_locations (name) VALUES ('Bayou Smokehouse @ Old Name') RETURNING *");
    const agent = await loggedInAgent();

    await agent.post(`/admin/sales/locations/${location.rows[0].id}/rename`).type('form').send({ name: 'Bayou Smokehouse @ New Name' });

    const updated = await pool.query('SELECT name FROM sales_locations WHERE id = $1', [location.rows[0].id]);
    expect(updated.rows[0].name).toBe('Bayou Smokehouse @ New Name');
  });

  it('blocks a rename that collides with an existing location name, with an error surfaced on the list page', async () => {
    const [locationA, locationB] = await Promise.all([
      pool.query("INSERT INTO sales_locations (name) VALUES ('Bayou Smokehouse @ Venue A') RETURNING *"),
      pool.query("INSERT INTO sales_locations (name) VALUES ('Bayou Smokehouse @ Venue B') RETURNING *"),
    ]);
    const agent = await loggedInAgent();

    const res = await agent
      .post(`/admin/sales/locations/${locationA.rows[0].id}/rename`)
      .type('form')
      .send({ name: 'Bayou Smokehouse @ Venue B' })
      .redirects(1);

    expect(res.status).toBe(200);
    expect(res.text).toContain('use Merge instead');

    const unchanged = await pool.query('SELECT name FROM sales_locations WHERE id = $1', [locationA.rows[0].id]);
    expect(unchanged.rows[0].name).toBe('Bayou Smokehouse @ Venue A');
  });

  it('shows a merge confirmation with the visit count, then merges and deletes the duplicate on confirm', async () => {
    const [duplicate, target] = await Promise.all([
      pool.query("INSERT INTO sales_locations (name) VALUES ('Bayou Smokehouse @ Duplicate Spelling') RETURNING *"),
      pool.query("INSERT INTO sales_locations (name) VALUES ('Bayou Smokehouse @ Canonical Venue') RETURNING *"),
    ]);
    const day = await pool.query(
      "INSERT INTO sales_days (sale_date, location_id, location_source) VALUES ('2026-08-14', $1, 'calendar') RETURNING *",
      [duplicate.rows[0].id]
    );
    const agent = await loggedInAgent();

    const confirmPage = await agent.get(
      `/admin/sales/locations/${duplicate.rows[0].id}/merge?targetId=${target.rows[0].id}`
    );
    expect(confirmPage.status).toBe(200);
    expect(confirmPage.text).toContain('<strong>1</strong> visit(s)');
    expect(confirmPage.text).toContain('Duplicate Spelling');
    expect(confirmPage.text).toContain('Canonical Venue');

    await agent.post(`/admin/sales/locations/${duplicate.rows[0].id}/merge`).type('form').send({ targetId: target.rows[0].id });

    const remaining = await pool.query('SELECT id FROM sales_locations WHERE id = $1', [duplicate.rows[0].id]);
    expect(remaining.rows).toHaveLength(0);

    const reassignedDay = await pool.query('SELECT location_id FROM sales_days WHERE id = $1', [day.rows[0].id]);
    expect(reassignedDay.rows[0].location_id).toBe(target.rows[0].id);
  });
});

describe('admin sales unmatched-day cleanup', () => {
  it('lists a sales day with no calendar match, and assigning a location removes it from the list', async () => {
    const location = await pool.query(
      "INSERT INTO sales_locations (name) VALUES ('Bayou Smokehouse @ Some Venue') RETURNING *"
    );
    const day = await pool.query(
      "INSERT INTO sales_days (sale_date, location_source) VALUES ('2026-08-15', 'unmatched') RETURNING *"
    );
    const agent = await loggedInAgent();

    const before = await agent.get('/admin/sales/unmatched');
    expect(before.status).toBe(200);
    expect(before.text).toContain('8/15/2026');

    await agent.post(`/admin/sales/unmatched/${day.rows[0].id}/location`).type('form').send({ locationId: location.rows[0].id });

    const after = await agent.get('/admin/sales/unmatched');
    expect(after.text).not.toContain('8/15/2026');
  });
});
