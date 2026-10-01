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
const {
  listLocations,
  getLocationById,
  createLocation,
  updateLocation,
  deleteLocation,
  mergeLocations,
} = require('../models/salesLocations');
const {
  listJurisdictions,
  listJurisdictionIdsByLocation,
  setLocationJurisdictions,
} = require('../models/taxJurisdictions');
const { getShortLocation } = require('../services/googleCalendar');
const { listUnmatched, setLocation, countForLocation } = require('../models/salesDays');

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

// cityState accepts either a full address (re-parsed the same way the
// nightly sync does) or an already-clean "City, ST" — getShortLocation
// passes the latter through unchanged since it won't split into 3+
// comma-separated parts.
function locationFieldsFromBody(body) {
  return {
    name: body.name || '',
    cityState: getShortLocation((body.cityState || '').trim()),
  };
}

function jurisdictionIdsFromBody(body) {
  return [].concat(body.jurisdictionIds || []).map(Number);
}

router.get('/sales/locations', async (req, res, next) => {
  try {
    const [locations, jurisdictions, jurisdictionIdsByLocation] = await Promise.all([
      listLocations(),
      listJurisdictions(),
      listJurisdictionIdsByLocation(),
    ]);

    const editId = req.query.editId ? Number(req.query.editId) : null;
    const editingLocation = editId ? locations.find((l) => l.id === editId) || null : null;
    const editingJurisdictionIds = editingLocation ? jurisdictionIdsByLocation.get(editId) || [] : [];

    res.render('admin/sales-locations', {
      locations,
      jurisdictions,
      jurisdictionIdsByLocation,
      editingLocation,
      editingJurisdictionIds,
      error: req.query.error,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/sales/locations', async (req, res, next) => {
  try {
    const location = await createLocation(locationFieldsFromBody(req.body));
    await setLocationJurisdictions(location.id, jurisdictionIdsFromBody(req.body));
    res.redirect('/admin/sales/locations');
  } catch (err) {
    if (err.code === 'DUPLICATE_NAME') {
      return res.redirect(`/admin/sales/locations?error=${encodeURIComponent(err.message)}`);
    }
    next(err);
  }
});

router.post('/sales/locations/:id', async (req, res, next) => {
  try {
    await updateLocation(req.params.id, locationFieldsFromBody(req.body));
    await setLocationJurisdictions(req.params.id, jurisdictionIdsFromBody(req.body));
    res.redirect('/admin/sales/locations');
  } catch (err) {
    if (err.code === 'DUPLICATE_NAME') {
      return res.redirect(`/admin/sales/locations?error=${encodeURIComponent(err.message)}`);
    }
    next(err);
  }
});

router.post('/sales/locations/:id/delete', async (req, res, next) => {
  try {
    await deleteLocation(req.params.id);
    res.redirect('/admin/sales/locations');
  } catch (err) {
    if (err.code === 'HAS_SALES_HISTORY') {
      return res.redirect(`/admin/sales/locations?error=${encodeURIComponent(err.message)}`);
    }
    next(err);
  }
});

router.get('/sales/locations/:id/merge', async (req, res, next) => {
  try {
    const targetId = Number(req.query.targetId);
    const [duplicate, target, visitCount] = await Promise.all([
      getLocationById(req.params.id),
      getLocationById(targetId),
      countForLocation(req.params.id),
    ]);

    if (!duplicate || !target) {
      return res.status(404).render('errors/404');
    }

    res.render('admin/sales-locations-merge', { duplicate, target, visitCount });
  } catch (err) {
    next(err);
  }
});

router.post('/sales/locations/:id/merge', async (req, res, next) => {
  try {
    await mergeLocations(req.params.id, req.body.targetId);
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
