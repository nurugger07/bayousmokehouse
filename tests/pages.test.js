jest.mock('../services/googleCalendar');

const request = require('supertest');
const app = require('../app');
const { getWeekSchedule } = require('../services/googleCalendar');

const EMPTY_WEEK = { weekStart: 'Sep 7', weekEnd: 'Sep 13', days: [], unavailable: false };

describe('static pages', () => {
  beforeEach(() => {
    getWeekSchedule.mockResolvedValue(EMPTY_WEEK);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('GET / responds with 200 and renders the home page with nav', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Bayou Smokehouse');
    expect(res.text).toContain('href="/menu"');
    expect(res.text).toContain('href="/catering"');
    expect(res.text).toContain('href="/about"');
    expect(res.text).toContain('href="/contact"');
    expect(res.text).toContain('#schedule');
  });

  it('GET / shows the week date range in the schedule heading', async () => {
    const res = await request(app).get('/');

    expect(res.text).toContain('Sep 7');
    expect(res.text).toContain('Sep 13');
  });

  it('GET / shows the sold-out fallback when the week has no events', async () => {
    const res = await request(app).get('/');

    expect(res.text).toContain('Sold Out This Week');
  });

  it('GET / shows an unavailable message when the calendar fetch failed with no cache', async () => {
    getWeekSchedule.mockResolvedValue({ weekStart: 'Sep 7', weekEnd: 'Sep 13', days: [], unavailable: true });

    const res = await request(app).get('/');

    expect(res.text).toContain('temporarily unavailable');
    expect(res.text).not.toContain('Sold Out This Week');
  });

  it('GET / renders each day that has events, with location and time', async () => {
    getWeekSchedule.mockResolvedValue({
      weekStart: 'Sep 7',
      weekEnd: 'Sep 13',
      unavailable: false,
      days: [
        {
          dayName: 'Friday',
          date: '2026-09-11',
          events: [
            {
              name: 'Bayou Smokehouse @ Odd13 Brewing',
              location: '301 Link Ln, Fort Collins, CO',
              startTime: '11:00 AM',
              endTime: '2:00 PM',
              description: null,
            },
          ],
        },
      ],
    });

    const res = await request(app).get('/');

    expect(res.text).toContain('Friday');
    expect(res.text).toContain('Bayou Smokehouse @ Odd13 Brewing');
    expect(res.text).toContain('301 Link Ln, Fort Collins, CO');
    expect(res.text).toContain('11:00 AM');
    expect(res.text).not.toContain('Sold Out This Week');
  });

  it('GET / makes an event with a description expandable, showing the description', async () => {
    getWeekSchedule.mockResolvedValue({
      weekStart: 'Sep 7',
      weekEnd: 'Sep 13',
      unavailable: false,
      days: [
        {
          dayName: 'Friday',
          date: '2026-09-11',
          events: [
            {
              name: 'Bayou Smokehouse @ Odd13 Brewing',
              location: '301 Link Ln, Fort Collins, CO',
              startTime: '11:00 AM',
              endTime: '2:00 PM',
              description: 'Live music starting at noon, bring the family!',
            },
          ],
        },
      ],
    });

    const res = await request(app).get('/');

    expect(res.text).toContain('<details');
    expect(res.text).toContain('Live music starting at noon, bring the family!');
  });

  it('GET / does not render an expand toggle for an event with no description', async () => {
    getWeekSchedule.mockResolvedValue({
      weekStart: 'Sep 7',
      weekEnd: 'Sep 13',
      unavailable: false,
      days: [
        {
          dayName: 'Friday',
          date: '2026-09-11',
          events: [
            {
              name: 'Bayou Smokehouse @ Odd13 Brewing',
              location: '301 Link Ln, Fort Collins, CO',
              startTime: '11:00 AM',
              endTime: '2:00 PM',
              description: null,
            },
          ],
        },
      ],
    });

    const res = await request(app).get('/');

    expect(res.text).not.toContain('<details');
  });

  it('GET /catering responds with 200 and renders the catering page', async () => {
    const res = await request(app).get('/catering');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Catering');
  });

  it('GET /about responds with 200 and renders the about page', async () => {
    const res = await request(app).get('/about');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Bayou Smokehouse');
  });

  it('GET /menu responds with 200 and renders the menu page', async () => {
    const res = await request(app).get('/menu');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Menu');
  });

  it('GET /contact responds with 200 and renders a contact form', async () => {
    const res = await request(app).get('/contact');

    expect(res.status).toBe(200);
    expect(res.text).toContain('<form');
    expect(res.text).toContain('name="email"');
    expect(res.text).toContain('name="message"');
  });

  it('GET /nonexistent-page responds with 404', async () => {
    const res = await request(app).get('/nonexistent-page');

    expect(res.status).toBe(404);
  });
});
