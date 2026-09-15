function loadService() {
  jest.resetModules();
  return require('../services/square');
}

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  process.env.SQUARE_ACCESS_TOKEN = 'test-token';
  process.env.SQUARE_LOCATION_ID = 'LOCATION123';
  global.fetch = jest.fn();
});

afterEach(() => {
  delete global.fetch;
});

describe('searchOrders', () => {
  it('sends a bearer-authenticated POST with the location, date range, and completed-state filter', async () => {
    const square = loadService();
    global.fetch.mockResolvedValueOnce(jsonResponse({ orders: [{ id: 'order_1' }] }));

    const orders = await square.searchOrders({ startDate: '2026-09-01T00:00:00Z', endDate: '2026-09-01T23:59:59Z' });

    expect(orders).toEqual([{ id: 'order_1' }]);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, options] = global.fetch.mock.calls[0];
    expect(url.toString()).toBe('https://connect.squareup.com/v2/orders/search');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer test-token');

    const body = JSON.parse(options.body);
    expect(body.location_ids).toEqual(['LOCATION123']);
    expect(body.query.filter.date_time_filter.created_at).toEqual({
      start_at: '2026-09-01T00:00:00Z',
      end_at: '2026-09-01T23:59:59Z',
    });
    expect(body.query.filter.state_filter.states).toEqual(['COMPLETED']);
    expect(body.query.sort.sort_field).toBe('CREATED_AT');
  });

  it('follows the cursor across multiple pages and returns all orders combined', async () => {
    const square = loadService();
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ orders: [{ id: 'order_1' }], cursor: 'next-page' }))
      .mockResolvedValueOnce(jsonResponse({ orders: [{ id: 'order_2' }] }));

    const orders = await square.searchOrders({ startDate: 'a', endDate: 'b' });

    expect(orders).toEqual([{ id: 'order_1' }, { id: 'order_2' }]);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const secondCallBody = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(secondCallBody.cursor).toBe('next-page');
  });

  it('throws a descriptive error when Square returns a non-OK response', async () => {
    const square = loadService();
    global.fetch.mockResolvedValueOnce(jsonResponse({ errors: [{ detail: 'bad request' }] }, false, 400));

    await expect(square.searchOrders({ startDate: 'a', endDate: 'b' })).rejects.toThrow(
      /Square API request failed \(400\)/
    );
  });
});

describe('listPayments', () => {
  it('sends a bearer-authenticated GET with location and time-range query params', async () => {
    const square = loadService();
    global.fetch.mockResolvedValueOnce(jsonResponse({ payments: [{ id: 'payment_1' }] }));

    const payments = await square.listPayments({ startDate: '2026-09-01T00:00:00Z', endDate: '2026-09-01T23:59:59Z' });

    expect(payments).toEqual([{ id: 'payment_1' }]);

    const [url, options] = global.fetch.mock.calls[0];
    expect(url.toString()).toBe(
      'https://connect.squareup.com/v2/payments?location_id=LOCATION123&begin_time=2026-09-01T00%3A00%3A00Z&end_time=2026-09-01T23%3A59%3A59Z&limit=100'
    );
    expect(options.method).toBe('GET');
    expect(options.headers.Authorization).toBe('Bearer test-token');
  });

  it('follows the cursor across multiple pages and returns all payments combined', async () => {
    const square = loadService();
    global.fetch
      .mockResolvedValueOnce(jsonResponse({ payments: [{ id: 'payment_1' }], cursor: 'next-page' }))
      .mockResolvedValueOnce(jsonResponse({ payments: [{ id: 'payment_2' }] }));

    const payments = await square.listPayments({ startDate: 'a', endDate: 'b' });

    expect(payments).toEqual([{ id: 'payment_1' }, { id: 'payment_2' }]);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const secondUrl = global.fetch.mock.calls[1][0].toString();
    expect(secondUrl).toContain('cursor=next-page');
  });
});
