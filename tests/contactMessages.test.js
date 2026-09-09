const { pool } = require('../config/db');
const { createMessage } = require('../models/contactMessages');

afterEach(async () => {
  await pool.query('TRUNCATE contact_messages RESTART IDENTITY');
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
});
