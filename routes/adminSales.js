const express = require('express');
const { startOfMonth, endOfMonth, startOfYear, format } = require('date-fns');
const requireAdminAuth = require('../middleware/requireAdminAuth');
const {
  getSalesTotalsByLocation,
  getItemSalesByLocation,
  getTopItems,
  getTaxTotalsByLocation,
  getTipTotalsByLocation,
  getWeeklyTotals,
  groupWeeklyTotalsByMonth,
} = require('../models/salesReports');
const { listLocations, updateCityState } = require('../models/salesLocations');
const { getShortLocation } = require('../services/googleCalendar');
const { listUnmatched, setLocation } = require('../models/salesDays');

const router = express.Router();

router.use(requireAdminAuth);

// Default filter window when none is given — the current calendar month.
function resolveFilters(query) {
  const now = new Date();
  const startDate = query.startDate || format(startOfMonth(now), 'yyyy-MM-dd');
  const endDate = query.endDate || format(endOfMonth(now), 'yyyy-MM-dd');
  const locationId = query.locationId ? Number(query.locationId) : undefined;
  return { startDate, endDate, locationId };
}

// The weekly totals report is inherently a multi-month view (that's the
// point of it), so it defaults to year-to-date rather than the current
// month.
function resolveWeeklyFilters(query) {
  const now = new Date();
  const startDate = query.startDate || format(startOfYear(now), 'yyyy-MM-dd');
  const endDate = query.endDate || format(now, 'yyyy-MM-dd');
  return { startDate, endDate };
}

router.get('/sales', (req, res) => {
  res.redirect('/admin/sales/totals');
});

router.get('/sales/totals', async (req, res, next) => {
  try {
    const filters = resolveFilters(req.query);
    const [rows, locations] = await Promise.all([getSalesTotalsByLocation(filters), listLocations()]);
    res.render('admin/sales-totals', { rows, locations, filters });
  } catch (err) {
    next(err);
  }
});

router.get('/sales/items', async (req, res, next) => {
  try {
    const filters = resolveFilters(req.query);
    const [rows, topItems, locations] = await Promise.all([
      getItemSalesByLocation(filters),
      getTopItems({ ...filters, limit: 5 }),
      listLocations(),
    ]);
    res.render('admin/sales-items', { rows, topItems, locations, filters });
  } catch (err) {
    next(err);
  }
});

router.get('/sales/tax', async (req, res, next) => {
  try {
    const filters = resolveFilters(req.query);
    const [rows, locations] = await Promise.all([getTaxTotalsByLocation(filters), listLocations()]);
    res.render('admin/sales-tax', { rows, locations, filters });
  } catch (err) {
    next(err);
  }
});

router.get('/sales/tips', async (req, res, next) => {
  try {
    const filters = resolveFilters(req.query);
    const [rows, locations] = await Promise.all([getTipTotalsByLocation(filters), listLocations()]);
    res.render('admin/sales-tips', { rows, locations, filters });
  } catch (err) {
    next(err);
  }
});

router.get('/sales/weekly', async (req, res, next) => {
  try {
    const filters = resolveWeeklyFilters(req.query);
    const rows = await getWeeklyTotals(filters);
    const months = groupWeeklyTotalsByMonth(rows);
    res.render('admin/sales-weekly', { months, filters });
  } catch (err) {
    next(err);
  }
});

router.get('/sales/locations', async (req, res, next) => {
  try {
    const locations = await listLocations();
    res.render('admin/sales-locations', { locations });
  } catch (err) {
    next(err);
  }
});

router.post('/sales/locations/:id/city-state', async (req, res, next) => {
  try {
    // Accepts either a full address (re-parsed the same way the nightly
    // sync does) or an already-clean "City, ST" — getShortLocation
    // passes the latter through unchanged since it won't split into 3+
    // comma-separated parts.
    const cityState = getShortLocation((req.body.cityState || '').trim());
    await updateCityState(req.params.id, cityState);
    res.redirect('/admin/sales/locations');
  } catch (err) {
    next(err);
  }
});

router.get('/sales/unmatched', async (req, res, next) => {
  try {
    const [days, locations] = await Promise.all([listUnmatched(), listLocations()]);
    res.render('admin/sales-unmatched', { days, locations });
  } catch (err) {
    next(err);
  }
});

router.post('/sales/unmatched/:id/location', async (req, res, next) => {
  try {
    const locationId = Number(req.body.locationId);
    if (locationId) {
      await setLocation(req.params.id, locationId);
    }
    res.redirect('/admin/sales/unmatched');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
