const express = require('express');
const path = require('path');
const pagesRouter = require('./routes/pages');
const contactRouter = require('./routes/contact');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', contactRouter);
app.use('/', pagesRouter);

app.use((req, res) => {
  res.status(404).render('errors/404');
});

// Generic error handler — never expose stack traces or internal error
// details to the client, regardless of NODE_ENV. Details go to the
// server log only.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('errors/500');
});

module.exports = app;
