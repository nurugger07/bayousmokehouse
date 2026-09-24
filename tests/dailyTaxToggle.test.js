jest.mock('../services/googleCalendar', () => ({
  getEventsForDateRange: jest.fn(),
}));
jest.mock('../services/square', () => ({
  setCatalogTaxEnabled: jest.fn(),
}));
jest.mock('../services/mailer', () => ({
  sendAdminAlert: jest.fn(),
}));
jest.mock('../models/salesLocations', () => ({
  findByName: jest.fn(),
}));
jest.mock('../models/taxJurisdictions', () => ({
  listJurisdictions: jest.fn(),
  listJurisdictionsForLocation: jest.fn(),
}));

const { getEventsForDateRange } = require('../services/googleCalendar');
const { setCatalogTaxEnabled } = require('../services/square');
const { sendAdminAlert } = require('../services/mailer');
const { findByName } = require('../models/salesLocations');
const { listJurisdictions, listJurisdictionsForLocation } = require('../models/taxJurisdictions');
const { planTodaysTaxes, runDailyTaxToggle } = require('../services/dailyTaxToggle');

const NOW = new Date('2026-09-23T15:00:00Z'); // mid-day UTC, still 2026-09-23 in America/Denver

const COLORADO = { id: 1, name: 'Colorado', level: 'state', square_catalog_tax_id: 'tax_co' };
const LARIMER = { id: 2, name: 'Larimer County', level: 'county', square_catalog_tax_id: 'tax_larimer' };
const BOULDER = { id: 3, name: 'Boulder County', level: 'county', square_catalog_tax_id: 'tax_boulder' };
const BERTHOUD = { id: 4, name: 'Town of Berthoud', level: 'municipality', square_catalog_tax_id: null };

beforeEach(() => {
  jest.clearAllMocks();
  listJurisdictions.mockResolvedValue([COLORADO, LARIMER, BOULDER, BERTHOUD]);
});

describe('planTodaysTaxes', () => {
  it('flags no_event when there is no calendar event today', async () => {
    getEventsForDateRange.mockResolvedValue([]);

    const plan = await planTodaysTaxes(NOW);

    expect(plan.status).toBe('no_event');
  });

  it('flags multiple_events when more than one event falls on today', async () => {
    getEventsForDateRange.mockResolvedValue([
      { date: '2026-09-23', summary: 'Bayou Smokehouse @ Berthoud Brewery' },
      { date: '2026-09-23', summary: 'Bayou Smokehouse @ Odd13 Brewing' },
    ]);

    const plan = await planTodaysTaxes(NOW);

    expect(plan.status).toBe('multiple_events');
  });

  it('flags unknown_location when the event name matches no sales location', async () => {
    getEventsForDateRange.mockResolvedValue([{ date: '2026-09-23', summary: 'A New Spot' }]);
    findByName.mockResolvedValue(undefined);

    const plan = await planTodaysTaxes(NOW);

    expect(plan.status).toBe('unknown_location');
  });

  it('resolves the jurisdictions to enable/disable for a known location', async () => {
    getEventsForDateRange.mockResolvedValue([
      { date: '2026-09-23', summary: 'Bayou Smokehouse @ Berthoud Brewery' },
    ]);
    findByName.mockResolvedValue({ id: 10, name: 'Bayou Smokehouse @ Berthoud Brewery' });
    listJurisdictionsForLocation.mockResolvedValue([COLORADO, LARIMER, BERTHOUD]);

    const plan = await planTodaysTaxes(NOW);

    expect(plan.status).toBe('ok');
    expect(plan.toEnable).toEqual([COLORADO, LARIMER, BERTHOUD]);
    expect(plan.toDisable).toEqual([BOULDER]);
  });
});

describe('runDailyTaxToggle', () => {
  it('sends an alert and makes no Square calls when the location cannot be determined', async () => {
    getEventsForDateRange.mockResolvedValue([]);

    await runDailyTaxToggle({ dryRun: true, now: NOW });

    expect(setCatalogTaxEnabled).not.toHaveBeenCalled();
    expect(sendAdminAlert).toHaveBeenCalledTimes(1);
    expect(sendAdminAlert.mock.calls[0][0].subject).toContain('needs your attention');
  });

  it('in dry-run mode, emails the plan without calling Square', async () => {
    getEventsForDateRange.mockResolvedValue([
      { date: '2026-09-23', summary: 'Bayou Smokehouse @ Berthoud Brewery' },
    ]);
    findByName.mockResolvedValue({ id: 10, name: 'Bayou Smokehouse @ Berthoud Brewery' });
    listJurisdictionsForLocation.mockResolvedValue([COLORADO, LARIMER]);

    await runDailyTaxToggle({ dryRun: true, now: NOW });

    expect(setCatalogTaxEnabled).not.toHaveBeenCalled();
    expect(sendAdminAlert).toHaveBeenCalledTimes(1);
    const { subject, body } = sendAdminAlert.mock.calls[0][0];
    expect(subject).toContain('dry run');
    expect(body).toContain('Colorado');
    expect(body).toContain('Larimer County');
    expect(body).toContain('Boulder County');
  });

  it('in live mode, enables and disables the right taxes and skips ones with no Square ID', async () => {
    getEventsForDateRange.mockResolvedValue([
      { date: '2026-09-23', summary: 'Bayou Smokehouse @ Berthoud Brewery' },
    ]);
    findByName.mockResolvedValue({ id: 10, name: 'Bayou Smokehouse @ Berthoud Brewery' });
    listJurisdictionsForLocation.mockResolvedValue([COLORADO, LARIMER, BERTHOUD]);
    setCatalogTaxEnabled.mockResolvedValue({});

    await runDailyTaxToggle({ dryRun: false, now: NOW });

    expect(setCatalogTaxEnabled).toHaveBeenCalledWith('tax_co', true);
    expect(setCatalogTaxEnabled).toHaveBeenCalledWith('tax_larimer', true);
    expect(setCatalogTaxEnabled).toHaveBeenCalledWith('tax_boulder', false);
    // Berthoud has no square_catalog_tax_id, so it must never be called.
    expect(setCatalogTaxEnabled).toHaveBeenCalledTimes(3);

    const { subject, body } = sendAdminAlert.mock.calls[0][0];
    expect(subject).toContain('needs attention'); // Berthoud was skipped
    expect(body).toContain('SKIPPED');
  });

  it('reports a Square failure for one jurisdiction without stopping the rest', async () => {
    getEventsForDateRange.mockResolvedValue([
      { date: '2026-09-23', summary: 'Bayou Smokehouse @ Berthoud Brewery' },
    ]);
    findByName.mockResolvedValue({ id: 10, name: 'Bayou Smokehouse @ Berthoud Brewery' });
    listJurisdictionsForLocation.mockResolvedValue([COLORADO, LARIMER]);
    setCatalogTaxEnabled.mockImplementation((id) => {
      if (id === 'tax_co') {
        return Promise.reject(new Error('Square API request failed (500)'));
      }
      return Promise.resolve({});
    });

    await runDailyTaxToggle({ dryRun: false, now: NOW });

    // Colorado (fails) + Larimer (enable) + Boulder (disable, has an ID) = 3 calls;
    // Berthoud has no square_catalog_tax_id and is skipped rather than called.
    expect(setCatalogTaxEnabled).toHaveBeenCalledTimes(3);
    const { subject, body } = sendAdminAlert.mock.calls[0][0];
    expect(subject).toContain('needs attention');
    expect(body).toContain('FAILED');
    expect(body).toContain('500');
  });
});
