const { pool } = require('../config/db');
const { createMessage } = require('../models/contactMessages');
const { addNote, listNotesForMessage } = require('../models/messageNotes');

afterEach(async () => {
  await pool.query('TRUNCATE contact_messages RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await pool.end();
});

describe('addNote / listNotesForMessage', () => {
  it('adds a note to a message and lists it back, oldest first', async () => {
    const message = await createMessage({ name: 'Jane', email: 'jane@example.com', message: 'hi' });

    await addNote(message.id, 'Called back, left voicemail.');
    await new Promise((r) => setTimeout(r, 10));
    await addNote(message.id, 'She called back, booked catering for the 14th.');

    const notes = await listNotesForMessage(message.id);

    expect(notes).toHaveLength(2);
    expect(notes[0].note).toBe('Called back, left voicemail.');
    expect(notes[1].note).toBe('She called back, booked catering for the 14th.');
    expect(notes[0].created_at).toBeDefined();
  });

  it('returns an empty list for a message with no notes', async () => {
    const message = await createMessage({ name: 'Jane', email: 'jane@example.com', message: 'hi' });
    const notes = await listNotesForMessage(message.id);
    expect(notes).toEqual([]);
  });

  it('deletes notes when the parent message is hard-deleted (cascade)', async () => {
    const message = await createMessage({ name: 'Jane', email: 'jane@example.com', message: 'hi' });
    await addNote(message.id, 'A note.');

    await pool.query('DELETE FROM contact_messages WHERE id = $1', [message.id]);

    const { rows } = await pool.query('SELECT * FROM contact_message_notes WHERE contact_message_id = $1', [
      message.id,
    ]);
    expect(rows).toHaveLength(0);
  });
});
