jest.mock('../services/mailer');

const request = require('supertest');
const app = require('../app');
const { pool } = require('../config/db');
const { sendContactNotification } = require('../services/mailer');
const { getCsrfToken } = require('./helpers/csrf');

// A plain request(app) call has no session/cookie continuity, and the
// CSRF token is per-session — so each submission needs its own agent
// to first GET a token from, then POST with it.
async function postContact(data) {
  const agent = request.agent(app);
  const _csrf = await getCsrfToken(agent, '/contact');
  return agent.post('/contact').type('form').send({ ...data, _csrf });
}

beforeEach(() => {
  sendContactNotification.mockResolvedValue(undefined);
});

afterEach(async () => {
  jest.clearAllMocks();
  await pool.query('TRUNCATE contact_messages RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await pool.end();
});

describe('POST /contact', () => {
  it('saves a valid submission and redirects with a success indicator', async () => {
    const res = await postContact({
        name: 'Jane Doe',
        email: 'jane@example.com',
        phone: '555-1234',
        message: 'Do you cater?',
        category: 'private_event',
      });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('submitted=1');

    const { rows } = await pool.query('SELECT * FROM contact_messages');
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('jane@example.com');

    expect(sendContactNotification).toHaveBeenCalledTimes(1);
    const call = sendContactNotification.mock.calls[0][0];
    expect(call.message.email).toBe('jane@example.com');
    expect(call.detailUrl).toContain(`/admin/messages/${rows[0].id}`);
  });

  it('does not fail the submission if sending the email notification fails', async () => {
    sendContactNotification.mockRejectedValueOnce(new Error('smtp down'));

    const res = await postContact({ name: 'Jane Doe', email: 'jane@example.com', message: 'hi', category: 'general_inquiry' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('submitted=1');

    const { rows } = await pool.query('SELECT * FROM contact_messages');
    expect(rows).toHaveLength(1);
  });

  it('rejects submissions missing required fields without saving', async () => {
    const res = await postContact({ name: 'Jane Doe', message: 'Missing email' });

    expect(res.status).toBe(400);

    const { rows } = await pool.query('SELECT * FROM contact_messages');
    expect(rows).toHaveLength(0);
    expect(sendContactNotification).not.toHaveBeenCalled();
  });

  it('rejects a malformed email address without saving', async () => {
    const res = await postContact({ name: 'Jane Doe', email: 'not-an-email', message: 'hi' });

    expect(res.status).toBe(400);

    const { rows } = await pool.query('SELECT * FROM contact_messages');
    expect(rows).toHaveLength(0);
    expect(sendContactNotification).not.toHaveBeenCalled();
  });

  it('silently discards honeypot-triggered spam submissions', async () => {
    const res = await postContact({ name: 'Bot', email: 'bot@example.com', message: 'spam', company: 'I am a bot' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('submitted=1');
    expect(sendContactNotification).not.toHaveBeenCalled();

    const { rows } = await pool.query('SELECT * FROM contact_messages');
    expect(rows).toHaveLength(0);
  });

  it('rejects a name longer than the database column limit without saving', async () => {
    const res = await postContact({ name: 'a'.repeat(256), email: 'jane@example.com', message: 'hi' });

    expect(res.status).toBe(400);

    const { rows } = await pool.query('SELECT * FROM contact_messages');
    expect(rows).toHaveLength(0);
  });

  it('rejects a submission missing a category without saving', async () => {
    const res = await postContact({ name: 'Jane Doe', email: 'jane@example.com', message: 'hi' });

    expect(res.status).toBe(400);

    const { rows } = await pool.query('SELECT * FROM contact_messages');
    expect(rows).toHaveLength(0);
  });

  it('rejects a submission with an invalid category without saving', async () => {
    const res = await postContact({ name: 'Jane Doe', email: 'jane@example.com', message: 'hi', category: 'not-a-real-category' });

    expect(res.status).toBe(400);

    const { rows } = await pool.query('SELECT * FROM contact_messages');
    expect(rows).toHaveLength(0);
  });

  it.each(['private_event', 'brewery_event', 'general_inquiry'])(
    'accepts and saves the "%s" category',
    async (category) => {
      const res = await postContact({ name: 'Jane Doe', email: 'jane@example.com', message: 'hi', category });

      expect(res.status).toBe(302);

      const { rows } = await pool.query('SELECT category FROM contact_messages');
      expect(rows[0].category).toBe(category);
    }
  );

  it('does not leak a stack trace or internal error details on an unexpected failure', async () => {
    // Reject only the actual contact-message insert, not pool.query calls
    // in general — the session store (connect-pg-simple) also queries
    // through this same pool on every request, including the GET inside
    // postContact() that fetches the CSRF token.
    const originalQuery = pool.query.bind(pool);
    const spy = jest.spyOn(pool, 'query').mockImplementation((text, params) => {
      if (typeof text === 'string' && text.includes('INSERT INTO contact_messages')) {
        return Promise.reject(new Error('simulated db failure'));
      }
      return originalQuery(text, params);
    });

    const res = await postContact({ name: 'Jane Doe', email: 'jane@example.com', message: 'hi', category: 'general_inquiry' });

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
