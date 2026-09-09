jest.mock('google-auth-library', () => {
  const mockRequest = jest.fn();
  return {
    JWT: jest.fn().mockImplementation(() => ({ request: mockRequest })),
    __mockRequest: mockRequest,
  };
});

// Both the service module and this test need to agree on which mocked
// `request` function is in play. jest.resetModules() re-evaluates the
// mock factory too, producing a fresh jest.fn() each time — so we must
// re-require 'google-auth-library' after every reset to stay in sync
// with whatever the freshly-loaded service module will use internally.
function loadService() {
  jest.resetModules();
  const { __mockRequest } = require('google-auth-library');
  const googleCalendar = require('../services/googleCalendar');
  return { googleCalendar, mockRequest: __mockRequest };
}

afterEach(() => {
  jest.useRealTimers();
});

describe('getWeekSchedule', () => {
  it('returns only days that have at least one event, in Monday-Sunday order', async () => {
    const { googleCalendar, mockRequest } = loadService();
    mockRequest.mockResolvedValueOnce({
      data: {
        items: [
          {
            summary: 'Bayou Smokehouse @ Odd13 Brewing',
            location: '301 Link Ln, Fort Collins, CO',
            start: { dateTime: '2026-09-11T17:00:00-06:00' },
            end: { dateTime: '2026-09-11T21:00:00-06:00' },
          },
          {
            summary: 'Bayou Smokehouse @ Verboten Brewing',
            location: '425 Linden St, Loveland, CO',
            start: { dateTime: '2026-09-08T17:00:00-06:00' },
            end: { dateTime: '2026-09-08T21:00:00-06:00' },
          },
        ],
      },
    });

    const schedule = await googleCalendar.getWeekSchedule();

    expect(schedule.unavailable).toBe(false);
    expect(schedule.days).toHaveLength(2);
    expect(schedule.days[0].dayName).toBe('Tuesday');
    expect(schedule.days[0].events[0].name).toBe('Bayou Smokehouse @ Verboten Brewing');
    expect(schedule.days[0].events[0].location).toBe('425 Linden St, Loveland, CO');
    expect(schedule.days[0].events[0].shortLocation).toBe('Loveland, CO');
    expect(schedule.days[0].events[0].mapsUrl).toBe(
      'https://www.google.com/maps/search/?api=1&query=425%20Linden%20St%2C%20Loveland%2C%20CO'
    );
    expect(schedule.days[0].events[0].startTime).toBe('5:00 PM');
    expect(schedule.days[1].dayName).toBe('Friday');
    expect(schedule.weekStart).toBeDefined();
    expect(schedule.weekEnd).toBeDefined();
  });

  it('returns an empty days array (not an error) when the calendar has no events this week', async () => {
    const { googleCalendar, mockRequest } = loadService();
    mockRequest.mockResolvedValueOnce({ data: { items: [] } });

    const schedule = await googleCalendar.getWeekSchedule();

    expect(schedule.unavailable).toBe(false);
    expect(schedule.days).toEqual([]);
  });

  it('serves cached data on a second call within the cache window without refetching', async () => {
    const { googleCalendar, mockRequest } = loadService();
    mockRequest.mockResolvedValueOnce({ data: { items: [] } });

    await googleCalendar.getWeekSchedule();
    await googleCalendar.getWeekSchedule();

    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('marks the schedule unavailable (not a thrown error) when the fetch fails and there is no cache yet', async () => {
    const { googleCalendar, mockRequest } = loadService();
    mockRequest.mockRejectedValueOnce(new Error('network error'));

    const schedule = await googleCalendar.getWeekSchedule();

    expect(schedule.unavailable).toBe(true);
    expect(schedule.days).toEqual([]);
    expect(schedule.weekStart).toBeDefined();
    expect(schedule.weekEnd).toBeDefined();
  });

  it('falls back to stale cached data on a fetch failure once the cache has expired', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.setSystemTime(new Date('2026-09-09T15:00:00Z'));

    const { googleCalendar, mockRequest } = loadService();
    mockRequest.mockResolvedValueOnce({
      data: {
        items: [
          {
            summary: 'Bayou Smokehouse @ Verboten Brewing',
            location: '425 Linden St, Loveland, CO',
            start: { dateTime: '2026-09-08T17:00:00-06:00' },
            end: { dateTime: '2026-09-08T21:00:00-06:00' },
          },
        ],
      },
    });

    const first = await googleCalendar.getWeekSchedule();
    expect(first.unavailable).toBe(false);
    expect(first.days).toHaveLength(1);

    // Move 16 minutes forward — past the 15 minute cache TTL.
    jest.setSystemTime(new Date('2026-09-09T15:16:00Z'));
    mockRequest.mockRejectedValueOnce(new Error('network error'));

    const second = await googleCalendar.getWeekSchedule();

    expect(second.unavailable).toBe(false);
    expect(second.days).toEqual(first.days);
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('falls back to the full address as shortLocation when it cannot be confidently parsed', async () => {
    const { googleCalendar, mockRequest } = loadService();
    mockRequest.mockResolvedValueOnce({
      data: {
        items: [
          {
            summary: 'Bayou Smokehouse @ Somewhere',
            location: 'Just a venue name, no real address structure',
            start: { dateTime: '2026-09-11T17:00:00-06:00' },
            end: { dateTime: '2026-09-11T21:00:00-06:00' },
          },
        ],
      },
    });

    const schedule = await googleCalendar.getWeekSchedule();

    expect(schedule.days[0].events[0].shortLocation).toBe('Just a venue name, no real address structure');
  });

  it('leaves shortLocation null when there is no location at all', async () => {
    const { googleCalendar, mockRequest } = loadService();
    mockRequest.mockResolvedValueOnce({
      data: {
        items: [
          {
            summary: 'Bayou Smokehouse',
            start: { dateTime: '2026-09-11T17:00:00-06:00' },
            end: { dateTime: '2026-09-11T21:00:00-06:00' },
          },
        ],
      },
    });

    const schedule = await googleCalendar.getWeekSchedule();

    expect(schedule.days[0].events[0].location).toBeNull();
    expect(schedule.days[0].events[0].shortLocation).toBeNull();
    expect(schedule.days[0].events[0].mapsUrl).toBeNull();
  });
});
