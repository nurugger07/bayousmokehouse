// Override the test-suite-wide relaxed limit (see .env.test) back down
// to the real production value — this test exists specifically to
// verify that production value actually blocks after 10 attempts.
process.env.ADMIN_LOGIN_RATE_LIMIT_MAX = '10';

const request = require('supertest');
const app = require('../app');
const { pool } = require('../config/db');
const { getCsrfToken } = require('./helpers/csrf');

afterAll(async () => {
  await pool.end();
});

describe('admin login rate limiting', () => {
  it(
    'blocks further attempts after 10 failed logins from the same client',
    async () => {
      const agent = request.agent(app);
      const _csrf = await getCsrfToken(agent, '/admin/login');

      for (let i = 0; i < 10; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await agent.post('/admin/login').type('form').send({ password: 'wrong', _csrf });
      }

      const res = await agent.post('/admin/login').type('form').send({ password: 'wrong', _csrf });

      expect(res.status).toBe(429);
    },
    // 11 sequential bcrypt compares (intentionally slow by design) can
    // exceed Jest's 5s default under load — this isn't a logic issue.
    15000
  );
});
