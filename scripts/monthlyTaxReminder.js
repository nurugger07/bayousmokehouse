// CLI entry point for the monthly sales tax reminder job. Heroku
// Scheduler has no true monthly frequency (only every-10-minutes,
// hourly, or daily), so this is scheduled DAILY and self-gates on the
// day of month instead -- quietly exiting on every day that isn't
// MONTHLY_REMINDER_DAY (defaults to the 1st). On the right day, it
// records last month's revenue and estimated tax for every
// jurisdiction, and emails a reminder for any whose filing schedule
// says a payment is due this month.
require('dotenv').config();

const { runMonthlyTaxReminder, isReminderDay } = require('../services/monthlyTaxReminder');

async function main() {
  const targetDay = Number(process.env.MONTHLY_REMINDER_DAY) || 1;

  if (!isReminderDay(targetDay)) {
    console.log(`Not day ${targetDay} of the month -- skipping.`);
    return;
  }

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
