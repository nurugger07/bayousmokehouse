const { pool } = require('../config/db');

async function createMessage({ name, email, phone, message }) {
  const result = await pool.query(
    `INSERT INTO contact_messages (name, email, phone, message)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [name, email, phone || null, message]
  );

  return result.rows[0];
}

async function listMessages({ status = 'unread' } = {}) {
  if (status === 'deleted') {
    const result = await pool.query(
      `SELECT * FROM contact_messages WHERE deleted_at IS NOT NULL ORDER BY submitted_at DESC`
    );
    return result.rows;
  }

  const result = await pool.query(
    `SELECT * FROM contact_messages
     WHERE deleted_at IS NULL AND status = $1
     ORDER BY submitted_at DESC`,
    [status]
  );
  return result.rows;
}

async function getMessageById(id) {
  const result = await pool.query('SELECT * FROM contact_messages WHERE id = $1', [id]);
  return result.rows[0];
}

async function markRead(id) {
  const result = await pool.query(
    `UPDATE contact_messages SET status = 'read', updated_at = now() WHERE id = $1 RETURNING *`,
    [id]
  );
  return result.rows[0];
}

async function archiveMessage(id) {
  const result = await pool.query(
    `UPDATE contact_messages SET status = 'archived', updated_at = now() WHERE id = $1 RETURNING *`,
    [id]
  );
  return result.rows[0];
}

async function softDeleteMessage(id) {
  const result = await pool.query(
    `UPDATE contact_messages SET deleted_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
    [id]
  );
  return result.rows[0];
}

async function restoreMessage(id) {
  const result = await pool.query(
    `UPDATE contact_messages SET deleted_at = NULL, updated_at = now() WHERE id = $1 RETURNING *`,
    [id]
  );
  return result.rows[0];
}

module.exports = {
  createMessage,
  listMessages,
  getMessageById,
  markRead,
  archiveMessage,
  softDeleteMessage,
  restoreMessage,
};
