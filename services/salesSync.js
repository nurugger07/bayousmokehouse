const { eachDayOfInterval, subDays, startOfDay, endOfDay } = require('date-fns');
const { toZonedTime, fromZonedTime, formatInTimeZone } = require('date-fns-tz');
const { getEventsForDateRange } = require('./googleCalendar');
const { searchOrders, listPayments } = require('./square');
const salesLocations = require('../models/salesLocations');
const salesDays = require('../models/salesDays');
const squareOrders = require('../models/squareOrders');

const TIME_ZONE = 'America/Denver';

// Orders outside every calendar event's window on a multi-event day
// still get attributed to the nearest one (e.g. a sale rung up a few
// minutes before doors opened) rather than left unmatched.
const EVENT_WINDOW_BUFFER_MS = 30 * 60 * 1000;

function listDateStrings(startDate, endDate) {
  const zonedStart = toZonedTime(startDate, TIME_ZONE);
  const zonedEnd = toZonedTime(endDate, TIME_ZONE);
  return eachDayOfInterval({ start: zonedStart, end: zonedEnd }).map((day) =>
    formatInTimeZone(day, 'UTC', 'yyyy-MM-dd')
  );
}

function groupByDateKey(rows, dateField, formatAsDateOnly) {
  const map = new Map();
  rows.forEach((row) => {
    const key = formatAsDateOnly
      ? formatInTimeZone(row[dateField], 'UTC', 'yyyy-MM-dd')
      : formatInTimeZone(new Date(row[dateField]), TIME_ZONE, 'yyyy-MM-dd');
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(row);
  });
  return map;
}

// Which sales_days row a given order belongs to. Single-event days are
// unambiguous; multi-event days match by whether the order falls inside
// that event's [start - buffer, end + buffer] window, falling back to
// whichever event's start time is closest.
function pickSalesDay(candidateDays, orderedAt) {
  if (candidateDays.length === 0) {
    return null;
  }
  if (candidateDays.length === 1) {
    return candidateDays[0];
  }

  const orderedAtMs = orderedAt.getTime();

  const withinWindow = candidateDays.find((day) => {
    if (!day.event_start_time || !day.event_end_time) {
      return false;
    }
    const start = new Date(day.event_start_time).getTime() - EVENT_WINDOW_BUFFER_MS;
    const end = new Date(day.event_end_time).getTime() + EVENT_WINDOW_BUFFER_MS;
    return orderedAtMs >= start && orderedAtMs <= end;
  });
  if (withinWindow) {
    return withinWindow;
  }

  return candidateDays.reduce((closest, day) => {
    if (!day.event_start_time) {
      return closest;
    }
    const distance = Math.abs(new Date(day.event_start_time).getTime() - orderedAtMs);
    const closestDistance = closest ? Math.abs(new Date(closest.event_start_time).getTime() - orderedAtMs) : Infinity;
    return distance < closestDistance ? day : closest;
  }, candidateDays[0]);
}

async function ensureSalesDaysExist(startDate, endDate) {
  const events = await getEventsForDateRange(startDate, endDate);
  const eventsByDate = new Map();
  events.forEach((event) => {
    if (!eventsByDate.has(event.date)) {
      eventsByDate.set(event.date, []);
    }
    eventsByDate.get(event.date).push(event);
  });

  const dates = listDateStrings(startDate, endDate);

  for (const date of dates) {
    const dayEvents = eventsByDate.get(date) || [];

    if (dayEvents.length === 0) {
      await salesDays.findOrCreateUnmatched({ saleDate: date });
      continue;
    }

    for (const event of dayEvents) {
      const location = await salesLocations.findOrCreateByName(event.summary);
      await salesDays.findOrCreateForEvent({
        saleDate: date,
        calendarEventSummary: event.summary,
        eventStartTime: event.startTime,
        eventEndTime: event.endTime,
        locationId: location.id,
      });
    }
  }

  return dates;
}

// Tips live on Payment.tip_money, not reliably on Order — see
// services/square.js. Summed per order_id in case of split tenders.
function sumTipsByOrderId(payments) {
  const tipsByOrderId = new Map();
  payments.forEach((payment) => {
    if (!payment.order_id) {
      return;
    }
    const tipCents = (payment.tip_money && payment.tip_money.amount) || 0;
    tipsByOrderId.set(payment.order_id, (tipsByOrderId.get(payment.order_id) || 0) + tipCents);
  });
  return tipsByOrderId;
}

async function syncDateRange({ startDate, endDate }) {
  const dates = await ensureSalesDaysExist(startDate, endDate);

  const days = await salesDays.listForDateRange({ startDate: dates[0], endDate: dates[dates.length - 1] });
  const daysByDate = groupByDateKey(days, 'sale_date', true);

  const [orders, payments] = await Promise.all([
    searchOrders({ startDate: startDate.toISOString(), endDate: endDate.toISOString() }),
    listPayments({ startDate: startDate.toISOString(), endDate: endDate.toISOString() }),
  ]);
  const tipsByOrderId = sumTipsByOrderId(payments);

  let syncedOrderCount = 0;

  for (const order of orders) {
    const orderedAt = new Date(order.created_at);
    const dateKey = formatInTimeZone(orderedAt, TIME_ZONE, 'yyyy-MM-dd');
    const candidateDays = daysByDate.get(dateKey) || [];
    const salesDay = pickSalesDay(candidateDays, orderedAt);

    if (!salesDay) {
      continue;
    }

    const totalCents = (order.total_money && order.total_money.amount) || 0;
    const taxCents = (order.total_tax_money && order.total_tax_money.amount) || 0;
    const tipCents = tipsByOrderId.get(order.id) || (order.total_tip_money && order.total_tip_money.amount) || 0;
    // Square's Order doesn't expose a top-level subtotal field directly —
    // derive it, since total/tax/tip are all reliably present.
    const subtotalCents = totalCents - taxCents - tipCents;

    const savedOrder = await squareOrders.upsertOrder({
      squareOrderId: order.id,
      salesDayId: salesDay.id,
      orderedAt,
      subtotalMoneyCents: subtotalCents,
      taxMoneyCents: taxCents,
      tipMoneyCents: tipCents,
      totalMoneyCents: totalCents,
    });

    const lineItems = (order.line_items || []).map((item) => ({
      name: item.name || 'Item',
      quantity: parseInt(item.quantity, 10) || 1,
      totalMoneyCents: (item.total_money && item.total_money.amount) || 0,
    }));
    await squareOrders.replaceLineItems(savedOrder.id, lineItems);

    syncedOrderCount += 1;
  }

  const unmatchedDayCount = days.filter((day) => day.location_id === null).length;

  return {
    daysProcessed: dates.length,
    syncedOrderCount,
    unmatchedDayCount,
  };
}

function getYesterdayRange(now = new Date()) {
  const zonedYesterday = subDays(toZonedTime(now, TIME_ZONE), 1);
  return {
    startDate: fromZonedTime(startOfDay(zonedYesterday), TIME_ZONE),
    endDate: fromZonedTime(endOfDay(zonedYesterday), TIME_ZONE),
  };
}

module.exports = { syncDateRange, getYesterdayRange };
