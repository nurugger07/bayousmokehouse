const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('pages/home');
});

router.get('/catering', (req, res) => {
  res.render('pages/catering');
});

router.get('/about', (req, res) => {
  res.render('pages/about');
});

router.get('/menu', (req, res) => {
  res.render('pages/menu');
});

router.get('/contact', (req, res) => {
  res.render('pages/contact');
});

module.exports = router;
