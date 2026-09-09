const request = require('supertest');
const app = require('../app');
const { pool } = require('../config/db');
const { createMessage } = require('../models/contactMessages');

const CORRECT_PASSWORD = process.env.ADMIN_TEST_PASSWORD;

afterEach(async () => {
  await pool.query('TRUNCATE contact_messages RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await pool.end();
});

async function loggedInAgent() {
  const agent = request.agent(app);
  await agent.post('/admin/login').type('form').send({ password: CORRECT_PASSWORD });
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
    const res = await agent.post('/admin/login').type('form').send({ password: 'wrong-password' });

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
    await agent.post('/admin/logout');

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
    await agent.post(`/admin/messages/${message.id}/archive`);

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

    await agent.post(`/admin/messages/${message.id}/read`);

    const { rows } = await pool.query('SELECT status FROM contact_messages WHERE id = $1', [message.id]);
    expect(rows[0].status).toBe('read');
  });

  it('archives, soft-deletes, and restores a message', async () => {
    const message = await createMessage({ name: 'Jane', email: 'jane@example.com', message: 'hi' });
    const agent = await loggedInAgent();

    await agent.post(`/admin/messages/${message.id}/archive`);
    let row = (await pool.query('SELECT * FROM contact_messages WHERE id = $1', [message.id])).rows[0];
    expect(row.status).toBe('archived');

    await agent.post(`/admin/messages/${message.id}/delete`);
    row = (await pool.query('SELECT * FROM contact_messages WHERE id = $1', [message.id])).rows[0];
    expect(row.deleted_at).not.toBeNull();

    const deletedList = await agent.get('/admin/messages?status=deleted');
    expect(deletedList.text).toContain('jane@example.com');

    await agent.post(`/admin/messages/${message.id}/restore`);
    row = (await pool.query('SELECT * FROM contact_messages WHERE id = $1', [message.id])).rows[0];
    expect(row.deleted_at).toBeNull();
  });
});

describe('message notes', () => {
  it('adds a note and shows it on the detail page', async () => {
    const message = await createMessage({ name: 'Jane', email: 'jane@example.com', message: 'hi' });
    const agent = await loggedInAgent();

    await agent
      .post(`/admin/messages/${message.id}/notes`)
      .type('form')
      .send({ note: 'Called back, left a voicemail.' });

    const detail = await agent.get(`/admin/messages/${message.id}`);
    expect(detail.text).toContain('Called back, left a voicemail.');
  });

  it('does not add an empty note', async () => {
    const message = await createMessage({ name: 'Jane', email: 'jane@example.com', message: 'hi' });
    const agent = await loggedInAgent();

    await agent.post(`/admin/messages/${message.id}/notes`).type('form').send({ note: '   ' });

    const { rows } = await pool.query('SELECT * FROM contact_message_notes WHERE contact_message_id = $1', [
      message.id,
    ]);
    expect(rows).toHaveLength(0);
  });
});
