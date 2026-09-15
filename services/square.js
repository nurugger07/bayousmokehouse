const { SquareClient, SquareEnvironment } = require('square');

function getClient() {
  return new SquareClient({
    token: process.env.SQUARE_ACCESS_TOKEN,
    environment: SquareEnvironment.Production,
  });
}

// Completed orders only — canceled/open orders aren't sales. orders.search
// isn't one of the SDK's auto-paginating (Page) endpoints, so the cursor is
// followed by hand.
async function searchOrders({ startDate, endDate }) {
  const client = getClient();
  const orders = [];
  let cursor;

  do {
    const response = await client.orders.search({
      locationIds: [process.env.SQUARE_LOCATION_ID],
      query: {
        filter: {
          dateTimeFilter: { createdAt: { startAt: startDate, endAt: endDate } },
          stateFilter: { states: ['COMPLETED'] },
        },
        sort: { sortField: 'CREATED_AT', sortOrder: 'ASC' },
      },
      limit: 100,
      cursor,
    });

    orders.push(...(response.orders || []));
    cursor = response.cursor;
  } while (cursor);

  return orders;
}

// Tips live on Payment.tipMoney, not reliably on Order.totalTipMoney — see
// callers. payments.list is one of the SDK's auto-paginating endpoints.
async function listPayments({ startDate, endDate }) {
  const client = getClient();
  const page = await client.payments.list({
    locationId: process.env.SQUARE_LOCATION_ID,
    beginTime: startDate,
    endTime: endDate,
    sortField: 'CREATED_AT',
  });

  const payments = [];
  for await (const payment of page) {
    payments.push(payment);
  }
  return payments;
}

module.exports = { searchOrders, listPayments };
