const { formatInTimeZone } = require('date-fns-tz');
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
        l.city_state AS city_state,
        EXTRACT(ISODOW FROM sd.sale_date)::int AS day_of_week,
        COUNT(DISTINCT sd.id) AS visit_count,
        COUNT(o.id) AS order_count,
        COALESCE(SUM(o.total_money_cents), 0)::bigint AS total_money_cents
     FROM sales_days sd
     JOIN sales_locations l ON l.id = sd.location_id
     LEFT JOIN square_orders o ON o.sales_day_id = sd.id
     WHERE sd.sale_date BETWEEN $1 AND $2
       AND ($3::int IS NULL OR l.id = $3)
     GROUP BY l.id, l.name, l.city_state, EXTRACT(ISODOW FROM sd.sale_date)
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
        l.city_state AS city_state,
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
     GROUP BY l.id, l.name, l.city_state, EXTRACT(ISODOW FROM sd.sale_date), li.name
     ORDER BY l.name, day_of_week, total_money_cents DESC`,
    [startDate, endDate, locationId || null]
  );
  return withDayOfWeekLabel(result.rows);
}

// Top N items by revenue across whatever the date range/location filter
// selects — independent of the day-of-week/location breakdown above.
async function getTopItems({ startDate, endDate, locationId, limit = 5 } = {}) {
  const result = await pool.query(
    `SELECT
        li.name AS item_name,
        SUM(li.quantity)::int AS quantity_sold,
        COALESCE(SUM(li.total_money_cents), 0)::bigint AS total_money_cents
     FROM sales_days sd
     JOIN square_orders o ON o.sales_day_id = sd.id
     JOIN square_order_line_items li ON li.square_order_id = o.id
     WHERE sd.sale_date BETWEEN $1 AND $2
       AND ($3::int IS NULL OR sd.location_id = $3)
     GROUP BY li.name
     ORDER BY total_money_cents DESC
     LIMIT $4`,
    [startDate, endDate, locationId || null, limit]
  );
  return result.rows;
}

// Tax totals grouped by city/state, not individual venue — sales tax is
// a city/county-level jurisdiction concern, not a per-venue one, and
// multiple venues can share a jurisdiction. Locations with no parseable
// address fall back to grouping under their own name so nothing is lost.
async function getTaxTotalsByLocation({ startDate, endDate, locationId } = {}) {
  const result = await pool.query(
    `SELECT
        COALESCE(l.city_state, l.name) AS city_state,
        COUNT(DISTINCT sd.id) AS visit_count,
        COUNT(o.id) AS order_count,
        COALESCE(SUM(o.tax_money_cents), 0)::bigint AS tax_money_cents
     FROM sales_days sd
     JOIN sales_locations l ON l.id = sd.location_id
     LEFT JOIN square_orders o ON o.sales_day_id = sd.id
     WHERE sd.sale_date BETWEEN $1 AND $2
       AND ($3::int IS NULL OR l.id = $3)
     GROUP BY COALESCE(l.city_state, l.name)
     ORDER BY COALESCE(l.city_state, l.name)`,
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
        l.city_state AS city_state,
        EXTRACT(ISODOW FROM sd.sale_date)::int AS day_of_week,
        COUNT(DISTINCT sd.id) AS visit_count,
        COUNT(o.id) AS order_count,
        COALESCE(SUM(o.tip_money_cents), 0)::bigint AS tip_money_cents
     FROM sales_days sd
     JOIN sales_locations l ON l.id = sd.location_id
     LEFT JOIN square_orders o ON o.sales_day_id = sd.id
     WHERE sd.sale_date BETWEEN $1 AND $2
       AND ($3::int IS NULL OR l.id = $3)
     GROUP BY l.id, l.name, l.city_state, EXTRACT(ISODOW FROM sd.sale_date)
     ORDER BY l.name, day_of_week`,
    [startDate, endDate, locationId || null]
  );
  return withDayOfWeekLabel(result.rows);
}

// Weeks are simple 7-day chunks of the calendar month (days 1-7, 8-14,
// ...), not aligned to any day-of-week — matching how Johnny's own
// manual spreadsheet version of this report already buckets weeks.
// Returns/orders are aggregated separately (a week can have returns
// with zero new sales) then combined with a FULL OUTER JOIN.
async function getWeeklyTotals({ startDate, endDate } = {}) {
  const result = await pool.query(
    `WITH orders_agg AS (
        SELECT
          date_trunc('month', (o.ordered_at AT TIME ZONE 'America/Denver'))::date AS month_start,
          ((EXTRACT(DAY FROM (o.ordered_at AT TIME ZONE 'America/Denver'))::int - 1) / 7) AS week_index,
          COUNT(*)::int AS order_count,
          COALESCE(SUM(o.total_money_cents - o.tip_money_cents - o.tax_money_cents
                       - o.service_charge_money_cents + o.discount_money_cents), 0)::bigint AS gross_sales_cents,
          COALESCE(SUM(o.discount_money_cents), 0)::bigint AS discount_cents,
          COALESCE(SUM(o.tax_money_cents), 0)::bigint AS tax_cents
        FROM square_orders o
        WHERE (o.ordered_at AT TIME ZONE 'America/Denver')::date BETWEEN $1 AND $2
        GROUP BY 1, 2
     ),
     returns_agg AS (
        SELECT
          date_trunc('month', (r.returned_at AT TIME ZONE 'America/Denver'))::date AS month_start,
          ((EXTRACT(DAY FROM (r.returned_at AT TIME ZONE 'America/Denver'))::int - 1) / 7) AS week_index,
          COALESCE(SUM(r.return_money_cents), 0)::bigint AS return_cents
        FROM square_returns r
        WHERE (r.returned_at AT TIME ZONE 'America/Denver')::date BETWEEN $1 AND $2
        GROUP BY 1, 2
     )
     SELECT
        COALESCE(o.month_start, r.month_start) AS month_start,
        COALESCE(o.week_index, r.week_index) AS week_index,
        COALESCE(o.order_count, 0) AS order_count,
        COALESCE(o.gross_sales_cents, 0) AS gross_sales_cents,
        COALESCE(o.discount_cents, 0) AS discount_cents,
        COALESCE(r.return_cents, 0) AS return_cents,
        COALESCE(o.tax_cents, 0) AS tax_cents
     FROM orders_agg o
     FULL OUTER JOIN returns_agg r ON r.month_start = o.month_start AND r.week_index = o.week_index
     ORDER BY 1, 2`,
    [startDate, endDate]
  );
  return result.rows;
}

// Number of days in the UTC-midnight month a pg DATE column deserializes
// to — explicit UTC getters, not date-fns's local-time ones, since a
// server whose local TZ isn't UTC would otherwise read the wrong month
// for a date near midnight (the same "fake-UTC" trap services/googleCalendar.js
// documents).
function daysInMonthUTC(monthStart) {
  return new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate();
}

function weekLabel(monthStart, weekIndex) {
  const startDay = weekIndex * 7 + 1;
  const endDay = Math.min(startDay + 6, daysInMonthUTC(monthStart));
  const month = monthStart.getUTCMonth() + 1;
  return `${month}/${startDay}-${month}/${endDay}`;
}

// Shapes the flat getWeeklyTotals() rows into month sections with a
// totals row per month. Split out from the query itself so the
// month/week grouping and rollup math can be unit tested without a DB.
function groupWeeklyTotalsByMonth(rows) {
  const monthsByKey = new Map();

  rows.forEach((row) => {
    const key = row.month_start.toISOString();
    if (!monthsByKey.has(key)) {
      monthsByKey.set(key, { monthStart: row.month_start, weeks: [] });
    }

    const grossSalesCents = Number(row.gross_sales_cents);
    const discountCents = Number(row.discount_cents);
    const returnCents = Number(row.return_cents);
    const orderCount = Number(row.order_count);

    monthsByKey.get(key).weeks.push({
      weekIndex: row.week_index,
      label: weekLabel(row.month_start, row.week_index),
      orderCount,
      grossSalesCents,
      discountCents,
      returnCents,
      netSalesCents: grossSalesCents - discountCents - returnCents,
      avgOrderAmtCents: orderCount > 0 ? Math.round(grossSalesCents / orderCount) : 0,
      taxCents: Number(row.tax_cents),
    });
  });

  return Array.from(monthsByKey.values())
    .sort((a, b) => a.monthStart - b.monthStart)
    .map((month) => {
      const weeks = month.weeks.sort((a, b) => a.weekIndex - b.weekIndex);
      const sum = (field) => weeks.reduce((total, week) => total + week[field], 0);
      const totalGrossSalesCents = sum('grossSalesCents');
      const totalDiscountCents = sum('discountCents');
      const totalReturnCents = sum('returnCents');

      return {
        monthLabel: formatInTimeZone(month.monthStart, 'UTC', 'MMMM'),
        weeks,
        totals: {
          orderCount: sum('orderCount'),
          grossSalesCents: totalGrossSalesCents,
          // Matches Johnny's own spreadsheet: the monthly row's average is
          // the average of the weekly averages, not gross/orders.
          avgOrderAmtCents: weeks.length > 0 ? Math.round(sum('avgOrderAmtCents') / weeks.length) : 0,
          discountCents: totalDiscountCents,
          returnCents: totalReturnCents,
          netSalesCents: totalGrossSalesCents - totalDiscountCents - totalReturnCents,
          taxCents: sum('taxCents'),
        },
      };
    });
}

module.exports = {
  getSalesTotalsByLocation,
  getItemSalesByLocation,
  getTopItems,
  getTaxTotalsByLocation,
  getTipTotalsByLocation,
  getWeeklyTotals,
  groupWeeklyTotalsByMonth,
};
