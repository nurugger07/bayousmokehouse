const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Please try again later.',
});

router.get('/login', (req, res) => {
  res.render('admin/login', { error: null });
});

router.post('/login', loginLimiter, async (req, res, next) => {
  const { password } = req.body;

  try {
    const valid = Boolean(password) && (await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH));

    if (!valid) {
      return res.status(401).render('admin/login', { error: 'Incorrect password.' });
    }

    req.session.isAdmin = true;
    res.redirect('/admin/messages');
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.redirect('/admin/login');
  });
});

module.exports = router;
