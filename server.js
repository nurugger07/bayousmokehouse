require('dotenv').config();

const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Bayou Smokehouse website listening on port ${PORT}`);
});
