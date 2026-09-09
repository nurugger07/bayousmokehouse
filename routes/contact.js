const express = require('express');
const { createMessage } = require('../models/contactMessages');
const { sendContactNotification } = require('../services/mailer');

const router = express.Router();

router.get('/contact', (req, res) => {
  res.render('pages/contact', {
    submitted: req.query.submitted === '1',
    error: null,
    values: {},
  });
});

const FIELD_LIMITS = { name: 255, email: 255, phone: 50 };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/contact', async (req, res, next) => {
  const { name, email, phone, message, company } = req.body;

  // Honeypot: real users never see or fill this field; bots that
  // auto-fill every input will. Pretend success so they don't retry.
  if (company) {
    return res.redirect('/contact?submitted=1');
  }

  if (!name || !email || !message) {
    return res.status(400).render('pages/contact', {
      submitted: false,
      error: 'Please fill in your name, email, and message.',
      values: { name, email, phone, message },
    });
  }

  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).render('pages/contact', {
      submitted: false,
      error: 'Please enter a valid email address.',
      values: { name, email, phone, message },
    });
  }

  const tooLong = Object.entries(FIELD_LIMITS).find(
    ([field, limit]) => typeof req.body[field] === 'string' && req.body[field].length > limit
  );

  if (tooLong) {
    return res.status(400).render('pages/contact', {
      submitted: false,
      error: 'One of the fields is too long. Please shorten it and try again.',
      values: { name, email, phone, message },
    });
  }

  try {
    const created = await createMessage({ name, email, phone, message });

    // Best-effort notification — a failed email must never fail the
    // visitor's submission, which is already safely saved above.
    const detailUrl = `${req.protocol}://${req.get('host')}/admin/messages/${created.id}`;
    sendContactNotification({ message: created, detailUrl }).catch((err) => {
      console.error('Failed to send contact notification email:', err);
    });

    res.redirect('/contact?submitted=1');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
