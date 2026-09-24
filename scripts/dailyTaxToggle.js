// CLI entry point for the daily sales tax toggle job (Heroku Scheduler
// runs this every morning before service). Defaults to dry-run mode
// (email-only, no Square changes) unless TAX_TOGGLE_LIVE=true is set,
// so flipping to live mode is a config change Johnny controls himself
// once he's confirmed the dry-run emails are getting the right answer
// every day, not another deploy.
require('dotenv').config();

const { runDailyTaxToggle } = require('../services/dailyTaxToggle');

async function main() {
  const dryRun = process.env.TAX_TOGGLE_LIVE !== 'true';
  console.log(`Running daily tax toggle (${dryRun ? 'dry run' : 'live'})...`);
  const result = await runDailyTaxToggle({ dryRun });
  console.log(`Done. Status: ${result.status || 'ok'}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Daily tax toggle failed:', err.message);
    process.exit(1);
  });
