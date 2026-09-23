const express = require('express');
const requireAdminAuth = require('../middleware/requireAdminAuth');
const {
  listJurisdictions,
  getJurisdictionById,
  createJurisdiction,
  updateJurisdiction,
} = require('../models/taxJurisdictions');

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
  };
}

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
