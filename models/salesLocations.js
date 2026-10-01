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

// Same case-insensitive match as findOrCreateByName, but never creates —
// for callers (like the daily tax-toggle job) where an unrecognized name
// should be treated as "don't know this location" rather than silently
// adding a new one with no jurisdictions configured.
async function findByName(name) {
  const result = await pool.query('SELECT * FROM sales_locations WHERE lower(name) = lower($1)', [name.trim()]);
  return result.rows[0];
}

async function listLocations() {
  const result = await pool.query('SELECT * FROM sales_locations ORDER BY name');
  return result.rows;
}

async function getLocationById(id) {
  const result = await pool.query('SELECT * FROM sales_locations WHERE id = $1', [id]);
  return result.rows[0];
}

async function nameCollision(name, excludeId) {
  const result = await pool.query('SELECT id FROM sales_locations WHERE lower(name) = lower($1) AND id != $2', [
    name,
    excludeId || 0,
  ]);
  return Boolean(result.rows[0]);
}

// Manually adding a location (as opposed to one auto-created by the
// nightly sync the first time its calendar event is seen — see
// findOrCreateByName). Blocked on a name collision the same way
// renaming is, so there's one consistent "this name's taken" story.
async function createLocation({ name, cityState }) {
  const trimmed = (name || '').trim();
  if (await nameCollision(trimmed, null)) {
    const err = new Error(`A location named "${trimmed}" already exists.`);
    err.code = 'DUPLICATE_NAME';
    throw err;
  }

  const result = await pool.query(
    'INSERT INTO sales_locations (name, city_state) VALUES ($1, $2) RETURNING *',
    [trimmed, cityState || null]
  );
  return result.rows[0];
}

// Updating a location's name only changes what's displayed — it does
// NOT change how future syncs match calendar events. If Johnny keeps
// typing the old name in the calendar going forward, the next sync
// recreates it, since findOrCreateByName matches on whatever text the
// event has. Blocked (not silently merged) if another location already
// has that name — merge is the deliberate operation for combining two,
// not a side effect of an edit. city_state has no such retroactive
// behavior to worry about (see findOrCreateByName above for why it's
// only ever parsed once, at creation).
async function updateLocation(id, { name, cityState }) {
  const trimmed = (name || '').trim();
  if (await nameCollision(trimmed, id)) {
    const err = new Error(`Another location is already named "${trimmed}": use Merge instead of renaming.`);
    err.code = 'DUPLICATE_NAME';
    throw err;
  }

  const result = await pool.query(
    'UPDATE sales_locations SET name = $2, city_state = $3 WHERE id = $1 RETURNING *',
    [id, trimmed, cityState || null]
  );
  return result.rows[0];
}

// Deleting only makes sense for a location with no sales history —
// one with visits should be merged into another (or just left alone),
// never deleted outright, since that would silently orphan real sales
// data. Blocked the same way a colliding rename is blocked, with the
// same "use Merge instead" guidance.
async function deleteLocation(id) {
  const visitCount = await pool.query('SELECT count(*)::int AS count FROM sales_days WHERE location_id = $1', [id]);
  if (visitCount.rows[0].count > 0) {
    const err = new Error('This location has sales history: use Merge instead of deleting it.');
    err.code = 'HAS_SALES_HISTORY';
    throw err;
  }
  const result = await pool.query('DELETE FROM sales_locations WHERE id = $1 RETURNING *', [id]);
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
  findByName,
  listLocations,
  getLocationById,
  createLocation,
  updateLocation,
  deleteLocation,
  mergeLocations,
};
