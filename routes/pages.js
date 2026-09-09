const express = require('express');
const menuSections = require('../data/menu');
const { getWeekSchedule } = require('../services/googleCalendar');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const schedule = await getWeekSchedule();
    res.render('pages/home', { schedule });
  } catch (err) {
    next(err);
  }
});

router.get('/catering', (req, res) => {
  res.render('pages/catering');
});

router.get('/about', (req, res) => {
  res.render('pages/about');
});

router.get('/menu', (req, res) => {
  res.render('pages/menu', { menuSections });
});

module.exports = router;
