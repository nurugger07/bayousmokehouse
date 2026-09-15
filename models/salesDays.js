const { pool } = require('../config/db');

// One row per calendar event on a date. Only creates — never updates
// location_id/location_source on an existing row, so a prior sync's
// match or an admin's manual correction is never clobbered by a
// later sync of the same date range.
async function findOrCreateForEvent({ saleDate, calendarEventSummary, eventStartTime, eventEndTime, locationId }) {
  const existing = await pool.query(
    'SELECT * FROM sales_days WHERE sale_date = $1 AND calendar_event_summary = $2',
    [saleDate, calendarEventSummary]
  );
  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const inserted = await pool.query(
    `INSERT INTO sales_days (sale_date, location_id, location_source, calendar_event_summary, event_start_time, event_end_time)
     VALUES ($1, $2, 'calendar', $3, $4, $5)
     RETURNING *`,
    [saleDate, locationId, calendarEventSummary, eventStartTime, eventEndTime]
  );
  return inserted.rows[0];
}

// For a date with zero calendar events — Square still recorded sales
// that day, but we don't know where. calendar_event_summary stays
// NULL, so this can't rely on the (sale_date, calendar_event_summary)
// unique constraint (NULL never equals NULL); dedupe by checking first.
async function findOrCreateUnmatched({ saleDate }) {
  const existing = await pool.query(
    'SELECT * FROM sales_days WHERE sale_date = $1 AND calendar_event_summary IS NULL',
    [saleDate]
  );
  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const inserted = await pool.query(
    `INSERT INTO sales_days (sale_date, location_source)
     VALUES ($1, 'unmatched')
     RETURNING *`,
    [saleDate]
  );
  return inserted.rows[0];
}

async function listForDateRange({ startDate, endDate }) {
  const result = await pool.query(
    `SELECT * FROM sales_days
     WHERE sale_date BETWEEN $1 AND $2
     ORDER BY sale_date, event_start_time NULLS FIRST`,
    [startDate, endDate]
  );
  return result.rows;
}

async function listUnmatched() {
  const result = await pool.query(
    `SELECT * FROM sales_days
     WHERE location_id IS NULL
     ORDER BY sale_date DESC`
  );
  return result.rows;
}

async function setLocation(id, locationId) {
  const result = await pool.query(
    `UPDATE sales_days
     SET location_id = $2, location_source = 'manual', updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, locationId]
  );
  return result.rows[0];
}

module.exports = {
  findOrCreateForEvent,
  findOrCreateUnmatched,
  listForDateRange,
  listUnmatched,
  setLocation,
};
