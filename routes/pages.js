const express = require('express');
const menuSections = require('../data/menu');
const bluesBashArtists = require('../data/bluesBashArtists');
const bluesBashSponsors = require('../data/bluesBashSponsors');
const bluesBashQuotes = require('../data/bluesBashQuotes');
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

router.get('/about', (req, res) => {
  res.render('pages/about');
});

router.get('/menu', (req, res) => {
  res.render('pages/menu', { menuSections });
});

router.get('/berthoud-blues-bash', (req, res) => {
  res.render('pages/blues-bash', { artists: bluesBashArtists, sponsors: bluesBashSponsors, quotes: bluesBashQuotes });
});

module.exports = router;
