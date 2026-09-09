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
    expect(text).toContain('Smokehouse Potato Chips');
    expect(text).not.toMatch(/\$\s*(null|undefined)/i);
    expect(text).not.toContain('undefined');
  });

  it('prices the Peel & Eat Shrimp correctly', () => {
    expect(text).toMatch(/Low-Country Peel &amp; Eat Shrimp \(GF\)[\s\S]{0,200}\$16\.75/);
  });

  it('renders a matching food photo for items that have one', () => {
    expect(text).toContain('/images/food/jambalaya-plate.jpg');
    expect(text).toContain('/images/food/smoked-chicken-wings.jpg');
  });

  it('places the toggle icon next to the item name, not the price', () => {
    const nameIndex = text.indexOf('Cornbread Muffins (GF)');
    const toggleIndex = text.indexOf('menu-item__toggle', nameIndex);
    const priceIndex = text.indexOf('$7.00', nameIndex);
    expect(toggleIndex).toBeGreaterThan(nameIndex);
    expect(toggleIndex).toBeLessThan(priceIndex);
  });

  it('renders each item as an expandable accordion, not a card grid', () => {
    expect(text).toContain('<details');
    expect(text).toContain('<summary');
    expect(text).not.toContain('card-grid');
  });
});
