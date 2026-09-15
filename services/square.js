const API_BASE = 'https://connect.squareup.com/v2';
const SQUARE_VERSION = '2026-07-15';

async function squareRequest(path, { method = 'GET', body, searchParams } = {}) {
  const url = new URL(`${API_BASE}${path}`);

  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    });
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': SQUARE_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Square API request failed (${res.status}): ${text.slice(0, 500)}`);
  }

  return res.json();
}

// Completed orders only — canceled/open orders aren't sales. Square
// requires sort_field to match the date_time_filter field used.
async function searchOrders({ startDate, endDate }) {
  const locationId = process.env.SQUARE_LOCATION_ID;
  const orders = [];
  let cursor;

  do {
    const data = await squareRequest('/orders/search', {
      method: 'POST',
      body: {
        location_ids: [locationId],
        query: {
          filter: {
            date_time_filter: {
              created_at: { start_at: startDate, end_at: endDate },
            },
            state_filter: { states: ['COMPLETED'] },
          },
          sort: { sort_field: 'CREATED_AT', sort_order: 'ASC' },
        },
        limit: 100,
        cursor,
      },
    });

    orders.push(...(data.orders || []));
    cursor = data.cursor;
  } while (cursor);

  return orders;
}

// Tips live on the Payment object (tip_money), not on Order — Order's
// total_tip_money isn't reliably populated for every tip flow, so tips
// are sourced from here and joined back to orders by order_id.
async function listPayments({ startDate, endDate }) {
  const locationId = process.env.SQUARE_LOCATION_ID;
  const payments = [];
  let cursor;

  do {
    const data = await squareRequest('/payments', {
      searchParams: {
        location_id: locationId,
        begin_time: startDate,
        end_time: endDate,
        limit: 100,
        cursor,
      },
    });

    payments.push(...(data.payments || []));
    cursor = data.cursor;
  } while (cursor);

  return payments;
}

module.exports = { searchOrders, listPayments };
