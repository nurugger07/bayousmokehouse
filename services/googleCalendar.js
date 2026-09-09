const { JWT } = require('google-auth-library');
const { toZonedTime, fromZonedTime, formatInTimeZone } = require('date-fns-tz');
const { startOfWeek, endOfWeek, eachDayOfInterval } = require('date-fns');

const TIME_ZONE = 'America/Denver';
const CACHE_TTL_MS = 15 * 60 * 1000;
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

let cache = null; // { data, fetchedAt }

// Computes the current Monday-Sunday week window in America/Denver.
// zonedWeekStart/zonedWeekEnd are "fake-UTC" Dates (per date-fns-tz's
// convention) used only for calendar-day arithmetic in Denver's frame;
// weekStart/weekEnd are the corresponding real UTC instants used for
// the Calendar API's timeMin/timeMax.
function getWeekWindow(now = new Date()) {
  const zonedNow = toZonedTime(now, TIME_ZONE);
  const zonedWeekStart = startOfWeek(zonedNow, { weekStartsOn: 1 });
  const zonedWeekEnd = endOfWeek(zonedNow, { weekStartsOn: 1 });

  return {
    zonedWeekStart,
    zonedWeekEnd,
    weekStart: fromZonedTime(zonedWeekStart, TIME_ZONE),
    weekEnd: fromZonedTime(zonedWeekEnd, TIME_ZONE),
  };
}

function buildDaySkeleton(zonedWeekStart, zonedWeekEnd) {
  return eachDayOfInterval({ start: zonedWeekStart, end: zonedWeekEnd }).map((zonedDay) => ({
    date: formatInTimeZone(zonedDay, 'UTC', 'yyyy-MM-dd'),
    dayName: formatInTimeZone(zonedDay, 'UTC', 'EEEE'),
    events: [],
  }));
}

// "123 Main St, Loveland, CO 80537, USA" -> "Loveland, CO". Falls back
// to the full address whenever it doesn't match this shape (e.g. a
// venue name typed in free-form, or address formats besides the
// standard US "street, city, state zip[, country]" one Google's own
// autocomplete produces).
function getShortLocation(location) {
  if (!location) {
    return null;
  }

  const parts = location.split(',').map((part) => part.trim());
  if (parts.length < 3) {
    return location;
  }

  const city = parts[1];
  const stateMatch = parts[2].match(/^([A-Z]{2})\b/);

  if (!city || !stateMatch) {
    return location;
  }

  return `${city}, ${stateMatch[1]}`;
}

function getMapsUrl(location) {
  if (!location) {
    return null;
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

function getClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  return new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [CALENDAR_SCOPE],
  });
}

async function fetchEvents(weekStart, weekEnd) {
  const client = getClient();
  const calendarId = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID);
  const params = new URLSearchParams({
    timeMin: weekStart.toISOString(),
    timeMax: weekEnd.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    timeZone: TIME_ZONE,
  });

  const res = await client.request({
    url: `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?${params}`,
  });

  return res.data.items || [];
}

function groupEventsByDay(events, zonedWeekStart, zonedWeekEnd) {
  const days = buildDaySkeleton(zonedWeekStart, zonedWeekEnd);
  const daysByDate = new Map(days.map((day) => [day.date, day]));

  events.forEach((event) => {
    // All-day events use start.date ('yyyy-MM-dd'); timed events use
    // start.dateTime (a full ISO instant).
    const isAllDay = Boolean(event.start.date);
    const dateKey = isAllDay ? event.start.date : formatInTimeZone(new Date(event.start.dateTime), TIME_ZONE, 'yyyy-MM-dd');
    const day = daysByDate.get(dateKey);

    if (!day) {
      return;
    }

    day.events.push({
      name: event.summary || 'Untitled Event',
      location: event.location || null,
      shortLocation: getShortLocation(event.location),
      mapsUrl: getMapsUrl(event.location),
      description: event.description || null,
      startTime: isAllDay ? null : formatInTimeZone(new Date(event.start.dateTime), TIME_ZONE, 'h:mm a'),
      endTime: isAllDay ? null : formatInTimeZone(new Date(event.end.dateTime), TIME_ZONE, 'h:mm a'),
    });
  });

  return days.filter((day) => day.events.length > 0);
}

async function getWeekSchedule() {
  const { zonedWeekStart, zonedWeekEnd, weekStart, weekEnd } = getWeekWindow();
  const weekLabels = {
    weekStart: formatInTimeZone(zonedWeekStart, 'UTC', 'MMM d'),
    weekEnd: formatInTimeZone(zonedWeekEnd, 'UTC', 'MMM d'),
  };

  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }

  try {
    const events = await fetchEvents(weekStart, weekEnd);
    const days = groupEventsByDay(events, zonedWeekStart, zonedWeekEnd);
    const data = { ...weekLabels, days, unavailable: false };
    cache = { data, fetchedAt: now };
    return data;
  } catch (err) {
    // Log only the message, not the full error object — gaxios errors can
    // carry the request config (including the Authorization header) as an
    // enumerable property, and that must never end up in server logs.
    console.error('Failed to fetch Google Calendar events:', err.message);

    if (cache) {
      return cache.data;
    }

    return { ...weekLabels, days: [], unavailable: true };
  }
}

module.exports = { getWeekSchedule };
