const request = require('supertest');
const app = require('../app');

describe('static pages', () => {
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

  it('GET / shows the sold-out fallback when there is no schedule data yet', async () => {
    const res = await request(app).get('/');

    expect(res.text).toContain('Sold Out This Week');
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
