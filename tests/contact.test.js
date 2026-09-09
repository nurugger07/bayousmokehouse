const request = require('supertest');
const app = require('../app');
const { pool } = require('../config/db');

afterEach(async () => {
  await pool.query('TRUNCATE contact_messages RESTART IDENTITY');
});

afterAll(async () => {
  await pool.end();
});

describe('POST /contact', () => {
  it('saves a valid submission and redirects with a success indicator', async () => {
    const res = await request(app)
      .post('/contact')
      .type('form')
      .send({ name: 'Jane Doe', email: 'jane@example.com', phone: '555-1234', message: 'Do you cater?' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('submitted=1');

    const { rows } = await pool.query('SELECT * FROM contact_messages');
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('jane@example.com');
  });

  it('rejects submissions missing required fields without saving', async () => {
    const res = await request(app)
      .post('/contact')
      .type('form')
      .send({ name: 'Jane Doe', message: 'Missing email' });

    expect(res.status).toBe(400);

    const { rows } = await pool.query('SELECT * FROM contact_messages');
    expect(rows).toHaveLength(0);
  });

  it('silently discards honeypot-triggered spam submissions', async () => {
    const res = await request(app)
      .post('/contact')
      .type('form')
      .send({ name: 'Bot', email: 'bot@example.com', message: 'spam', company: 'I am a bot' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('submitted=1');

    const { rows } = await pool.query('SELECT * FROM contact_messages');
    expect(rows).toHaveLength(0);
  });

  it('rejects a name longer than the database column limit without saving', async () => {
    const res = await request(app)
      .post('/contact')
      .type('form')
      .send({ name: 'a'.repeat(256), email: 'jane@example.com', message: 'hi' });

    expect(res.status).toBe(400);

    const { rows } = await pool.query('SELECT * FROM contact_messages');
    expect(rows).toHaveLength(0);
  });

  it('does not leak a stack trace or internal error details on an unexpected failure', async () => {
    const spy = jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('simulated db failure'));

    const res = await request(app)
      .post('/contact')
      .type('form')
      .send({ name: 'Jane Doe', email: 'jane@example.com', message: 'hi' });

    spy.mockRestore();

    expect(res.status).toBe(500);
    expect(res.text).not.toContain('simulated db failure');
    expect(res.text).not.toContain(__dirname);
    expect(res.text).not.toMatch(/at \S+ \(.*:\d+:\d+\)/);
  });
});

describe('GET /contact', () => {
  it('shows a success message when redirected after submission', async () => {
    const res = await request(app).get('/contact?submitted=1');
    expect(res.text.toLowerCase()).toContain('thanks');
  });
});
