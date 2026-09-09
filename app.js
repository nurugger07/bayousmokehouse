const express = require('express');
const path = require('path');
const pagesRouter = require('./routes/pages');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));

app.use('/', pagesRouter);

app.use((req, res) => {
  res.status(404).render('errors/404');
});

module.exports = app;
