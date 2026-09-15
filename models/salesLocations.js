const { pool } = require('../config/db');
const { getShortLocation } = require('../services/googleCalendar');

// Trimmed, case-insensitive match against the calendar event's own
// title text — Johnny keeps event naming consistent, so this is
// sufficient without an alias table. First time a name is seen it
// becomes the canonical sales_locations row, and cityState (parsed
// from that event's address, same parser the public site's schedule
// uses) is captured then — later syncs never touch it again.
async function findOrCreateByName(name, address) {
  const trimmed = name.trim();

  const existing = await pool.query('SELECT * FROM sales_locations WHERE lower(name) = lower($1)', [trimmed]);
  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const cityState = getShortLocation(address);

  const inserted = await pool.query(
    `INSERT INTO sales_locations (name, city_state) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING *`,
    [trimmed, cityState]
  );
  return inserted.rows[0];
}

async function listLocations() {
  const result = await pool.query('SELECT * FROM sales_locations ORDER BY name');
  return result.rows;
}

module.exports = { findOrCreateByName, listLocations };
