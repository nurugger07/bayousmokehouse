const { startOfDay, endOfDay } = require('date-fns');
const { toZonedTime, fromZonedTime, formatInTimeZone } = require('date-fns-tz');
const { getEventsForDateRange } = require('./googleCalendar');
const { setCatalogTaxEnabled } = require('./square');
const { sendAdminAlert } = require('./mailer');
const { findByName } = require('../models/salesLocations');
const { listJurisdictions, listJurisdictionsForLocation } = require('../models/taxJurisdictions');

const TIME_ZONE = 'America/Denver';

function getTodayRange(now = new Date()) {
  const zonedToday = toZonedTime(now, TIME_ZONE);
  return {
    startDate: fromZonedTime(startOfDay(zonedToday), TIME_ZONE),
    endDate: fromZonedTime(endOfDay(zonedToday), TIME_ZONE),
    dateLabel: formatInTimeZone(zonedToday, 'UTC', 'yyyy-MM-dd'),
  };
}

// Works out what SHOULD be enabled/disabled today, without touching
// Square or sending email — kept separate from runDailyTaxToggle so the
// decision logic is testable on its own for every "can't tell" case.
async function planTodaysTaxes(now = new Date()) {
  const { startDate, endDate, dateLabel } = getTodayRange(now);
  const events = await getEventsForDateRange(startDate, endDate);
  const todaysEvents = events.filter((event) => event.date === dateLabel);
  const allJurisdictions = await listJurisdictions();

  if (todaysEvents.length === 0) {
    return { dateLabel, status: 'no_event', events: todaysEvents, allJurisdictions };
  }
  if (todaysEvents.length > 1) {
    return { dateLabel, status: 'multiple_events', events: todaysEvents, allJurisdictions };
  }

  const location = await findByName(todaysEvents[0].summary);
  if (!location) {
    return { dateLabel, status: 'unknown_location', events: todaysEvents, allJurisdictions };
  }

  const toEnable = await listJurisdictionsForLocation(location.id);
  const enabledIds = new Set(toEnable.map((j) => j.id));
  const toDisable = allJurisdictions.filter((j) => !enabledIds.has(j.id));

  return { dateLabel, status: 'ok', events: todaysEvents, location, toEnable, toDisable, allJurisdictions };
}

function describeIssue(plan) {
  if (plan.status === 'no_event') {
    return 'No calendar event was found for today.';
  }
  if (plan.status === 'multiple_events') {
    return `Found ${plan.events.length} calendar events for today, so it's unclear which location's taxes should apply.`;
  }
  return `Today's calendar event ("${plan.events[0].summary}") doesn't match any known sales location.`;
}

async function sendCannotDetermineAlert(plan) {
  await sendAdminAlert({
    subject: `Sales tax toggle needs your attention: ${plan.dateLabel}`,
    body: [
      "The daily sales tax toggle job couldn't automatically determine today's location.",
      '',
      describeIssue(plan),
      '',
      'No changes were made in Square. Check the schedule and toggle taxes manually if needed.',
    ].join('\n'),
  });
}

function jurisdictionLine(jurisdiction, action) {
  if (!jurisdiction.square_catalog_tax_id) {
    return `- ${jurisdiction.name} (${jurisdiction.level}): would ${action}, but has no Square Catalog Tax ID set, so it was skipped`;
  }
  return `- ${jurisdiction.name} (${jurisdiction.level}): ${action}`;
}

async function sendDryRunSummary(plan) {
  const lines = [
    `Dry run for ${plan.dateLabel}. Today's location: ${plan.location.name}`,
    '',
    'Would enable:',
    ...(plan.toEnable.length ? plan.toEnable.map((j) => jurisdictionLine(j, 'enable')) : ['(none)']),
    '',
    'Would disable:',
    ...(plan.toDisable.length ? plan.toDisable.map((j) => jurisdictionLine(j, 'disable')) : ['(none)']),
    '',
    'No changes were made in Square (dry-run mode).',
  ];
  await sendAdminAlert({ subject: `Sales tax toggle dry run: ${plan.dateLabel}`, body: lines.join('\n') });
}

// Applies plan.toEnable/toDisable in Square, one jurisdiction at a time
// so a single failure doesn't block the rest. Jurisdictions with no
// square_catalog_tax_id are skipped (can't act on them) rather than
// erroring the whole run.
async function applyPlan(plan) {
  const results = [];
  for (const jurisdiction of plan.toEnable) {
    if (!jurisdiction.square_catalog_tax_id) {
      results.push({ jurisdiction, action: 'enable', ok: false, skipped: true });
      continue;
    }
    try {
      await setCatalogTaxEnabled(jurisdiction.square_catalog_tax_id, true);
      results.push({ jurisdiction, action: 'enable', ok: true });
    } catch (err) {
      results.push({ jurisdiction, action: 'enable', ok: false, error: err.message });
    }
  }
  for (const jurisdiction of plan.toDisable) {
    if (!jurisdiction.square_catalog_tax_id) {
      results.push({ jurisdiction, action: 'disable', ok: false, skipped: true });
      continue;
    }
    try {
      await setCatalogTaxEnabled(jurisdiction.square_catalog_tax_id, false);
      results.push({ jurisdiction, action: 'disable', ok: true });
    } catch (err) {
      results.push({ jurisdiction, action: 'disable', ok: false, error: err.message });
    }
  }
  return results;
}

function resultLine(result) {
  if (result.skipped) {
    return `- ${result.jurisdiction.name} (${result.jurisdiction.level}): SKIPPED, no Square Catalog Tax ID set`;
  }
  if (result.ok) {
    return `- ${result.jurisdiction.name} (${result.jurisdiction.level}): ${result.action}d`;
  }
  return `- ${result.jurisdiction.name} (${result.jurisdiction.level}): FAILED to ${result.action}: ${result.error}`;
}

async function sendLiveRunSummary(plan, results) {
  const anyFailures = results.some((r) => !r.ok);
  const lines = [
    `Sales tax toggle for ${plan.dateLabel}. Today's location: ${plan.location.name}`,
    '',
    ...results.map(resultLine),
  ];
  await sendAdminAlert({
    subject: `Sales tax toggle ${anyFailures ? 'needs attention' : 'complete'}: ${plan.dateLabel}`,
    body: lines.join('\n'),
  });
}

// dryRun defaults true on purpose. This only ever calls Square when
// explicitly told not to, so a missing/misread config value fails safe
// rather than silently toggling live tax settings.
async function runDailyTaxToggle({ dryRun = true, now = new Date() } = {}) {
  const plan = await planTodaysTaxes(now);

  if (plan.status !== 'ok') {
    await sendCannotDetermineAlert(plan);
    return plan;
  }

  if (dryRun) {
    await sendDryRunSummary(plan);
    return plan;
  }

  const results = await applyPlan(plan);
  await sendLiveRunSummary(plan, results);
  return { ...plan, results };
}

module.exports = { planTodaysTaxes, runDailyTaxToggle };
