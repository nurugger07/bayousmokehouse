const express = require('express');
const requireAdminAuth = require('../middleware/requireAdminAuth');
const {
  listJurisdictions,
  getJurisdictionById,
  createJurisdiction,
  updateJurisdiction,
} = require('../models/taxJurisdictions');
const { listPaymentsForJurisdiction, createPayment } = require('../models/taxPayments');
const { listCatalogTaxes } = require('../services/square');

// Dollars (whatever a human typed into the form) to integer cents,
// matching how money is stored everywhere else in this app. Blank
// optional fields stay null rather than becoming 0.
function dollarsToCents(value) {
  if (value === undefined || value === null || value.trim() === '') {
    return null;
  }
  return Math.round(Number(value) * 100);
}

const router = express.Router();

router.use(requireAdminAuth);

function jurisdictionFieldsFromBody(body) {
  return {
    name: (body.name || '').trim(),
    level: body.level,
    taxRatePercent: body.taxRatePercent,
    schedule: body.schedule,
    dayOfMonthDue: body.dayOfMonthDue,
    isHomeRule: body.isHomeRule === 'on',
    paymentLink: (body.paymentLink || '').trim(),
    licenseNumber: (body.licenseNumber || '').trim(),
    licenseDriveUrl: (body.licenseDriveUrl || '').trim(),
    squareCatalogTaxId: (body.squareCatalogTaxId || '').trim(),
  };
}

// Reference list of the actual CatalogTax objects in Square, with their
// object IDs, so Johnny can copy the right one into a jurisdiction's
// "Square Catalog Tax ID" field without hunting for it elsewhere.
router.get('/tax/square-catalog-taxes', async (req, res, next) => {
  try {
    const taxes = await listCatalogTaxes();
    res.render('admin/tax-square-catalog-taxes', { taxes });
  } catch (err) {
    next(err);
  }
});

router.get('/tax/jurisdictions', async (req, res, next) => {
  try {
    const jurisdictions = await listJurisdictions();
    res.render('admin/tax-jurisdictions', { jurisdictions });
  } catch (err) {
    next(err);
  }
});

router.get('/tax/jurisdictions/new', (req, res) => {
  res.render('admin/tax-jurisdiction-form', { jurisdiction: null });
});

router.post('/tax/jurisdictions', async (req, res, next) => {
  try {
    await createJurisdiction(jurisdictionFieldsFromBody(req.body));
    res.redirect('/admin/tax/jurisdictions');
  } catch (err) {
    next(err);
  }
});

router.get('/tax/jurisdictions/:id', async (req, res, next) => {
  try {
    const [jurisdiction, payments] = await Promise.all([
      getJurisdictionById(req.params.id),
      listPaymentsForJurisdiction(req.params.id),
    ]);
    if (!jurisdiction) {
      return res.status(404).render('errors/404');
    }
    res.render('admin/tax-jurisdiction-detail', { jurisdiction, payments });
  } catch (err) {
    next(err);
  }
});

router.post('/tax/jurisdictions/:id/payments', async (req, res, next) => {
  try {
    await createPayment(req.params.id, {
      periodStart: req.body.periodStart,
      periodEnd: req.body.periodEnd,
      reportedRevenueCents: dollarsToCents(req.body.reportedRevenue),
      estimatedTaxCents: dollarsToCents(req.body.estimatedTax),
      amountPaidCents: dollarsToCents(req.body.amountPaid),
      paidDate: req.body.paidDate || null,
      receiptDriveUrl: (req.body.receiptDriveUrl || '').trim(),
      notes: (req.body.notes || '').trim(),
    });
    res.redirect(`/admin/tax/jurisdictions/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

router.get('/tax/jurisdictions/:id/edit', async (req, res, next) => {
  try {
    const jurisdiction = await getJurisdictionById(req.params.id);
    if (!jurisdiction) {
      return res.status(404).render('errors/404');
    }
    res.render('admin/tax-jurisdiction-form', { jurisdiction });
  } catch (err) {
    next(err);
  }
});

router.post('/tax/jurisdictions/:id', async (req, res, next) => {
  try {
    await updateJurisdiction(req.params.id, jurisdictionFieldsFromBody(req.body));
    res.redirect('/admin/tax/jurisdictions');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
