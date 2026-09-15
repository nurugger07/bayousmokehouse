const { pool } = require('../config/db');

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function withDayOfWeekLabel(rows) {
  return rows.map((row) => ({ ...row, dayOfWeekLabel: DAY_NAMES[row.day_of_week - 1] }));
}

// Sales totals by location and day of week, plus a visit count
// (distinct sales_days rows — one per calendar-event "stop") so
// "how many times was I at X" is answered directly alongside totals.
async function getSalesTotalsByLocation({ startDate, endDate, locationId } = {}) {
  const result = await pool.query(
    `SELECT
        l.id AS location_id,
        l.name AS location_name,
        EXTRACT(ISODOW FROM sd.sale_date)::int AS day_of_week,
        COUNT(DISTINCT sd.id) AS visit_count,
        COUNT(o.id) AS order_count,
        COALESCE(SUM(o.total_money_cents), 0)::bigint AS total_money_cents
     FROM sales_days sd
     JOIN sales_locations l ON l.id = sd.location_id
     LEFT JOIN square_orders o ON o.sales_day_id = sd.id
     WHERE sd.sale_date BETWEEN $1 AND $2
       AND ($3::int IS NULL OR l.id = $3)
     GROUP BY l.id, l.name, EXTRACT(ISODOW FROM sd.sale_date)
     ORDER BY l.name, day_of_week`,
    [startDate, endDate, locationId || null]
  );
  return withDayOfWeekLabel(result.rows);
}

// Item quantity/revenue by location and day of week. Inner-joins
// (unlike the other reports) — a day/order with no line items simply
// contributes no rows, which is correct for an item breakdown.
async function getItemSalesByLocation({ startDate, endDate, locationId } = {}) {
  const result = await pool.query(
    `SELECT
        l.id AS location_id,
        l.name AS location_name,
        EXTRACT(ISODOW FROM sd.sale_date)::int AS day_of_week,
        li.name AS item_name,
        SUM(li.quantity)::int AS quantity_sold,
        COALESCE(SUM(li.total_money_cents), 0)::bigint AS total_money_cents
     FROM sales_days sd
     JOIN sales_locations l ON l.id = sd.location_id
     JOIN square_orders o ON o.sales_day_id = sd.id
     JOIN square_order_line_items li ON li.square_order_id = o.id
     WHERE sd.sale_date BETWEEN $1 AND $2
       AND ($3::int IS NULL OR l.id = $3)
     GROUP BY l.id, l.name, EXTRACT(ISODOW FROM sd.sale_date), li.name
     ORDER BY l.name, day_of_week, total_money_cents DESC`,
    [startDate, endDate, locationId || null]
  );
  return withDayOfWeekLabel(result.rows);
}

// Tax totals by location — no day-of-week split, per Johnny's report list.
async function getTaxTotalsByLocation({ startDate, endDate, locationId } = {}) {
  const result = await pool.query(
    `SELECT
        l.id AS location_id,
        l.name AS location_name,
        COUNT(DISTINCT sd.id) AS visit_count,
        COUNT(o.id) AS order_count,
        COALESCE(SUM(o.tax_money_cents), 0)::bigint AS tax_money_cents
     FROM sales_days sd
     JOIN sales_locations l ON l.id = sd.location_id
     LEFT JOIN square_orders o ON o.sales_day_id = sd.id
     WHERE sd.sale_date BETWEEN $1 AND $2
       AND ($3::int IS NULL OR l.id = $3)
     GROUP BY l.id, l.name
     ORDER BY l.name`,
    [startDate, endDate, locationId || null]
  );
  return result.rows;
}

// Tip totals by location and day of week.
async function getTipTotalsByLocation({ startDate, endDate, locationId } = {}) {
  const result = await pool.query(
    `SELECT
        l.id AS location_id,
        l.name AS location_name,
        EXTRACT(ISODOW FROM sd.sale_date)::int AS day_of_week,
        COUNT(DISTINCT sd.id) AS visit_count,
        COUNT(o.id) AS order_count,
        COALESCE(SUM(o.tip_money_cents), 0)::bigint AS tip_money_cents
     FROM sales_days sd
     JOIN sales_locations l ON l.id = sd.location_id
     LEFT JOIN square_orders o ON o.sales_day_id = sd.id
     WHERE sd.sale_date BETWEEN $1 AND $2
       AND ($3::int IS NULL OR l.id = $3)
     GROUP BY l.id, l.name, EXTRACT(ISODOW FROM sd.sale_date)
     ORDER BY l.name, day_of_week`,
    [startDate, endDate, locationId || null]
  );
  return withDayOfWeekLabel(result.rows);
}

module.exports = {
  getSalesTotalsByLocation,
  getItemSalesByLocation,
  getTaxTotalsByLocation,
  getTipTotalsByLocation,
};
