const request = require('supertest');
const app = require('../app');
const { pool } = require('../config/db');
const { createMessage } = require('../models/contactMessages');
const { getCsrfToken } = require('./helpers/csrf');

const CORRECT_PASSWORD = process.env.ADMIN_TEST_PASSWORD;

afterEach(async () => {
  await pool.query('TRUNCATE contact_messages RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await pool.end();
});

// The CSRF token is per-session (see app.js), so it's fetched once at
// login and stashed on the agent — every later POST in a test reuses
// agent.csrfToken rather than re-fetching it.
async function loggedInAgent() {
  const agent = request.agent(app);
  const csrfToken = await getCsrfToken(agent, '/admin/login');
  await agent.post('/admin/login').type('form').send({ password: CORRECT_PASSWORD, _csrf: csrfToken });
  agent.csrfToken = csrfToken;
  return agent;
}

describe('admin auth', () => {
  it('redirects unauthenticated requests to the login page', async () => {
    const res = await request(app).get('/admin/messages');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/admin/login');
  });

  it('shows a login form', async () => {
    const res = await request(app).get('/admin/login');
    expect(res.status).toBe(200);
    expect(res.text).toContain('type="password"');
  });

  it('rejects an incorrect password without creating a session', async () => {
    const agent = request.agent(app);
    const _csrf = await getCsrfToken(agent, '/admin/login');
    const res = await agent.post('/admin/login').type('form').send({ password: 'wrong-password', _csrf });

    expect(res.status).toBe(401);

    const followUp = await agent.get('/admin/messages');
    expect(followUp.status).toBe(302);
    expect(followUp.headers.location).toContain('/admin/login');
  });

  it('logs in with the correct password and grants access', async () => {
    const agent = await loggedInAgent();
    const res = await agent.get('/admin/messages');
    expect(res.status).toBe(200);
  });

  it('logs out and revokes access', async () => {
    const agent = await loggedInAgent();
    await agent.post('/admin/logout').type('form').send({ _csrf: agent.csrfToken });

    const res = await agent.get('/admin/messages');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/admin/login');
  });
});

describe('admin message management', () => {
  it('lists unread messages by default', async () => {
    const message = await createMessage({ name: 'Jane', email: 'jane@example.com', message: 'hi' });
    const agent = await loggedInAgent();

    const res = await agent.get('/admin/messages');

    expect(res.status).toBe(200);
    expect(res.text).toContain('jane@example.com');
    expect(res.text).not.toContain(String(message.id + 999)); // sanity, not a real assertion on id text
  });

  it('filters messages by status', async () => {
    const message = await createMessage({ name: 'Jane', email: 'jane@example.com', message: 'hi' });
    const agent = await loggedInAgent();
    await agent.post(`/admin/messages/${message.id}/archive`).type('form').send({ _csrf: agent.csrfToken });

    const unreadList = await agent.get('/admin/messages?status=unread');
    const archivedList = await agent.get('/admin/messages?status=archived');

    expect(unreadList.text).not.toContain('jane@example.com');
    expect(archivedList.text).toContain('jane@example.com');
  });

  it('filters messages by category', async () => {
    await createMessage({
      name: 'Jane',
      email: 'jane@example.com',
      message: 'party',
      category: 'private_event',
    });
    await createMessage({
      name: 'Bob',
      email: 'bob@example.com',
      message: 'brewery gig',
      category: 'brewery_event',
    });
    const agent = await loggedInAgent();

    const privateList = await agent.get('/admin/messages?category=private_event');
    const breweryList = await agent.get('/admin/messages?category=brewery_event');

    expect(privateList.text).toContain('jane@example.com');
    expect(privateList.text).not.toContain('bob@example.com');
    expect(breweryList.text).toContain('bob@example.com');
    expect(breweryList.text).not.toContain('jane@example.com');
  });

  it('shows the category on the message detail page', async () => {
    const message = await createMessage({
      name: 'Jane',
      email: 'jane@example.com',
      message: 'party',
      category: 'private_event',
    });
    const agent = await loggedInAgent();

    const res = await agent.get(`/admin/messages/${message.id}`);

    expect(res.text).toContain('Private Event');
  });

  it('does not change status just from viewing the detail page (GET must not have side effects)', async () => {
    const message = await createMessage({ name: 'Jane', email: 'jane@example.com', message: 'hi' });
    const agent = await loggedInAgent();

    const detail = await agent.get(`/admin/messages/${message.id}`);
    expect(detail.status).toBe(200);

    const { rows } = await pool.query('SELECT status FROM contact_messages WHERE id = $1', [message.id]);
    expect(rows[0].status).toBe('unread');
  });

  it('marks a message as read via an explicit POST action', async () => {
    const message = await createMessage({ name: 'Jane', email: 'jane@example.com', message: 'hi' });
    const agent = await loggedInAgent();

    await agent.post(`/admin/messages/${message.id}/read`).type('form').send({ _csrf: agent.csrfToken });

    const { rows } = await pool.query('SELECT status FROM contact_messages WHERE id = $1', [message.id]);
    expect(rows[0].status).toBe('read');
  });

  it('archives, soft-deletes, and restores a message', async () => {
    const message = await createMessage({ name: 'Jane', email: 'jane@example.com', message: 'hi' });
    const agent = await loggedInAgent();

    await agent.post(`/admin/messages/${message.id}/archive`).type('form').send({ _csrf: agent.csrfToken });
    let row = (await pool.query('SELECT * FROM contact_messages WHERE id = $1', [message.id])).rows[0];
    expect(row.status).toBe('archived');

    await agent.post(`/admin/messages/${message.id}/delete`).type('form').send({ _csrf: agent.csrfToken });
    row = (await pool.query('SELECT * FROM contact_messages WHERE id = $1', [message.id])).rows[0];
    expect(row.deleted_at).not.toBeNull();

    const deletedList = await agent.get('/admin/messages?status=deleted');
    expect(deletedList.text).toContain('jane@example.com');

    await agent.post(`/admin/messages/${message.id}/restore`).type('form').send({ _csrf: agent.csrfToken });
    row = (await pool.query('SELECT * FROM contact_messages WHERE id = $1', [message.id])).rows[0];
    expect(row.deleted_at).toBeNull();
  });
});

describe('admin catering request review', () => {
  it('filters messages by the catering category', async () => {
    await createMessage({
      name: 'Jane',
      email: 'jane@example.com',
      message: 'Need catering for a wedding.',
      category: 'catering',
      eventType: 'wedding',
      eventDate: '2026-08-01',
      startTime: '17:00',
      location: '456 Oak Ave, Loveland, CO',
      guestCount: 120,
    });
    await createMessage({ name: 'Bob', email: 'bob@example.com', message: 'hi', category: 'general_inquiry' });
    const agent = await loggedInAgent();

    const cateringList = await agent.get('/admin/messages?category=catering');

    expect(cateringList.text).toContain('jane@example.com');
    expect(cateringList.text).not.toContain('bob@example.com');
  });

  it('shows the catering event details on the message detail page', async () => {
    const message = await createMessage({
      name: 'Jane',
      email: 'jane@example.com',
      message: 'Need catering for a wedding.',
      category: 'catering',
      eventType: 'wedding',
      eventDate: '2026-08-01',
      startTime: '17:00',
      endTime: '21:00',
      location: '456 Oak Ave, Loveland, CO',
      guestCount: 120,
    });
    const agent = await loggedInAgent();

    const res = await agent.get(`/admin/messages/${message.id}`);

    expect(res.text).toContain('Catering Request');
    expect(res.text).toContain('Wedding');
    expect(res.text).toContain('456 Oak Ave, Loveland, CO');
    expect(res.text).toContain('120');
  });

  it('does not show catering event details for a non-catering message', async () => {
    const message = await createMessage({ name: 'Bob', email: 'bob@example.com', message: 'hi' });
    const agent = await loggedInAgent();

    const res = await agent.get(`/admin/messages/${message.id}`);

    expect(res.text).not.toContain('Guest Count');
  });
});

describe('message notes', () => {
  it('adds a note and shows it on the detail page', async () => {
    const message = await createMessage({ name: 'Jane', email: 'jane@example.com', message: 'hi' });
    const agent = await loggedInAgent();

    await agent
      .post(`/admin/messages/${message.id}/notes`)
      .type('form')
      .send({ note: 'Called back, left a voicemail.', _csrf: agent.csrfToken });

    const detail = await agent.get(`/admin/messages/${message.id}`);
    expect(detail.text).toContain('Called back, left a voicemail.');
  });

  it('does not add an empty note', async () => {
    const message = await createMessage({ name: 'Jane', email: 'jane@example.com', message: 'hi' });
    const agent = await loggedInAgent();

    await agent.post(`/admin/messages/${message.id}/notes`).type('form').send({ note: '   ', _csrf: agent.csrfToken });

    const { rows } = await pool.query('SELECT * FROM contact_message_notes WHERE contact_message_id = $1', [
      message.id,
    ]);
    expect(rows).toHaveLength(0);
  });
});
