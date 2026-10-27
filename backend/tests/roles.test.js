// Role levels: technician < office < manager < owner < dev.
// A higher role never loses what a lower one can do; manager adds money figures + deleting/cancelling
// documents + part prices/technicians/settings; owner adds user accounts; dev is the platform admin.
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { getOfficeToken, getManagerToken, getOwnerToken, getDevToken, getTechnicianToken, createShop, dropShop } = require('./helpers');

const app = createApp();
const as = (token) => ({ Authorization: `Bearer ${token}` });

let tokens;
let shop;

beforeAll(async () => {
  tokens = {
    technician: await getTechnicianToken(),
    office: await getOfficeToken(),
    manager: await getManagerToken(),
    owner: await getOwnerToken(),
    dev: await getDevToken(),
  };
  shop = await createShop();
});

afterAll(async () => {
  await dropShop(shop.shopId);
  await pool.end();
});

describe('office-level routes: office and every higher role, not technician', () => {
  test('GET /api/customers', async () => {
    expect((await request(app).get('/api/customers').set(as(tokens.technician))).status).toBe(403);
    for (const role of ['office', 'manager', 'owner', 'dev']) {
      expect((await request(app).get('/api/customers').set(as(tokens[role]))).status).toBe(200);
    }
  });
});

describe('manager-level routes: sales figures, costs, settings, part prices', () => {
  const cases = [
    ['get', '/api/receipts/daily-summary'],
    ['get', '/api/receipts/monthly-summary'],
    ['get', '/api/receipts/top-products'],
    ['get', '/api/product-costs'],
    ['get', '/api/settings/line'],
  ];

  test.each(cases)('%s %s: office denied, manager and above allowed', async (method, url) => {
    expect((await request(app)[method](url).set(as(tokens.technician))).status).toBe(403);
    expect((await request(app)[method](url).set(as(tokens.office))).status).toBe(403);
    for (const role of ['manager', 'owner', 'dev']) {
      const res = await request(app)[method](url).set(as(tokens[role]));
      expect(res.status).toBe(200);
    }
  });

  test('office can read part prices but not change them', async () => {
    expect((await request(app).get('/api/quote-parts/brands').set(as(tokens.office))).status).toBe(200);
    expect((await request(app).post('/api/quote-parts').set(as(tokens.office))
      .send({ brand: 'RoleBrand', model: 'M', part_name: 'P', price: 1 })).status).toBe(403);
    const created = await request(app).post('/api/quote-parts').set(as(tokens.manager))
      .send({ brand: 'RoleBrand', model: 'M', part_name: 'P', price: 1 });
    expect(created.status).toBe(201);
    expect((await request(app).delete(`/api/quote-parts/${created.body.data.id}`).set(as(tokens.office))).status).toBe(403);
    expect((await request(app).delete(`/api/quote-parts/${created.body.data.id}`).set(as(tokens.manager))).status).toBe(200);
  });

  test('deleting / cancelling documents needs manager', async () => {
    // 403 is returned before the 404 for a missing id, so no fixture rows are needed
    expect((await request(app).delete('/api/receipts/99999999').set(as(tokens.office))).status).toBe(403);
    expect((await request(app).delete('/api/quotations/99999999').set(as(tokens.office))).status).toBe(403);
    expect((await request(app).patch('/api/quotations/99999999/reopen').set(as(tokens.office))).status).toBe(403);
    expect((await request(app).delete('/api/jobs/99999999').set(as(tokens.office))).status).toBe(403);
    expect((await request(app).delete('/api/claims/99999999').set(as(tokens.office))).status).toBe(403);
    expect((await request(app).delete('/api/receipts/99999999').set(as(tokens.manager))).status).toBe(404);
    expect((await request(app).delete('/api/quotations/99999999').set(as(tokens.manager))).status).toBe(404);
    expect((await request(app).delete('/api/jobs/99999999').set(as(tokens.manager))).status).toBe(404);
  });

  test('technicians: office can add, only manager and above can edit or delete', async () => {
    expect((await request(app).put('/api/technicians/99999999').set(as(tokens.office)).send({ name: 'x' })).status).toBe(403);
    expect((await request(app).delete('/api/technicians/99999999').set(as(tokens.office))).status).toBe(403);
    expect((await request(app).delete('/api/technicians/99999999').set(as(tokens.manager))).status).toBe(404);
  });
});

describe('user accounts: owner and above only', () => {
  test('office and manager cannot open the users API', async () => {
    for (const role of ['technician', 'office', 'manager']) {
      expect((await request(app).get('/api/users').set(as(tokens[role]))).status).toBe(403);
    }
    expect((await request(app).get('/api/users').set(as(tokens.owner))).status).toBe(200);
  });

  test('dev accounts are hidden from the owner and cannot be created, edited or deleted by them', async () => {
    const [dev] = await pool.query(
      "INSERT INTO users (shop_id, username, password_hash, full_name, role) VALUES (?, 'hiddendev', 'x', 'Hidden dev', 'dev')",
      [shop.shopId]
    );
    try {
      const ownerList = await request(app).get('/api/users').set(as(shop.ownerToken));
      expect(ownerList.body.map((u) => u.username)).not.toContain('hiddendev');

      const devToken = jwt.sign({ id: dev.insertId, username: 'hiddendev', role: 'dev', shop_id: shop.shopId }, process.env.JWT_SECRET);
      const devList = await request(app).get('/api/users').set(as(devToken));
      expect(devList.body.map((u) => u.username)).toContain('hiddendev');

      expect((await request(app).put(`/api/users/${dev.insertId}`).set(as(shop.ownerToken)).send({ full_name: 'x' })).status).toBe(404);
      expect((await request(app).delete(`/api/users/${dev.insertId}`).set(as(shop.ownerToken))).status).toBe(404);
      expect((await request(app).post('/api/users').set(as(shop.ownerToken))
        .send({ username: 'wannabe', password: 'password123', role: 'dev' })).status).toBe(400);
    } finally {
      await pool.query('DELETE FROM users WHERE id = ?', [dev.insertId]);
    }
  });

  test('owner can create a manager and an owner, but not set anyone to dev', async () => {
    for (const role of ['manager', 'owner']) {
      const res = await request(app).post('/api/users').set(as(shop.ownerToken))
        .send({ username: `new_${role}`, password: 'password123', role });
      expect(res.status).toBe(201);
      expect(res.body.role).toBe(role);
    }
    const [[office]] = await pool.query("SELECT id FROM users WHERE shop_id = ? AND username = 'office'", [shop.shopId]);
    expect((await request(app).put(`/api/users/${office.id}`).set(as(shop.ownerToken)).send({ role: 'dev' })).status).toBe(400);
    expect((await request(app).put(`/api/users/${office.id}`).set(as(shop.ownerToken)).send({ role: 'manager' })).status).toBe(200);
  });
});
