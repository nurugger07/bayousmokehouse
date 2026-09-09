const { pool } = require('../config/db');

async function createMessage({ name, email, phone, message, category }) {
  // Column list is built from fixed, hardcoded names only (never from
  // user input) — safe to interpolate; values stay fully parameterized.
  const columns = ['name', 'email', 'phone', 'message'];
  const values = [name, email, phone || null, message];

  if (category) {
    columns.push('category');
    values.push(category);
  }

  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

  const result = await pool.query(
    `INSERT INTO contact_messages (${columns.join(', ')})
     VALUES (${placeholders})
     RETURNING *`,
    values
  );

  return result.rows[0];
}

async function listMessages({ status = 'unread', category } = {}) {
  const conditions = [];
  const params = [];

  if (status === 'deleted') {
    conditions.push('deleted_at IS NOT NULL');
  } else {
    conditions.push('deleted_at IS NULL');
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }

  const result = await pool.query(
    `SELECT * FROM contact_messages
     WHERE ${conditions.join(' AND ')}
     ORDER BY submitted_at DESC`,
    params
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
