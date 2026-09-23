const request = require('supertest');
const app = require('../app');
const { pool } = require('../config/db');
const { getCsrfToken } = require('./helpers/csrf');

const CORRECT_PASSWORD = process.env.ADMIN_TEST_PASSWORD;

async function loggedInAgent() {
  const agent = request.agent(app);
  const csrfToken = await getCsrfToken(agent, '/admin/login');
  await agent.post('/admin/login').type('form').send({ password: CORRECT_PASSWORD, _csrf: csrfToken });
  agent.csrfToken = csrfToken;
  return agent;
}

const VALID_JURISDICTION = {
  name: 'Colorado',
  level: 'state',
  taxRatePercent: '2.9',
  schedule: 'monthly',
  dayOfMonthDue: '20',
  paymentLink: 'https://tax.colorado.gov/',
  licenseNumber: '96921314-004-LIC',
  licenseDriveUrl: 'https://drive.google.com/file/d/example',
};

afterEach(async () => {
  await pool.query('TRUNCATE location_tax_jurisdictions, tax_payments, tax_jurisdictions, sales_locations RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await pool.end();
});

describe('admin tax jurisdictions auth', () => {
  it('redirects unauthenticated requests to the login page', async () => {
    const res = await request(app).get('/admin/tax/jurisdictions');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/admin/login');
  });
});

describe('admin tax jurisdictions CRUD', () => {
  it('creates a jurisdiction and lists it', async () => {
    const agent = await loggedInAgent();

    const res = await agent
      .post('/admin/tax/jurisdictions')
      .type('form')
      .send({ ...VALID_JURISDICTION, _csrf: agent.csrfToken });

    expect(res.status).toBe(302);

    const list = await agent.get('/admin/tax/jurisdictions');
    expect(list.text).toContain('Colorado');
    expect(list.text).toContain('2.900%');
    expect(list.text).toContain('96921314-004-LIC');
  });

  it('marks a home-rule jurisdiction correctly', async () => {
    const agent = await loggedInAgent();

    await agent
      .post('/admin/tax/jurisdictions')
      .type('form')
      .send({ ...VALID_JURISDICTION, name: 'City of Boulder', isHomeRule: 'on', _csrf: agent.csrfToken });

    const list = await agent.get('/admin/tax/jurisdictions');
    expect(list.text).toContain('City of Boulder');
  });

  it('edits an existing jurisdiction', async () => {
    const agent = await loggedInAgent();
    const created = await pool.query(
      `INSERT INTO tax_jurisdictions (name, level, tax_rate_percent, schedule, day_of_month_due)
       VALUES ('Larimer County', 'county', 0.8, 'monthly', 20) RETURNING *`
    );

    const res = await agent
      .post(`/admin/tax/jurisdictions/${created.rows[0].id}`)
      .type('form')
      .send({ ...VALID_JURISDICTION, name: 'Larimer County', level: 'county', taxRatePercent: '0.65', _csrf: agent.csrfToken });

    expect(res.status).toBe(302);

    const updated = await pool.query('SELECT * FROM tax_jurisdictions WHERE id = $1', [created.rows[0].id]);
    expect(Number(updated.rows[0].tax_rate_percent)).toBe(0.65);
  });

  it('returns 404 editing a jurisdiction that does not exist', async () => {
    const agent = await loggedInAgent();
    const res = await agent.get('/admin/tax/jurisdictions/999999/edit');
    expect(res.status).toBe(404);
  });
});

describe('assigning jurisdictions to a location', () => {
  it('saves the selected jurisdictions for a location', async () => {
    const agent = await loggedInAgent();
    const location = await pool.query("INSERT INTO sales_locations (name) VALUES ('Bayou Smokehouse @ Berthoud Brewery') RETURNING *");
    const colorado = await pool.query(
      `INSERT INTO tax_jurisdictions (name, level, tax_rate_percent, schedule, day_of_month_due)
       VALUES ('Colorado', 'state', 2.9, 'monthly', 20) RETURNING *`
    );
    const berthoud = await pool.query(
      `INSERT INTO tax_jurisdictions (name, level, tax_rate_percent, schedule, day_of_month_due)
       VALUES ('Town of Berthoud', 'municipality', 3.0, 'monthly', 20) RETURNING *`
    );

    const res = await agent
      .post(`/admin/sales/locations/${location.rows[0].id}/tax-jurisdictions`)
      .type('form')
      .send({
        jurisdictionIds: [String(colorado.rows[0].id), String(berthoud.rows[0].id)],
        _csrf: agent.csrfToken,
      });

    expect(res.status).toBe(302);

    const links = await pool.query(
      'SELECT jurisdiction_id FROM location_tax_jurisdictions WHERE location_id = $1 ORDER BY jurisdiction_id',
      [location.rows[0].id]
    );
    expect(links.rows.map((r) => r.jurisdiction_id)).toEqual(
      [colorado.rows[0].id, berthoud.rows[0].id].sort((a, b) => a - b)
    );

    const page = await agent.get('/admin/sales/locations');
    expect(page.text).toContain('Colorado');
    expect(page.text).toContain('Town of Berthoud');
  });

  it('replaces the previous set rather than adding to it', async () => {
    const agent = await loggedInAgent();
    const location = await pool.query("INSERT INTO sales_locations (name) VALUES ('Bayou Smokehouse @ Test Venue') RETURNING *");
    const [colorado, larimer] = await Promise.all([
      pool.query(`INSERT INTO tax_jurisdictions (name, level, tax_rate_percent, schedule, day_of_month_due) VALUES ('Colorado', 'state', 2.9, 'monthly', 20) RETURNING *`),
      pool.query(`INSERT INTO tax_jurisdictions (name, level, tax_rate_percent, schedule, day_of_month_due) VALUES ('Larimer County', 'county', 0.8, 'monthly', 20) RETURNING *`),
    ]);

    await agent
      .post(`/admin/sales/locations/${location.rows[0].id}/tax-jurisdictions`)
      .type('form')
      .send({ jurisdictionIds: [String(colorado.rows[0].id)], _csrf: agent.csrfToken });

    await agent
      .post(`/admin/sales/locations/${location.rows[0].id}/tax-jurisdictions`)
      .type('form')
      .send({ jurisdictionIds: [String(larimer.rows[0].id)], _csrf: agent.csrfToken });

    const links = await pool.query('SELECT jurisdiction_id FROM location_tax_jurisdictions WHERE location_id = $1', [
      location.rows[0].id,
    ]);
    expect(links.rows.map((r) => r.jurisdiction_id)).toEqual([larimer.rows[0].id]);
  });
});
