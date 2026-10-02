// Heroku release-phase step: runs db/schema.sql against the app's
// database on every deploy, before new web dynos take traffic. Safe to
// run repeatedly -- schema.sql is written entirely in idempotent style
// (CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, DROP
// CONSTRAINT IF EXISTS + ADD CONSTRAINT), so re-applying it to an
// already-current database is a no-op.
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function main() {
  const schemaPath = path.join(__dirname, '../db/schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  console.log('Applying db/schema.sql...');
  await pool.query(sql);
  console.log('Schema is up to date.');
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed to apply schema:', err.message);
    process.exit(1);
  });
