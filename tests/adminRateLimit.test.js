const request = require('supertest');
const app = require('../app');
const { pool } = require('../config/db');

afterAll(async () => {
  await pool.end();
});

describe('admin login rate limiting', () => {
  it('blocks further attempts after 10 failed logins from the same client', async () => {
    const agent = request.agent(app);

    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await agent.post('/admin/login').type('form').send({ password: 'wrong' });
    }

    const res = await agent.post('/admin/login').type('form').send({ password: 'wrong' });

    expect(res.status).toBe(429);
  });
});
