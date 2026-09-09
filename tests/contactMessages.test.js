const { pool } = require('../config/db');
const {
  createMessage,
  listMessages,
  getMessageById,
  markRead,
  archiveMessage,
  softDeleteMessage,
  restoreMessage,
} = require('../models/contactMessages');

afterEach(async () => {
  await pool.query('TRUNCATE contact_messages RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await pool.end();
});

describe('createMessage', () => {
  it('inserts a message with default status and no deleted_at', async () => {
    const message = await createMessage({
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '555-123-4567',
      message: 'Do you cater weddings?',
    });

    expect(message.id).toBeDefined();
    expect(message.name).toBe('Jane Doe');
    expect(message.email).toBe('jane@example.com');
    expect(message.phone).toBe('555-123-4567');
    expect(message.message).toBe('Do you cater weddings?');
    expect(message.status).toBe('unread');
    expect(message.deleted_at).toBeNull();
  });

  it('allows phone to be omitted', async () => {
    const message = await createMessage({
      name: 'John Smith',
      email: 'john@example.com',
      message: 'What time do you open Saturday?',
    });

    expect(message.phone).toBeNull();
  });

  it('stores the given category', async () => {
    const message = await createMessage({
      name: 'Jane Doe',
      email: 'jane@example.com',
      message: 'Can you cater our office party?',
      category: 'private_event',
    });

    expect(message.category).toBe('private_event');
  });

  it('defaults to general_inquiry when no category is given', async () => {
    const message = await createMessage({ name: 'Jane Doe', email: 'jane@example.com', message: 'hi' });
    expect(message.category).toBe('general_inquiry');
  });
});

describe('listMessages', () => {
  it('defaults to listing unread, non-deleted messages, newest first', async () => {
    const first = await createMessage({ name: 'A', email: 'a@example.com', message: 'first' });
    await new Promise((r) => setTimeout(r, 10));
    const second = await createMessage({ name: 'B', email: 'b@example.com', message: 'second' });

    const messages = await listMessages();

    expect(messages.map((m) => m.id)).toEqual([second.id, first.id]);
  });

  it('filters by status', async () => {
    const unread = await createMessage({ name: 'A', email: 'a@example.com', message: 'unread one' });
    const toArchive = await createMessage({ name: 'B', email: 'b@example.com', message: 'will be archived' });
    await archiveMessage(toArchive.id);

    const archived = await listMessages({ status: 'archived' });

    expect(archived.map((m) => m.id)).toEqual([toArchive.id]);
    expect(archived.map((m) => m.id)).not.toContain(unread.id);
  });

  it('excludes soft-deleted messages by default', async () => {
    const kept = await createMessage({ name: 'A', email: 'a@example.com', message: 'kept' });
    const deleted = await createMessage({ name: 'B', email: 'b@example.com', message: 'deleted' });
    await softDeleteMessage(deleted.id);

    const messages = await listMessages({ status: 'unread' });

    expect(messages.map((m) => m.id)).toEqual([kept.id]);
  });

  it('lists soft-deleted messages when status is "deleted"', async () => {
    const deleted = await createMessage({ name: 'A', email: 'a@example.com', message: 'gone' });
    await softDeleteMessage(deleted.id);

    const messages = await listMessages({ status: 'deleted' });

    expect(messages.map((m) => m.id)).toEqual([deleted.id]);
  });

  it('filters by category in addition to status', async () => {
    const privateEvent = await createMessage({
      name: 'A',
      email: 'a@example.com',
      message: 'party',
      category: 'private_event',
    });
    const breweryEvent = await createMessage({
      name: 'B',
      email: 'b@example.com',
      message: 'brewery gig',
      category: 'brewery_event',
    });

    const filtered = await listMessages({ status: 'unread', category: 'private_event' });

    expect(filtered.map((m) => m.id)).toEqual([privateEvent.id]);
    expect(filtered.map((m) => m.id)).not.toContain(breweryEvent.id);
  });
});

describe('getMessageById', () => {
  it('returns the message', async () => {
    const created = await createMessage({ name: 'A', email: 'a@example.com', message: 'hi' });
    const found = await getMessageById(created.id);
    expect(found.id).toBe(created.id);
  });

  it('returns undefined for a nonexistent id', async () => {
    const found = await getMessageById(999999);
    expect(found).toBeUndefined();
  });
});

describe('status transitions', () => {
  it('markRead sets status to read', async () => {
    const created = await createMessage({ name: 'A', email: 'a@example.com', message: 'hi' });
    const updated = await markRead(created.id);
    expect(updated.status).toBe('read');
  });

  it('archiveMessage sets status to archived', async () => {
    const created = await createMessage({ name: 'A', email: 'a@example.com', message: 'hi' });
    const updated = await archiveMessage(created.id);
    expect(updated.status).toBe('archived');
  });

  it('softDeleteMessage sets deleted_at without a hard delete', async () => {
    const created = await createMessage({ name: 'A', email: 'a@example.com', message: 'hi' });
    const updated = await softDeleteMessage(created.id);
    expect(updated.deleted_at).not.toBeNull();

    const { rows } = await pool.query('SELECT * FROM contact_messages WHERE id = $1', [created.id]);
    expect(rows).toHaveLength(1);
  });

  it('restoreMessage clears deleted_at', async () => {
    const created = await createMessage({ name: 'A', email: 'a@example.com', message: 'hi' });
    await softDeleteMessage(created.id);
    const restored = await restoreMessage(created.id);
    expect(restored.deleted_at).toBeNull();
  });
});
