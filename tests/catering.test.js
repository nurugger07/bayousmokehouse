jest.mock('../services/mailer');

const request = require('supertest');
const app = require('../app');
const { pool } = require('../config/db');
const { sendContactNotification } = require('../services/mailer');
const { getCsrfToken } = require('./helpers/csrf');

// A plain request(app) call has no session/cookie continuity, and the
// CSRF token is per-session — so each submission needs its own agent
// to first GET a token from, then POST with it.
async function postCatering(data) {
  const agent = request.agent(app);
  const _csrf = await getCsrfToken(agent, '/catering');
  return agent.post('/catering').type('form').send({ ...data, _csrf });
}

const VALID_SUBMISSION = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  phone: '555-123-4567',
  eventType: 'wedding',
  eventDate: '2026-08-01',
  startTime: '17:00',
  endTime: '21:00',
  location: '456 Oak Ave, Loveland, CO',
  guestCount: '120',
  message: 'Would love pulled pork and jambalaya for the reception.',
};

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

describe('POST /catering', () => {
  it('saves a valid catering request under the catering category and redirects', async () => {
    const res = await postCatering(VALID_SUBMISSION);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('submitted=1');

    const { rows } = await pool.query('SELECT * FROM contact_messages');
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe('catering');
    expect(rows[0].event_type).toBe('wedding');
    expect(rows[0].guest_count).toBe(120);
    expect(rows[0].location).toBe('456 Oak Ave, Loveland, CO');

    expect(sendContactNotification).toHaveBeenCalledTimes(1);
    const call = sendContactNotification.mock.calls[0][0];
    expect(call.message.email).toBe('jane@example.com');
    expect(call.detailUrl).toContain(`/admin/messages/${rows[0].id}`);
  });

  it('allows end time to be omitted', async () => {
    const { endTime, ...withoutEndTime } = VALID_SUBMISSION;

    const res = await postCatering(withoutEndTime);

    expect(res.status).toBe(302);

    const { rows } = await pool.query('SELECT * FROM contact_messages');
    expect(rows[0].end_time).toBeNull();
  });

  it('does not fail the submission if sending the email notification fails', async () => {
    sendContactNotification.mockRejectedValueOnce(new Error('smtp down'));

    const res = await postCatering(VALID_SUBMISSION);

    expect(res.status).toBe(302);

    const { rows } = await pool.query('SELECT * FROM contact_messages');
    expect(rows).toHaveLength(1);
  });

  it.each(['name', 'email', 'phone', 'eventType', 'eventDate', 'startTime', 'location', 'guestCount', 'message'])(
    'rejects a submission missing %s without saving',
    async (field) => {
      const { [field]: _omit, ...incomplete } = VALID_SUBMISSION;

      const res = await postCatering(incomplete);

      expect(res.status).toBe(400);

      const { rows } = await pool.query('SELECT * FROM contact_messages');
      expect(rows).toHaveLength(0);
      expect(sendContactNotification).not.toHaveBeenCalled();
    }
  );

  it('rejects a malformed email address without saving', async () => {
    const res = await postCatering({ ...VALID_SUBMISSION, email: 'not-an-email' });

    expect(res.status).toBe(400);

    const { rows } = await pool.query('SELECT * FROM contact_messages');
    expect(rows).toHaveLength(0);
  });

  it('rejects an invalid event type without saving', async () => {
    const res = await postCatering({ ...VALID_SUBMISSION, eventType: 'not-a-real-type' });

    expect(res.status).toBe(400);

    const { rows } = await pool.query('SELECT * FROM contact_messages');
    expect(rows).toHaveLength(0);
  });

  it('rejects a non-numeric guest count without saving', async () => {
    const res = await postCatering({ ...VALID_SUBMISSION, guestCount: 'a lot' });

    expect(res.status).toBe(400);

    const { rows } = await pool.query('SELECT * FROM contact_messages');
    expect(rows).toHaveLength(0);
  });

  it('rejects a zero or negative guest count without saving', async () => {
    const res = await postCatering({ ...VALID_SUBMISSION, guestCount: '0' });

    expect(res.status).toBe(400);

    const { rows } = await pool.query('SELECT * FROM contact_messages');
    expect(rows).toHaveLength(0);
  });

  it('rejects an invalid event date without saving', async () => {
    const res = await postCatering({ ...VALID_SUBMISSION, eventDate: 'not-a-date' });

    expect(res.status).toBe(400);

    const { rows } = await pool.query('SELECT * FROM contact_messages');
    expect(rows).toHaveLength(0);
  });

  it('silently discards honeypot-triggered spam submissions', async () => {
    const res = await postCatering({ ...VALID_SUBMISSION, company: 'I am a bot' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('submitted=1');
    expect(sendContactNotification).not.toHaveBeenCalled();

    const { rows } = await pool.query('SELECT * FROM contact_messages');
    expect(rows).toHaveLength(0);
  });

  it.each(['backyard_party', 'wedding', 'birthday', 'graduation', 'corporate_event', 'brewery_festival', 'other'])(
    'accepts and saves the "%s" event type',
    async (eventType) => {
      const res = await postCatering({ ...VALID_SUBMISSION, eventType });

      expect(res.status).toBe(302);

      const { rows } = await pool.query('SELECT event_type FROM contact_messages');
      expect(rows[0].event_type).toBe(eventType);
    }
  );
});

describe('GET /catering', () => {
  it('renders the catering page with a request form', async () => {
    const res = await request(app).get('/catering');

    expect(res.status).toBe(200);
    expect(res.text).toContain('<form');
    expect(res.text).toContain('name="eventDate"');
    expect(res.text).toContain('name="guestCount"');
  });

  it('shows a success message when redirected after submission', async () => {
    const res = await request(app).get('/catering?submitted=1');
    expect(res.text.toLowerCase()).toContain('thanks');
  });
});
