const request = require('supertest');
const app = require('../app');

describe('GET /menu', () => {
  let text;

  beforeAll(async () => {
    const res = await request(app).get('/menu');
    text = res.text;
  });

  it('responds with 200', async () => {
    const res = await request(app).get('/menu');
    expect(res.status).toBe(200);
  });

  it('renders every menu section heading', () => {
    expect(text).toContain('Apps');
    expect(text).toContain('Combos');
    expect(text).toContain('Southern &amp; Cajun Classics');
    expect(text).toContain('Southern Sides');
    expect(text).toContain('Something Sweet');
  });

  it('renders a priced item with its price', () => {
    expect(text).toContain('Smoked Chicken Wings');
    expect(text).toContain('$16.50');
  });

  it('renders an item with no listed price without a broken price field', () => {
    expect(text).toContain('Low-Country Peel');
    expect(text).not.toMatch(/\$\s*(null|undefined)/i);
    expect(text).not.toContain('undefined');
  });

  it('renders a matching food photo for items that have one', () => {
    expect(text).toContain('/images/food/jambalaya-plate.jpg');
    expect(text).toContain('/images/food/smoked-chicken-wings.jpg');
  });
});
