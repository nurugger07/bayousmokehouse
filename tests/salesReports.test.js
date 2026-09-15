const { pool } = require('../config/db');
const {
  getSalesTotalsByLocation,
  getItemSalesByLocation,
  getTopItems,
  getTaxTotalsByLocation,
  getTipTotalsByLocation,
} = require('../models/salesReports');

async function createLocation(name, cityState) {
  const result = await pool.query('INSERT INTO sales_locations (name, city_state) VALUES ($1, $2) RETURNING *', [
    name,
    cityState || null,
  ]);
  return result.rows[0];
}

async function createSalesDay({ saleDate, locationId, summary }) {
  const result = await pool.query(
    `INSERT INTO sales_days (sale_date, location_id, location_source, calendar_event_summary)
     VALUES ($1, $2, 'calendar', $3)
     RETURNING *`,
    [saleDate, locationId, summary]
  );
  return result.rows[0];
}

async function createOrder({ salesDayId, totalCents, taxCents, tipCents, items = [] }) {
  const order = await pool.query(
    `INSERT INTO square_orders
        (square_order_id, sales_day_id, ordered_at, subtotal_money_cents, tax_money_cents, tip_money_cents, total_money_cents)
     VALUES ($1, $2, now(), $3, $4, $5, $6)
     RETURNING *`,
    [`sq_${Math.random().toString(36).slice(2)}`, salesDayId, totalCents - taxCents - tipCents, taxCents, tipCents, totalCents]
  );

  for (const item of items) {
    await pool.query(
      `INSERT INTO square_order_line_items (square_order_id, name, quantity, total_money_cents)
       VALUES ($1, $2, $3, $4)`,
      [order.rows[0].id, item.name, item.quantity, item.totalCents]
    );
  }

  return order.rows[0];
}

// Berthoud Brewery visited twice (both Fridays), Odd13 Brewing once
// (a Saturday), plus a third Berthoud Friday visit with no orders yet
// (calendar-synced but no sales data) to exercise the LEFT JOIN.
async function seedData() {
  const [berthoud, odd13] = await Promise.all([
    createLocation('Bayou Smokehouse @ Berthoud Brewery', 'Berthoud, CO'),
    createLocation('Bayou Smokehouse @ Odd13 Brewing', 'Fort Collins, CO'),
  ]);

  const [berthoudVisit1, berthoudVisit2, , odd13Visit] = await Promise.all([
    createSalesDay({ saleDate: '2026-08-14', locationId: berthoud.id, summary: berthoud.name }),
    createSalesDay({ saleDate: '2026-08-21', locationId: berthoud.id, summary: berthoud.name }),
    createSalesDay({ saleDate: '2026-08-28', locationId: berthoud.id, summary: berthoud.name }), // no orders
    createSalesDay({ saleDate: '2026-08-15', locationId: odd13.id, summary: odd13.name }),
  ]);

  await Promise.all([
    createOrder({
      salesDayId: berthoudVisit1.id,
      totalCents: 2500,
      taxCents: 200,
      tipCents: 300,
      items: [{ name: 'Pork Belly Sliders', quantity: 2, totalCents: 2500 }],
    }),
    createOrder({
      salesDayId: berthoudVisit2.id,
      totalCents: 1500,
      taxCents: 100,
      tipCents: 150,
      items: [{ name: 'Pork Belly Sliders', quantity: 1, totalCents: 1500 }],
    }),
    createOrder({
      salesDayId: odd13Visit.id,
      totalCents: 1000,
      taxCents: 80,
      tipCents: 100,
      items: [{ name: 'Jambalaya', quantity: 1, totalCents: 1000 }],
    }),
  ]);

  return { berthoud, odd13 };
}

// All tests in this file are read-only queries against the same fixture,
// so it's seeded once for the whole file rather than per-test — cuts this
// file's DB round-trips roughly 7x, which matters because this pool is
// shared with the rest of the (sequential, --runInBand) suite.
let seeded;

beforeAll(async () => {
  seeded = await seedData();
});

afterAll(async () => {
  await pool.query('TRUNCATE square_order_line_items, square_orders, sales_days, sales_locations RESTART IDENTITY CASCADE');
  await pool.end();
});

describe('getSalesTotalsByLocation', () => {
  it('totals sales by location and day of week, with a visit count that includes days with no orders yet', async () => {
    const { berthoud, odd13 } = seeded;

    const rows = await getSalesTotalsByLocation({ startDate: '2026-08-01', endDate: '2026-08-31' });

    const berthoudFriday = rows.find((r) => r.location_id === berthoud.id);
    expect(berthoudFriday.day_of_week).toBe(5); // ISODOW: Friday
    expect(berthoudFriday.dayOfWeekLabel).toBe('Friday');
    expect(berthoudFriday.visit_count).toBe('3');
    expect(berthoudFriday.order_count).toBe('2');
    expect(berthoudFriday.total_money_cents).toBe('4000');

    const odd13Saturday = rows.find((r) => r.location_id === odd13.id);
    expect(odd13Saturday.day_of_week).toBe(6); // ISODOW: Saturday
    expect(odd13Saturday.visit_count).toBe('1');
    expect(odd13Saturday.total_money_cents).toBe('1000');
  });

  it('filters by locationId', async () => {
    const { berthoud } = seeded;

    const rows = await getSalesTotalsByLocation({ startDate: '2026-08-01', endDate: '2026-08-31', locationId: berthoud.id });

    expect(rows).toHaveLength(1);
    expect(rows[0].location_id).toBe(berthoud.id);
  });

  it('filters by date range, excluding visits outside it', async () => {
    const { berthoud } = seeded;

    const rows = await getSalesTotalsByLocation({ startDate: '2026-08-14', endDate: '2026-08-14' });

    expect(rows).toHaveLength(1);
    expect(rows[0].location_id).toBe(berthoud.id);
    expect(rows[0].visit_count).toBe('1');
    expect(rows[0].total_money_cents).toBe('2500');
  });
});

describe('getItemSalesByLocation', () => {
  it('sums item quantity and revenue across visits at the same location and day of week', async () => {
    const { berthoud, odd13 } = seeded;

    const rows = await getItemSalesByLocation({ startDate: '2026-08-01', endDate: '2026-08-31' });

    const sliders = rows.find((r) => r.location_id === berthoud.id && r.item_name === 'Pork Belly Sliders');
    expect(sliders.quantity_sold).toBe(3);
    expect(sliders.total_money_cents).toBe('4000');

    const jambalaya = rows.find((r) => r.location_id === odd13.id && r.item_name === 'Jambalaya');
    expect(jambalaya.quantity_sold).toBe(1);
  });

  it('excludes sales days with no orders (inner join, not left join)', async () => {
    const { berthoud } = seeded;

    const rows = await getItemSalesByLocation({ startDate: '2026-08-28', endDate: '2026-08-28' });

    expect(rows).toHaveLength(0);
  });
});

describe('getTaxTotalsByLocation', () => {
  it('totals tax by city/state (not individual venue) without a day-of-week split', async () => {
    const rows = await getTaxTotalsByLocation({ startDate: '2026-08-01', endDate: '2026-08-31' });

    expect(rows.find((r) => r.city_state === 'Berthoud, CO')).not.toHaveProperty('day_of_week');
    expect(rows.find((r) => r.city_state === 'Berthoud, CO').tax_money_cents).toBe('300');
    expect(rows.find((r) => r.city_state === 'Fort Collins, CO').tax_money_cents).toBe('80');
  });

  it('merges two venues that share a city/state into one row', async () => {
    const [venueA, venueB] = await Promise.all([
      createLocation('Bayou Smokehouse @ Venue A', 'Loveland, CO'),
      createLocation('Bayou Smokehouse @ Venue B', 'Loveland, CO'),
    ]);
    const [dayA, dayB] = await Promise.all([
      createSalesDay({ saleDate: '2026-08-24', locationId: venueA.id, summary: venueA.name }),
      createSalesDay({ saleDate: '2026-08-25', locationId: venueB.id, summary: venueB.name }),
    ]);
    await Promise.all([
      createOrder({ salesDayId: dayA.id, totalCents: 500, taxCents: 40, tipCents: 0, items: [] }),
      createOrder({ salesDayId: dayB.id, totalCents: 700, taxCents: 60, tipCents: 0, items: [] }),
    ]);

    const rows = await getTaxTotalsByLocation({ startDate: '2026-08-24', endDate: '2026-08-25' });

    expect(rows).toHaveLength(1);
    expect(rows[0].city_state).toBe('Loveland, CO');
    expect(rows[0].visit_count).toBe('2');
    expect(rows[0].tax_money_cents).toBe('100');
  });

  it('falls back to the venue name when city_state could not be parsed', async () => {
    const noAddress = await createLocation('Bayou Smokehouse @ No Address Venue', null);
    const day = await createSalesDay({ saleDate: '2026-08-26', locationId: noAddress.id, summary: noAddress.name });
    await createOrder({ salesDayId: day.id, totalCents: 300, taxCents: 25, tipCents: 0, items: [] });

    const rows = await getTaxTotalsByLocation({ startDate: '2026-08-26', endDate: '2026-08-26' });

    expect(rows).toHaveLength(1);
    expect(rows[0].city_state).toBe('Bayou Smokehouse @ No Address Venue');
  });
});

describe('getTopItems', () => {
  it('returns the top N items by revenue across the date range, ignoring location grouping', async () => {
    const topItems = await getTopItems({ startDate: '2026-08-01', endDate: '2026-08-31', limit: 5 });

    expect(topItems[0].item_name).toBe('Pork Belly Sliders');
    expect(topItems[0].quantity_sold).toBe(3);
    expect(topItems[0].total_money_cents).toBe('4000');
    expect(topItems[1].item_name).toBe('Jambalaya');
    expect(topItems[1].quantity_sold).toBe(1);
  });

  it('respects the locationId filter', async () => {
    const { odd13 } = seeded;

    const topItems = await getTopItems({ startDate: '2026-08-01', endDate: '2026-08-31', locationId: odd13.id, limit: 5 });

    expect(topItems).toHaveLength(1);
    expect(topItems[0].item_name).toBe('Jambalaya');
  });
});

describe('getTipTotalsByLocation', () => {
  it('totals tips by location and day of week', async () => {
    const { berthoud, odd13 } = seeded;

    const rows = await getTipTotalsByLocation({ startDate: '2026-08-01', endDate: '2026-08-31' });

    expect(rows.find((r) => r.location_id === berthoud.id).tip_money_cents).toBe('450');
    expect(rows.find((r) => r.location_id === odd13.id).tip_money_cents).toBe('100');
  });
});
