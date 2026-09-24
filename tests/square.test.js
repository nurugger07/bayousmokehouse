jest.mock('square', () => {
  const mockSearch = jest.fn();
  const mockList = jest.fn();
  const mockCatalogList = jest.fn();
  const mockCatalogGet = jest.fn();
  const mockCatalogUpsert = jest.fn();
  return {
    SquareClient: jest.fn().mockImplementation((options) => ({
      __options: options,
      orders: { search: mockSearch },
      payments: { list: mockList },
      catalog: {
        list: mockCatalogList,
        object: { get: mockCatalogGet, upsert: mockCatalogUpsert },
      },
    })),
    SquareEnvironment: { Production: 'production' },
    __mockSearch: mockSearch,
    __mockList: mockList,
    __mockCatalogList: mockCatalogList,
    __mockCatalogGet: mockCatalogGet,
    __mockCatalogUpsert: mockCatalogUpsert,
  };
});

function loadService() {
  jest.resetModules();
  const {
    SquareClient,
    __mockSearch,
    __mockList,
    __mockCatalogList,
    __mockCatalogGet,
    __mockCatalogUpsert,
  } = require('square');
  const square = require('../services/square');
  return {
    square,
    SquareClient,
    mockSearch: __mockSearch,
    mockList: __mockList,
    mockCatalogList: __mockCatalogList,
    mockCatalogGet: __mockCatalogGet,
    mockCatalogUpsert: __mockCatalogUpsert,
  };
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

describe('listCatalogTaxes', () => {
  it('lists all TAX-type catalog objects', async () => {
    const { square, mockCatalogList } = loadService();
    mockCatalogList.mockResolvedValueOnce([
      { id: 'tax_1', type: 'TAX', taxData: { name: 'Colorado', enabled: true } },
    ]);

    const taxes = await square.listCatalogTaxes();

    expect(taxes).toEqual([{ id: 'tax_1', type: 'TAX', taxData: { name: 'Colorado', enabled: true } }]);
    expect(mockCatalogList).toHaveBeenCalledWith({ types: 'TAX' });
  });
});

describe('setCatalogTaxEnabled', () => {
  const EXISTING_TAX_OBJECT = {
    id: 'tax_1',
    type: 'TAX',
    version: 42n,
    updatedAt: '2026-01-01T00:00:00Z',
    taxData: { name: 'Larimer County', percentage: '0.8', enabled: false, calculationPhase: 'TAX_SUBTOTAL_PHASE' },
  };

  it('enables a tax while preserving every other field unchanged', async () => {
    const { square, mockCatalogGet, mockCatalogUpsert } = loadService();
    mockCatalogGet.mockResolvedValueOnce({ object: EXISTING_TAX_OBJECT });
    mockCatalogUpsert.mockResolvedValueOnce({
      catalogObject: { ...EXISTING_TAX_OBJECT, taxData: { ...EXISTING_TAX_OBJECT.taxData, enabled: true } },
    });

    const result = await square.setCatalogTaxEnabled('tax_1', true);

    expect(result.taxData.enabled).toBe(true);
    const sentObject = mockCatalogUpsert.mock.calls[0][0].object;
    expect(sentObject).toEqual({ ...EXISTING_TAX_OBJECT, taxData: { ...EXISTING_TAX_OBJECT.taxData, enabled: true } });
    expect(mockCatalogUpsert.mock.calls[0][0].idempotencyKey).toBeTruthy();
  });

  it('refuses to update if the fetched object is not a TAX type', async () => {
    const { square, mockCatalogGet, mockCatalogUpsert } = loadService();
    mockCatalogGet.mockResolvedValueOnce({ object: { id: 'item_1', type: 'ITEM' } });

    await expect(square.setCatalogTaxEnabled('item_1', true)).rejects.toThrow(/not a TAX object/);
    expect(mockCatalogUpsert).not.toHaveBeenCalled();
  });

  it('propagates errors returned in the get response body', async () => {
    const { square, mockCatalogGet } = loadService();
    mockCatalogGet.mockResolvedValueOnce({ errors: [{ code: 'NOT_FOUND' }] });

    await expect(square.setCatalogTaxEnabled('tax_missing', true)).rejects.toThrow(/NOT_FOUND/);
  });
});
