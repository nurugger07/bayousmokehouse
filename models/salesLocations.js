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

// Manual correction for a location's city_state — needed because it's
// only ever parsed once, at creation (see findOrCreateByName above), so
// fixing the calendar event's address later and re-syncing does NOT
// retroactively fix an already-created location's city_state. This is
// the durable fix for that: re-parse it here, or type in the right
// value directly if the address still won't parse into "City, ST".
async function updateCityState(id, cityState) {
  const result = await pool.query(
    'UPDATE sales_locations SET city_state = $2 WHERE id = $1 RETURNING *',
    [id, cityState || null]
  );
  return result.rows[0];
}

async function getLocationById(id) {
  const result = await pool.query('SELECT * FROM sales_locations WHERE id = $1', [id]);
  return result.rows[0];
}

// Renaming only changes what's displayed — it does NOT change how
// future syncs match calendar events. If Johnny keeps typing the old
// name in the calendar going forward, the next sync recreates it,
// since findOrCreateByName matches on whatever text the event has.
// Blocked (not silently merged) if another location already has that
// name — merge is the deliberate operation for combining two, not a
// side effect of a rename.
async function renameLocation(id, newName) {
  const trimmed = newName.trim();

  const collision = await pool.query('SELECT id FROM sales_locations WHERE lower(name) = lower($1) AND id != $2', [
    trimmed,
    id,
  ]);
  if (collision.rows[0]) {
    const err = new Error(`Another location is already named "${trimmed}" — use Merge instead of renaming.`);
    err.code = 'DUPLICATE_NAME';
    throw err;
  }

  const result = await pool.query('UPDATE sales_locations SET name = $2 WHERE id = $1 RETURNING *', [id, trimmed]);
  return result.rows[0];
}

// Combines a duplicate location into a target: every sales_days row
// pointing at the duplicate is reassigned to the target, then the
// duplicate is deleted. Transactional — a merge is destructive and
// hard to undo, so it must not partially apply. The target's own
// name/city_state are left untouched; fix those separately if needed.
async function mergeLocations(duplicateId, targetId) {
  if (Number(duplicateId) === Number(targetId)) {
    throw new Error('Cannot merge a location into itself.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE sales_days SET location_id = $2 WHERE location_id = $1', [duplicateId, targetId]);
    const deleted = await client.query('DELETE FROM sales_locations WHERE id = $1 RETURNING *', [duplicateId]);
    await client.query('COMMIT');
    return deleted.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  findOrCreateByName,
  listLocations,
  updateCityState,
  getLocationById,
  renameLocation,
  mergeLocations,
};
