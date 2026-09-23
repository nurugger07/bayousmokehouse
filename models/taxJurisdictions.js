const { pool } = require('../config/db');

async function listJurisdictions() {
  const result = await pool.query('SELECT * FROM tax_jurisdictions ORDER BY level, name');
  return result.rows;
}

async function getJurisdictionById(id) {
  const result = await pool.query('SELECT * FROM tax_jurisdictions WHERE id = $1', [id]);
  return result.rows[0];
}

async function createJurisdiction(fields) {
  const result = await pool.query(
    `INSERT INTO tax_jurisdictions
        (name, level, tax_rate_percent, schedule, day_of_month_due, is_home_rule,
         payment_link, license_number, license_drive_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      fields.name,
      fields.level,
      fields.taxRatePercent,
      fields.schedule,
      fields.dayOfMonthDue,
      fields.isHomeRule || false,
      fields.paymentLink || null,
      fields.licenseNumber || null,
      fields.licenseDriveUrl || null,
    ]
  );
  return result.rows[0];
}

async function updateJurisdiction(id, fields) {
  const result = await pool.query(
    `UPDATE tax_jurisdictions SET
        name = $2,
        level = $3,
        tax_rate_percent = $4,
        schedule = $5,
        day_of_month_due = $6,
        is_home_rule = $7,
        payment_link = $8,
        license_number = $9,
        license_drive_url = $10,
        updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      fields.name,
      fields.level,
      fields.taxRatePercent,
      fields.schedule,
      fields.dayOfMonthDue,
      fields.isHomeRule || false,
      fields.paymentLink || null,
      fields.licenseNumber || null,
      fields.licenseDriveUrl || null,
    ]
  );
  return result.rows[0];
}

// Jurisdictions currently linked to a location, e.g. what shows on that
// location's edit form as pre-checked.
async function listJurisdictionsForLocation(locationId) {
  const result = await pool.query(
    `SELECT j.* FROM tax_jurisdictions j
     JOIN location_tax_jurisdictions ltj ON ltj.jurisdiction_id = j.id
     WHERE ltj.location_id = $1
     ORDER BY j.level, j.name`,
    [locationId]
  );
  return result.rows;
}

// Replaces the full set of jurisdictions linked to a location with
// jurisdictionIds — simpler for a checkbox-list form than diffing
// individual add/remove actions, and this relationship changes rarely.
async function setLocationJurisdictions(locationId, jurisdictionIds) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM location_tax_jurisdictions WHERE location_id = $1', [locationId]);
    for (const jurisdictionId of jurisdictionIds) {
      await client.query(
        'INSERT INTO location_tax_jurisdictions (location_id, jurisdiction_id) VALUES ($1, $2)',
        [locationId, jurisdictionId]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// All location->jurisdiction links at once, grouped by location_id, so
// a locations list page can show each one's jurisdictions without an
// N+1 query per row.
async function listJurisdictionIdsByLocation() {
  const result = await pool.query('SELECT location_id, jurisdiction_id FROM location_tax_jurisdictions');
  const byLocation = new Map();
  result.rows.forEach((row) => {
    if (!byLocation.has(row.location_id)) {
      byLocation.set(row.location_id, []);
    }
    byLocation.get(row.location_id).push(row.jurisdiction_id);
  });
  return byLocation;
}

module.exports = {
  listJurisdictions,
  getJurisdictionById,
  createJurisdiction,
  updateJurisdiction,
  listJurisdictionsForLocation,
  setLocationJurisdictions,
  listJurisdictionIdsByLocation,
};
