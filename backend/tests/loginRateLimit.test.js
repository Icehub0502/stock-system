// Login throttling: a wrong password locks only that account (per IP), not everyone behind the same wifi.
const request = require('supertest');
const bcrypt = require('bcryptjs');
const pool = require('../src/db/pool');
const { createApp } = require('../src/app');
const { createShop, dropShop } = require('./helpers');

const app = createApp();
const PASSWORD = 'right-pass-123';
let shop;
const names = {};

// the app trusts one proxy hop, so X-Forwarded-For decides which 'IP' the limiter sees
const login = (username, password, ip = '10.0.0.1') => request(app).post('/api/auth/login')
  .set('X-Forwarded-For', ip)
  .send({ username, password, shop_code: shop.code });

beforeAll(async () => {
  shop = await createShop();
  const [[row]] = await pool.query('SELECT code FROM shops WHERE id = ?', [shop.shopId]);
  shop.code = row.code;
  const hash = bcrypt.hashSync(PASSWORD, 4);
  for (const key of ['a', 'b']) {
    names[key] = `rl-${key}-${Date.now().toString(36)}`;
    await pool.execute(
      "INSERT INTO users (shop_id, username, password_hash, full_name, role) VALUES (?, ?, ?, ?, 'office')",
      [shop.shopId, names[key], hash, `RL ${key}`]
    );
  }
});

afterAll(async () => {
  await pool.execute('DELETE FROM users WHERE shop_id = ?', [shop.shopId]);
  await dropShop(shop.shopId);
  await pool.end();
});

test('one account failing 10 times is blocked, a colleague on the same IP still gets in', async () => {
  for (let i = 0; i < 10; i += 1) {
    expect((await login(names.a, 'wrong')).status).toBe(401);
  }
  const blocked = await login(names.a, PASSWORD);
  expect(blocked.status).toBe(429);
  expect(blocked.body.error).toMatch(/นาที/);

  const colleague = await login(names.b, PASSWORD);
  expect(colleague.status).toBe(200);
  expect(colleague.body.token).toBeTruthy();
});

test('guessing many different usernames from one IP is stopped by the per-IP ceiling', async () => {
  let last;
  for (let i = 0; i < 30; i += 1) {
    last = await login(`nobody-${i}`, 'wrong', '10.0.0.2');
  }
  expect(last.status).toBe(401);
  expect((await login('nobody-next', 'wrong', '10.0.0.2')).status).toBe(429);
  // another IP is not affected
  expect((await login(names.b, PASSWORD, '10.0.0.3')).status).toBe(200);
});
