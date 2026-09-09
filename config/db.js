const { Pool } = require('pg');

// Heroku Postgres requires TLS but presents a cert not issued by a
// public CA, so full chain validation isn't workable here — this is
// the standard accepted pattern for connecting to it. Local/test
// Postgres doesn't use TLS at all, hence the NODE_ENV gate.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

module.exports = { pool };
