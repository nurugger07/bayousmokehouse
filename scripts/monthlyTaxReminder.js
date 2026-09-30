// CLI entry point for the monthly sales tax reminder job (Heroku
// Scheduler, "Every month" frequency, early on the 1st). Records last
// month's revenue and estimated tax for every jurisdiction, and emails
// a reminder for any whose filing schedule says a payment is due this
// month.
require('dotenv').config();

const { runMonthlyTaxReminder } = require('../services/monthlyTaxReminder');

async function main() {
  console.log('Running monthly tax reminder...');
  const { dueRows } = await runMonthlyTaxReminder();
  console.log(`Done. ${dueRows.length} jurisdiction(s) due this month.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Monthly tax reminder failed:', err.message);
    process.exit(1);
  });
