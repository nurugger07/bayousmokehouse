// CLI entry point for the nightly Square sales sync. Run with no args
// to sync yesterday (America/Denver) — this is what Heroku Scheduler
// calls — or with --from=YYYY-MM-DD --to=YYYY-MM-DD for a one-time
// historical backfill.
require('dotenv').config();

const { fromZonedTime } = require('date-fns-tz');
const { syncDateRange, getYesterdayRange } = require('../services/salesSync');

const TIME_ZONE = 'America/Denver';

function parseFlags(argv) {
  const flags = {};
  argv.forEach((arg) => {
    const match = arg.match(/^--(from|to)=(.+)$/);
    if (match) {
      flags[match[1]] = match[2];
    }
  });
  return flags;
}

function resolveDateRange(flags) {
  if (flags.from && flags.to) {
    return {
      startDate: fromZonedTime(`${flags.from}T00:00:00`, TIME_ZONE),
      endDate: fromZonedTime(`${flags.to}T23:59:59.999`, TIME_ZONE),
    };
  }
  return getYesterdayRange();
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const { startDate, endDate } = resolveDateRange(flags);

  console.log(`Syncing Square sales from ${startDate.toISOString()} to ${endDate.toISOString()}...`);
  const result = await syncDateRange({ startDate, endDate });
  console.log(
    `Done. ${result.syncedOrderCount} order(s) synced across ${result.daysProcessed} day(s); ` +
      `${result.unmatchedDayCount} day(s) still need a location assigned in the admin tool.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Square sales sync failed:', err.message);
    process.exit(1);
  });
