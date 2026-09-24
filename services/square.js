const { randomUUID } = require('crypto');
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

// BigInt (the SDK's type for CatalogObject.version) isn't JSON-serializable
// by default — only used here for the before/after comparison below, never
// sent to Square.
function stableStringify(value) {
  return JSON.stringify(value, (key, v) => (typeof v === 'bigint' ? v.toString() : v));
}

// Refuses to proceed unless taxData.enabled is the only thing that would
// change. This is a hard requirement (not just a convention) since this
// function writes to Johnny's live Square account: a bug here could
// silently change a tax's rate or name instead of just toggling it.
function assertOnlyEnabledChanged(before, after) {
  const strip = (obj) => ({ ...obj, taxData: { ...obj.taxData, enabled: undefined } });
  if (stableStringify(strip(before)) !== stableStringify(strip(after))) {
    throw new Error('Refusing to update Square catalog tax: a field other than "enabled" would change.');
  }
}

// All CatalogTax objects in the account, for matching a jurisdiction to
// its Square tax object (see square_catalog_tax_id on tax_jurisdictions).
async function listCatalogTaxes() {
  const client = getClient();
  const page = await client.catalog.list({ types: 'TAX' });
  const taxes = [];
  for await (const object of page) {
    taxes.push(object);
  }
  return taxes;
}

// Enables or disables a single CatalogTax by ID. Uses full-replacement
// upsert semantics (Square's API requires sending the complete object),
// so the existing object is fetched first and only taxData.enabled is
// changed on the copy that gets sent back — see assertOnlyEnabledChanged.
async function setCatalogTaxEnabled(catalogObjectId, enabled) {
  const client = getClient();

  const { object, errors } = await client.catalog.object.get({ objectId: catalogObjectId });
  if (errors && errors.length) {
    throw new Error(`Square error fetching catalog object ${catalogObjectId}: ${JSON.stringify(errors)}`);
  }
  if (!object || object.type !== 'TAX') {
    throw new Error(`Catalog object ${catalogObjectId} is not a TAX object`);
  }

  const updatedObject = { ...object, taxData: { ...object.taxData, enabled } };
  assertOnlyEnabledChanged(object, updatedObject);

  const { catalogObject, errors: upsertErrors } = await client.catalog.object.upsert({
    idempotencyKey: randomUUID(),
    object: updatedObject,
  });
  if (upsertErrors && upsertErrors.length) {
    throw new Error(`Square error updating catalog object ${catalogObjectId}: ${JSON.stringify(upsertErrors)}`);
  }
  return catalogObject;
}

module.exports = { searchOrders, listPayments, listCatalogTaxes, setCatalogTaxEnabled };
