const express = require('express');
const { startOfMonth, endOfMonth, format } = require('date-fns');
const requireAdminAuth = require('../middleware/requireAdminAuth');
const {
  getSalesTotalsByLocation,
  getItemSalesByLocation,
  getTaxTotalsByLocation,
  getTipTotalsByLocation,
} = require('../models/salesReports');
const { listLocations } = require('../models/salesLocations');
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
    const [rows, locations] = await Promise.all([getItemSalesByLocation(filters), listLocations()]);
    res.render('admin/sales-items', { rows, locations, filters });
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
