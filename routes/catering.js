const express = require('express');
const { createMessage } = require('../models/contactMessages');
const { sendContactNotification } = require('../services/mailer');

const router = express.Router();

const EVENT_TYPE_LABELS = {
  backyard_party: 'Backyard Party',
  wedding: 'Wedding',
  birthday: 'Birthday',
  graduation: 'Graduation',
  corporate_event: 'Corporate Event',
  brewery_festival: 'Brewery / Festival',
  other: 'Other',
};

router.get('/catering', (req, res) => {
  res.render('pages/catering', {
    submitted: req.query.submitted === '1',
    error: null,
    values: {},
    eventTypes: EVENT_TYPE_LABELS,
  });
});

const FIELD_LIMITS = { name: 255, email: 255, phone: 50 };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_FIELDS = ['name', 'email', 'phone', 'eventType', 'eventDate', 'startTime', 'location', 'guestCount', 'message'];

router.post('/catering', async (req, res, next) => {
  const { name, email, phone, eventType, eventDate, startTime, endTime, location, guestCount, message, company } =
    req.body;

  // Honeypot: real users never see or fill this field; bots that
  // auto-fill every input will. Pretend success so they don't retry.
  if (company) {
    return res.redirect('/catering?submitted=1');
  }

  const renderError = (error) =>
    res.status(400).render('pages/catering', {
      submitted: false,
      error,
      values: { name, email, phone, eventType, eventDate, startTime, endTime, location, guestCount, message },
      eventTypes: EVENT_TYPE_LABELS,
    });

  const missing = REQUIRED_FIELDS.find((field) => !req.body[field]);
  if (missing) {
    return renderError('Please fill in all the required fields so we can look into your event.');
  }

  if (!EMAIL_PATTERN.test(email)) {
    return renderError('Please enter a valid email address.');
  }

  if (!Object.prototype.hasOwnProperty.call(EVENT_TYPE_LABELS, eventType)) {
    return renderError('Please choose a valid event type.');
  }

  if (!DATE_PATTERN.test(eventDate) || Number.isNaN(new Date(eventDate).getTime())) {
    return renderError('Please enter a valid event date.');
  }

  const guestCountNumber = Number(guestCount);
  if (!Number.isInteger(guestCountNumber) || guestCountNumber < 1) {
    return renderError('Please enter a valid number of guests.');
  }

  const tooLong = Object.entries(FIELD_LIMITS).find(
    ([field, limit]) => typeof req.body[field] === 'string' && req.body[field].length > limit
  );
  if (tooLong) {
    return renderError('One of the fields is too long. Please shorten it and try again.');
  }

  try {
    const created = await createMessage({
      name,
      email,
      phone,
      message,
      category: 'catering',
      eventType,
      eventDate,
      startTime,
      endTime: endTime || null,
      location,
      guestCount: guestCountNumber,
    });

    // Best-effort notification — a failed email must never fail the
    // visitor's submission, which is already safely saved above.
    const detailUrl = `${req.protocol}://${req.get('host')}/admin/messages/${created.id}`;
    sendContactNotification({ message: created, detailUrl }).catch((err) => {
      console.error('Failed to send catering notification email:', err);
    });

    res.redirect('/catering?submitted=1');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
