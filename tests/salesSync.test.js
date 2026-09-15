jest.mock('../services/googleCalendar', () => ({
  getEventsForDateRange: jest.fn(),
}));
jest.mock('../services/square', () => ({
  searchOrders: jest.fn(),
  listPayments: jest.fn(),
}));

const { fromZonedTime } = require('date-fns-tz');
const { pool } = require('../config/db');
const { getEventsForDateRange } = require('../services/googleCalendar');
const { searchOrders, listPayments } = require('../services/square');
const { syncDateRange, getYesterdayRange } = require('../services/salesSync');
const salesDaysModel = require('../models/salesDays');
const salesLocationsModel = require('../models/salesLocations');

// syncDateRange expects Denver-day-aligned boundaries, same as its two
// real callers (getYesterdayRange and the CLI's --from/--to parsing) —
// naive UTC-midnight strings would straddle a Denver calendar day and
// pull in a neighboring, unrelated day.
function denverDayRange(dateStr) {
  return {
    startDate: fromZonedTime(`${dateStr}T00:00:00`, 'America/Denver'),
    endDate: fromZonedTime(`${dateStr}T23:59:59.999`, 'America/Denver'),
  };
}

afterEach(async () => {
  jest.clearAllMocks();
  await pool.query('TRUNCATE square_order_line_items, square_orders, sales_days, sales_locations RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await pool.end();
});

describe('syncDateRange', () => {
  it('creates a location + sales day from a single calendar event and syncs that day\'s order under it', async () => {
    getEventsForDateRange.mockResolvedValueOnce([
      {
        date: '2026-08-14',
        summary: 'Bayou Smokehouse @ Berthoud Brewery',
        location: '321 Mountain Ave, Berthoud, CO',
        startTime: new Date('2026-08-14T22:00:00Z'),
        endTime: new Date('2026-08-15T03:00:00Z'),
      },
    ]);
    searchOrders.mockResolvedValueOnce([
      {
        id: 'sq_order_1',
        created_at: '2026-08-14T23:00:00Z',
        total_money: { amount: 2500 },
        total_tax_money: { amount: 200 },
        line_items: [{ name: 'Pork Belly Sliders', quantity: '2', total_money: { amount: 2500 } }],
      },
    ]);
    listPayments.mockResolvedValueOnce([{ order_id: 'sq_order_1', tip_money: { amount: 300 } }]);

    const result = await syncDateRange(denverDayRange('2026-08-14'));

    expect(result.syncedOrderCount).toBe(1);
    expect(result.unmatchedDayCount).toBe(0);

    const locations = await pool.query('SELECT * FROM sales_locations');
    expect(locations.rows).toHaveLength(1);
    expect(locations.rows[0].name).toBe('Bayou Smokehouse @ Berthoud Brewery');

    const orders = await pool.query('SELECT * FROM square_orders');
    expect(orders.rows).toHaveLength(1);
    expect(orders.rows[0].total_money_cents).toBe(2500);
    expect(orders.rows[0].tax_money_cents).toBe(200);
    expect(orders.rows[0].tip_money_cents).toBe(300);
    expect(orders.rows[0].subtotal_money_cents).toBe(2000);

    const lineItems = await pool.query('SELECT * FROM square_order_line_items');
    expect(lineItems.rows).toHaveLength(1);
    expect(lineItems.rows[0].name).toBe('Pork Belly Sliders');
    expect(lineItems.rows[0].quantity).toBe(2);
  });

  it('creates an unmatched sales day when a date has no calendar events, and syncs orders under it', async () => {
    getEventsForDateRange.mockResolvedValueOnce([]);
    searchOrders.mockResolvedValueOnce([
      {
        id: 'sq_order_2',
        created_at: '2026-08-15T20:00:00Z',
        total_money: { amount: 1000 },
        total_tax_money: { amount: 80 },
        line_items: [],
      },
    ]);
    listPayments.mockResolvedValueOnce([]);

    const result = await syncDateRange(denverDayRange('2026-08-15'));

    expect(result.unmatchedDayCount).toBe(1);
    expect(result.syncedOrderCount).toBe(1);

    const days = await pool.query('SELECT * FROM sales_days');
    expect(days.rows).toHaveLength(1);
    expect(days.rows[0].location_source).toBe('unmatched');
    expect(days.rows[0].location_id).toBeNull();

    const orders = await pool.query('SELECT * FROM square_orders WHERE sales_day_id = $1', [days.rows[0].id]);
    expect(orders.rows).toHaveLength(1);
  });

  it('attributes orders on a multi-event day to the event whose time window they fall inside', async () => {
    getEventsForDateRange.mockResolvedValueOnce([
      {
        date: '2026-08-16',
        summary: 'Bayou Smokehouse @ Lunch Spot',
        startTime: new Date('2026-08-16T17:00:00Z'),
        endTime: new Date('2026-08-16T19:00:00Z'),
      },
      {
        date: '2026-08-16',
        summary: 'Bayou Smokehouse @ Dinner Brewery',
        startTime: new Date('2026-08-16T23:00:00Z'),
        endTime: new Date('2026-08-17T03:00:00Z'),
      },
    ]);
    searchOrders.mockResolvedValueOnce([
      {
        id: 'sq_lunch_order',
        created_at: '2026-08-16T18:00:00Z',
        total_money: { amount: 1200 },
        total_tax_money: { amount: 100 },
        line_items: [],
      },
      {
        id: 'sq_dinner_order',
        created_at: '2026-08-17T00:00:00Z',
        total_money: { amount: 1500 },
        total_tax_money: { amount: 120 },
        line_items: [],
      },
    ]);
    listPayments.mockResolvedValueOnce([]);

    await syncDateRange(denverDayRange('2026-08-16'));

    const days = await pool.query('SELECT * FROM sales_days ORDER BY calendar_event_summary');
    expect(days.rows).toHaveLength(2);

    const lunchDay = days.rows.find((d) => d.calendar_event_summary.includes('Lunch'));
    const dinnerDay = days.rows.find((d) => d.calendar_event_summary.includes('Dinner'));

    const lunchOrders = await pool.query('SELECT * FROM square_orders WHERE sales_day_id = $1', [lunchDay.id]);
    const dinnerOrders = await pool.query('SELECT * FROM square_orders WHERE sales_day_id = $1', [dinnerDay.id]);

    expect(lunchOrders.rows.map((o) => o.square_order_id)).toEqual(['sq_lunch_order']);
    expect(dinnerOrders.rows.map((o) => o.square_order_id)).toEqual(['sq_dinner_order']);
  });

  it('never overwrites a manually-corrected location when the same range is synced again', async () => {
    const calendarEvent = {
      date: '2026-08-18',
      summary: 'Bayou Smokehouse @ Some Venue',
      startTime: new Date('2026-08-18T22:00:00Z'),
      endTime: new Date('2026-08-19T03:00:00Z'),
    };
    const range = denverDayRange('2026-08-18');

    getEventsForDateRange.mockResolvedValueOnce([calendarEvent]);
    searchOrders.mockResolvedValueOnce([]);
    listPayments.mockResolvedValueOnce([]);
    await syncDateRange(range);

    const correctedLocation = await salesLocationsModel.findOrCreateByName('Corrected Venue Name');
    const [day] = (await pool.query('SELECT * FROM sales_days')).rows;
    await salesDaysModel.setLocation(day.id, correctedLocation.id);

    getEventsForDateRange.mockResolvedValueOnce([calendarEvent]);
    searchOrders.mockResolvedValueOnce([]);
    listPayments.mockResolvedValueOnce([]);
    await syncDateRange(range);

    const daysAfter = await pool.query('SELECT * FROM sales_days');
    expect(daysAfter.rows).toHaveLength(1);
    expect(daysAfter.rows[0].location_id).toBe(correctedLocation.id);
    expect(daysAfter.rows[0].location_source).toBe('manual');
  });

  it('is idempotent — re-syncing the same range updates rather than duplicates an order and its line items', async () => {
    getEventsForDateRange.mockResolvedValue([
      {
        date: '2026-08-19',
        summary: 'Bayou Smokehouse @ Repeat Venue',
        startTime: new Date('2026-08-19T22:00:00Z'),
        endTime: new Date('2026-08-20T03:00:00Z'),
      },
    ]);
    searchOrders.mockResolvedValue([
      {
        id: 'sq_repeat_order',
        created_at: '2026-08-19T23:00:00Z',
        total_money: { amount: 999 },
        total_tax_money: { amount: 80 },
        line_items: [{ name: 'Jambalaya', quantity: '1', total_money: { amount: 999 } }],
      },
    ]);
    listPayments.mockResolvedValue([]);

    const range = denverDayRange('2026-08-19');
    await syncDateRange(range);
    await syncDateRange(range);

    const orders = await pool.query('SELECT * FROM square_orders');
    expect(orders.rows).toHaveLength(1);

    const lineItems = await pool.query('SELECT * FROM square_order_line_items');
    expect(lineItems.rows).toHaveLength(1);
  });
});

describe('getYesterdayRange', () => {
  it('returns the full America/Denver calendar day before "now"', () => {
    const { startDate, endDate } = getYesterdayRange(new Date('2026-08-15T10:00:00Z'));

    expect(startDate.toISOString()).toBe('2026-08-14T06:00:00.000Z');
    expect(endDate.toISOString()).toBe('2026-08-15T05:59:59.999Z');
  });
});
