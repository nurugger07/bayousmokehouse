const express = require('express');
const path = require('path');
const session = require('express-session');
const { csrfSync } = require('csrf-sync');
const pgSession = require('connect-pg-simple')(session);
const { pool } = require('./config/db');
const pagesRouter = require('./routes/pages');
const contactRouter = require('./routes/contact');
const cateringRouter = require('./routes/catering');
const adminAuthRouter = require('./routes/adminAuth');
const adminRouter = require('./routes/admin');
const adminSalesRouter = require('./routes/adminSales');

const app = express();

// Required for secure cookies to work correctly behind Heroku's router,
// which terminates TLS and forwards over plain HTTP internally.
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new pgSession({
      pool,
      tableName: 'session',
      createTableIfMissing: true,
      // Disabled in tests so Jest's process can exit cleanly instead of
      // waiting out this timer; production keeps normal auto-pruning.
      pruneSessionInterval: process.env.NODE_ENV === 'test' ? false : undefined,
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 8,
      sameSite: 'lax',
    },
  })
);

// Synchronizer-token CSRF protection for every state-changing request.
// getTokenFromRequest reads a hidden form field (req.body._csrf) rather
// than the library's default x-csrf-token header, since every form in
// this app is a plain HTML POST, not a fetch/AJAX call that could set a
// custom header. res.locals.csrfToken makes the current token available
// to every view without each route needing to pass it explicitly.
const { csrfSynchronisedProtection } = csrfSync({
  getTokenFromRequest: (req) => req.body && req.body._csrf,
});
app.use(csrfSynchronisedProtection);
app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});

app.use('/admin', adminAuthRouter);
app.use('/admin', adminRouter);
app.use('/admin', adminSalesRouter);
app.use('/', contactRouter);
app.use('/', cateringRouter);
app.use('/', pagesRouter);

app.use((req, res) => {
  res.status(404).render('errors/404');
});

// A missing/stale/reused CSRF token gets its own friendlier page rather
// than the generic 500 — this is the expected, common case (an old tab
// left open, a double form submission), not a real server error.
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('errors/403');
  }
  next(err);
});

// Generic error handler — never expose stack traces or internal error
// details to the client, regardless of NODE_ENV. Details go to the
// server log only.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('errors/500');
});

module.exports = app;
