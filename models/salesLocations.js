const { pool } = require('../config/db');

// Trimmed, case-insensitive match against the calendar event's own
// title text — Johnny keeps event naming consistent, so this is
// sufficient without an alias table. First time a name is seen it
// becomes the canonical sales_locations row.
async function findOrCreateByName(name) {
  const trimmed = name.trim();

  const existing = await pool.query('SELECT * FROM sales_locations WHERE lower(name) = lower($1)', [trimmed]);
  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const inserted = await pool.query(
    `INSERT INTO sales_locations (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING *`,
    [trimmed]
  );
  return inserted.rows[0];
}

async function listLocations() {
  const result = await pool.query('SELECT * FROM sales_locations ORDER BY name');
  return result.rows;
}

module.exports = { findOrCreateByName, listLocations };
