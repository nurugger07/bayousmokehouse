const { subMonths, startOfMonth, endOfMonth } = require('date-fns');
const { toZonedTime, fromZonedTime, formatInTimeZone } = require('date-fns-tz');
const { getRevenueByJurisdiction, estimateTaxCents } = require('../models/salesReports');
const { upsertRevenueEstimate } = require('../models/taxPayments');
const { sendAdminAlert } = require('./mailer');

const TIME_ZONE = 'America/Denver';
// date-fns months are 0-indexed: Mar, Jun, Sep, Dec.
const QUARTER_ENDING_MONTHS = [2, 5, 8, 11];

function isLastMonthOfQuarter(zonedDate) {
  return QUARTER_ENDING_MONTHS.includes(zonedDate.getMonth());
}

function quarterStart(zonedDate) {
  return new Date(zonedDate.getFullYear(), Math.floor(zonedDate.getMonth() / 3) * 3, 1);
}

// Monthly jurisdictions file for the single month that just closed.
// Quarterly ones share one filing period across all three months of the
// quarter, so period_start/period_end stay identical across the whole
// quarter -- letting upsertRevenueEstimate accumulate the same row each
// month rather than creating three separate ones. Revenue naturally
// comes back partial for the first two months of a quarter, since
// sales_days rows for the not-yet-happened remaining months simply
// don't exist yet.
function periodForSchedule(schedule, zonedReferenceMonth) {
  if (schedule === 'monthly') {
    return {
      periodStart: fromZonedTime(startOfMonth(zonedReferenceMonth), TIME_ZONE),
      periodEnd: fromZonedTime(endOfMonth(zonedReferenceMonth), TIME_ZONE),
    };
  }
  const start = quarterStart(zonedReferenceMonth);
  const end = endOfMonth(new Date(start.getFullYear(), start.getMonth() + 2, 1));
  return { periodStart: fromZonedTime(start, TIME_ZONE), periodEnd: fromZonedTime(end, TIME_ZONE) };
}

function isDueThisRun(jurisdiction, zonedReferenceMonth) {
  if (jurisdiction.schedule === 'monthly') {
    return true;
  }
  return isLastMonthOfQuarter(zonedReferenceMonth);
}

// periodForSchedule's Date objects are real instants (each wrapped in
// fromZonedTime), so reading the calendar date back out means asking
// what that instant looks like in TIME_ZONE specifically -- not 'UTC'.
// (Unlike zonedReferenceMonth below, which was never round-tripped
// through fromZonedTime and stays in toZonedTime's "read with UTC"
// convention, matching the pattern services/dailyTaxToggle.js uses for
// its own dateLabel.)
function dateKey(date) {
  return formatInTimeZone(date, TIME_ZONE, 'yyyy-MM-dd');
}

function centsToDollars(cents) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

function reminderLine(row) {
  const parts = [
    `- ${row.jurisdiction_name} (${row.level}): ${centsToDollars(row.grossSalesCents)} reported, ` +
      `est. tax ${centsToDollars(row.estimatedTaxCents)}, due by day ${row.day_of_month_due}`,
  ];
  return parts.join('\n');
}

// For every jurisdiction, records last month's (or this quarter-to-date's,
// for quarterly ones) revenue and estimated tax -- regardless of whether
// a filing is due this run, so the record stays current even in an
// off-month. Only jurisdictions whose schedule says a filing is due this
// month get included in the reminder email.
async function runMonthlyTaxReminder(now = new Date()) {
  const zonedNow = toZonedTime(now, TIME_ZONE);
  const zonedReferenceMonth = subMonths(zonedNow, 1);

  const monthlyPeriod = periodForSchedule('monthly', zonedReferenceMonth);
  const quarterlyPeriod = periodForSchedule('quarterly', zonedReferenceMonth);

  const [monthlyRevenue, quarterlyRevenue] = await Promise.all([
    getRevenueByJurisdiction({ startDate: dateKey(monthlyPeriod.periodStart), endDate: dateKey(monthlyPeriod.periodEnd) }),
    getRevenueByJurisdiction({ startDate: dateKey(quarterlyPeriod.periodStart), endDate: dateKey(quarterlyPeriod.periodEnd) }),
  ]);

  const dueRows = [];

  for (const row of monthlyRevenue) {
    if (row.schedule !== 'monthly') {
      continue;
    }
    const grossSalesCents = Number(row.gross_sales_cents);
    const estimatedTaxCents = estimateTaxCents(grossSalesCents, row.tax_rate_percent);
    await upsertRevenueEstimate(row.jurisdiction_id, {
      periodStart: dateKey(monthlyPeriod.periodStart),
      periodEnd: dateKey(monthlyPeriod.periodEnd),
      reportedRevenueCents: grossSalesCents,
      estimatedTaxCents,
    });
    dueRows.push({ ...row, grossSalesCents, estimatedTaxCents });
  }

  for (const row of quarterlyRevenue) {
    if (row.schedule !== 'quarterly') {
      continue;
    }
    const grossSalesCents = Number(row.gross_sales_cents);
    const estimatedTaxCents = estimateTaxCents(grossSalesCents, row.tax_rate_percent);
    await upsertRevenueEstimate(row.jurisdiction_id, {
      periodStart: dateKey(quarterlyPeriod.periodStart),
      periodEnd: dateKey(quarterlyPeriod.periodEnd),
      reportedRevenueCents: grossSalesCents,
      estimatedTaxCents,
    });
    if (isDueThisRun(row, zonedReferenceMonth)) {
      dueRows.push({ ...row, grossSalesCents, estimatedTaxCents });
    }
  }

  if (dueRows.length === 0) {
    return { dueRows: [] };
  }

  const monthLabel = formatInTimeZone(zonedReferenceMonth, 'UTC', 'MMMM yyyy');
  await sendAdminAlert({
    subject: `Sales tax payments due this month (${monthLabel} revenue)`,
    body: [
      `The following jurisdictions have a filing due this month, based on ${monthLabel}'s revenue:`,
      '',
      ...dueRows.map(reminderLine),
      '',
      'Record each payment once made at /admin/tax/jurisdictions.',
    ].join('\n'),
  });

  return { dueRows };
}

module.exports = { runMonthlyTaxReminder };
