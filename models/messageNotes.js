const { pool } = require('../config/db');

async function addNote(contactMessageId, note) {
  const result = await pool.query(
    `INSERT INTO contact_message_notes (contact_message_id, note)
     VALUES ($1, $2)
     RETURNING *`,
    [contactMessageId, note]
  );

  return result.rows[0];
}

async function listNotesForMessage(contactMessageId) {
  const result = await pool.query(
    `SELECT * FROM contact_message_notes
     WHERE contact_message_id = $1
     ORDER BY created_at ASC`,
    [contactMessageId]
  );

  return result.rows;
}

module.exports = { addNote, listNotesForMessage };
