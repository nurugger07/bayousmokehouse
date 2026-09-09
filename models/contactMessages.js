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

module.exports = { createMessage };
