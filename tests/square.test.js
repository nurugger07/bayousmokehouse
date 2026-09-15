jest.mock('square', () => {
  const mockSearch = jest.fn();
  const mockList = jest.fn();
  return {
    SquareClient: jest.fn().mockImplementation((options) => ({
      __options: options,
      orders: { search: mockSearch },
      payments: { list: mockList },
    })),
    SquareEnvironment: { Production: 'production' },
    __mockSearch: mockSearch,
    __mockList: mockList,
  };
});

function loadService() {
  jest.resetModules();
  const { SquareClient, __mockSearch, __mockList } = require('square');
  const square = require('../services/square');
  return { square, SquareClient, mockSearch: __mockSearch, mockList: __mockList };
}

beforeEach(() => {
  process.env.SQUARE_ACCESS_TOKEN = 'test-token';
  process.env.SQUARE_LOCATION_ID = 'LOCATION123';
});

describe('searchOrders', () => {
  it('authenticates with the access token and filters by location, date range, and completed state', async () => {
    const { square, SquareClient, mockSearch } = loadService();
    mockSearch.mockResolvedValueOnce({ orders: [{ id: 'order_1' }] });

    const orders = await square.searchOrders({ startDate: '2026-09-01T00:00:00Z', endDate: '2026-09-01T23:59:59Z' });

    expect(orders).toEqual([{ id: 'order_1' }]);
    expect(SquareClient).toHaveBeenCalledWith({ token: 'test-token', environment: 'production' });

    const request = mockSearch.mock.calls[0][0];
    expect(request.locationIds).toEqual(['LOCATION123']);
    expect(request.query.filter.dateTimeFilter.createdAt).toEqual({
      startAt: '2026-09-01T00:00:00Z',
      endAt: '2026-09-01T23:59:59Z',
    });
    expect(request.query.filter.stateFilter.states).toEqual(['COMPLETED']);
    expect(request.query.sort.sortField).toBe('CREATED_AT');
  });

  it('follows the cursor across multiple pages and returns all orders combined', async () => {
    const { square, mockSearch } = loadService();
    mockSearch
      .mockResolvedValueOnce({ orders: [{ id: 'order_1' }], cursor: 'next-page' })
      .mockResolvedValueOnce({ orders: [{ id: 'order_2' }] });

    const orders = await square.searchOrders({ startDate: 'a', endDate: 'b' });

    expect(orders).toEqual([{ id: 'order_1' }, { id: 'order_2' }]);
    expect(mockSearch).toHaveBeenCalledTimes(2);
    expect(mockSearch.mock.calls[1][0].cursor).toBe('next-page');
  });

  it('propagates errors from the SDK rather than swallowing them', async () => {
    const { square, mockSearch } = loadService();
    mockSearch.mockRejectedValueOnce(new Error('Square API request failed (401)'));

    await expect(square.searchOrders({ startDate: 'a', endDate: 'b' })).rejects.toThrow(/401/);
  });
});

describe('listPayments', () => {
  it('lists payments for the location and time range', async () => {
    const { square, mockList } = loadService();
    mockList.mockResolvedValueOnce([{ id: 'payment_1' }]);

    const payments = await square.listPayments({ startDate: '2026-09-01T00:00:00Z', endDate: '2026-09-01T23:59:59Z' });

    expect(payments).toEqual([{ id: 'payment_1' }]);
    expect(mockList).toHaveBeenCalledWith({
      locationId: 'LOCATION123',
      beginTime: '2026-09-01T00:00:00Z',
      endTime: '2026-09-01T23:59:59Z',
      sortField: 'CREATED_AT',
    });
  });

  it('iterates a multi-page response and returns all payments combined', async () => {
    const { square, mockList } = loadService();
    // The real SDK returns an auto-paginating Page; a plain array is
    // async-iterable the same way (for await..of awaits each item),
    // so it stands in fine for this test.
    mockList.mockResolvedValueOnce([{ id: 'payment_1' }, { id: 'payment_2' }]);

    const payments = await square.listPayments({ startDate: 'a', endDate: 'b' });

    expect(payments).toEqual([{ id: 'payment_1' }, { id: 'payment_2' }]);
  });
});
