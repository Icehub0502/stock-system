// Platform console (dev): shops, groups, users, branch switching, owner overview, audit log.
const request = require('supertest');
const jwt = require('jsonwebtoken');
const pool = require('../src/db/pool');
const { createApp } = require('../src/app');
const { forgetShopStatus } = require('../src/middleware/auth');
const { getDevToken, getManagerToken, createShop, dropShop } = require('./helpers');

const app = createApp();
const as = (token) => ({ Authorization: `Bearer ${token}` });
const today = new Date().toISOString().slice(0, 10);

let devToken;
let managerToken;
const shopsToDrop = [];

beforeAll(async () => {
  devToken = await getDevToken();
  managerToken = await getManagerToken();
});

afterAll(async () => {
  for (const id of shopsToDrop) await dropShop(id);
  await pool.query("DELETE FROM shop_groups WHERE name LIKE 'Console test group%' AND NOT EXISTS (SELECT 1 FROM shops WHERE group_id = shop_groups.id)");
  await pool.query("DELETE FROM dev_audit_log WHERE action IN ('create_shop','switch_shop','update_shop','reset_password','disable_user') AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)");
  await pool.end();
});

describe('who may use the console', () => {
  test('dev only', async () => {
    const owner = (await createShop());
    shopsToDrop.push(owner.shopId);
    for (const t of [managerToken, owner.ownerToken, owner.token]) {
      for (const url of ['/api/dev/shops', '/api/dev/groups', '/api/dev/users', '/api/dev/overview', '/api/dev/audit']) {
        expect((await request(app).get(url).set(as(t))).status).toBe(403);
      }
    }
    for (const url of ['/api/dev/shops', '/api/dev/groups', '/api/dev/users', '/api/dev/overview', '/api/dev/audit']) {
      expect((await request(app).get(url).set(as(devToken))).status).toBe(200);
    }
  });
});

describe('creating and suspending a shop', () => {
  const code = `con-${Date.now().toString(36)}`;
  let created;

  test('validation', async () => {
    const base = { code, name: 'Console shop', new_group_name: 'Console test group', owner: { username: 'boss', password: 'password123' } };
    expect((await request(app).post('/api/dev/shops').set(as(devToken)).send({ ...base, code: 'A B' })).status).toBe(400);
    expect((await request(app).post('/api/dev/shops').set(as(devToken)).send({ ...base, owner: { username: 'boss', password: 'short' } })).status).toBe(400);
    expect((await request(app).post('/api/dev/shops').set(as(devToken)).send({ ...base, new_group_name: '' })).status).toBe(400);
    expect((await request(app).post('/api/dev/shops').set(as(devToken)).send({ ...base, code: 'champpower' })).status).toBe(409);
  });

  test('creates shop + group + owner; the owner logs in with the shop code and starts from number 1', async () => {
    const res = await request(app).post('/api/dev/shops').set(as(devToken)).send({
      code, name: 'Console shop', new_group_name: 'Console test group', owner: { username: 'boss', password: 'password123', full_name: 'The Boss' },
    });
    expect(res.status).toBe(201);
    created = res.body.data;
    shopsToDrop.push(created.id);

    const noCode = await request(app).post('/api/auth/login').send({ username: 'boss', password: 'password123' });
    expect(noCode.status).toBe(401); // 'boss' does not exist in the main shop
    const login = await request(app).post('/api/auth/login').send({ username: 'boss', password: 'password123', shop_code: code });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ role: 'owner', shop_id: created.id, home_shop_id: created.id });

    const reasons = await request(app).get('/api/settings/decline-reasons').set(as(login.body.token));
    expect(reasons.body.data.length).toBeGreaterThanOrEqual(4);

    const [[audit]] = await pool.query("SELECT username FROM dev_audit_log WHERE action = 'create_shop' AND shop_id = ?", [created.id]);
    expect(audit.username).toBeTruthy();
  });

  test('suspending blocks a token that is already in use, and logging in; dev can still enter; re-opening restores it', async () => {
    const login = await request(app).post('/api/auth/login').send({ username: 'boss', password: 'password123', shop_code: code });
    const token = login.body.token;
    expect((await request(app).get('/api/customers').set(as(token))).status).toBe(200);

    expect((await request(app).patch(`/api/dev/shops/${created.id}`).set(as(devToken)).send({ status: 'suspended' })).status).toBe(200);
    const blocked = await request(app).get('/api/customers').set(as(token));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatch(/ระงับ/);
    expect((await request(app).post('/api/auth/login').send({ username: 'boss', password: 'password123', shop_code: code })).status).toBe(401);

    const devInside = await request(app).post('/api/auth/switch-shop').set(as(devToken)).send({ shop_id: created.id });
    expect(devInside.status).toBe(200);
    expect((await request(app).get('/api/customers').set(as(devInside.body.token))).status).toBe(200);

    expect((await request(app).patch(`/api/dev/shops/${created.id}`).set(as(devToken)).send({ status: 'active' })).status).toBe(200);
    expect((await request(app).get('/api/customers').set(as(token))).status).toBe(200);
  });

  test('the shop of the administrator account cannot be suspended', async () => {
    const res = await request(app).patch('/api/dev/shops/1').set(as(devToken)).send({ status: 'suspended' });
    expect(res.status).toBe(400);
    forgetShopStatus();
  });
});

describe('users of every shop', () => {
  test('reset a password, switch an account off and on', async () => {
    const shop = await createShop();
    shopsToDrop.push(shop.shopId);
    const [[office]] = await pool.query("SELECT id FROM users WHERE shop_id = ? AND username = 'office'", [shop.shopId]);
    const [[shopRow]] = await pool.query('SELECT code FROM shops WHERE id = ?', [shop.shopId]);

    const list = await request(app).get(`/api/dev/users?shop_id=${shop.shopId}`).set(as(devToken));
    expect(list.body.data.map((u) => u.username).sort()).toEqual(['office', 'shopowner']);

    expect((await request(app).post(`/api/dev/users/${office.id}/reset-password`).set(as(devToken)).send({ new_password: 'short' })).status).toBe(400);
    expect((await request(app).post(`/api/dev/users/${office.id}/reset-password`).set(as(devToken)).send({ new_password: 'newpassword1' })).status).toBe(200);
    const login = () => request(app).post('/api/auth/login').send({ username: 'office', password: 'newpassword1', shop_code: shopRow.code });
    expect((await login()).status).toBe(200);

    expect((await request(app).patch(`/api/dev/users/${office.id}`).set(as(devToken)).send({ is_active: false })).status).toBe(200);
    expect((await login()).status).toBe(401);
    expect((await request(app).patch(`/api/dev/users/${office.id}`).set(as(devToken)).send({ is_active: true })).status).toBe(200);
    expect((await login()).status).toBe(200);
  });
});

describe('branches: switching and the owner overview', () => {
  let a; // owner's own branch
  let b; // sibling branch, same group
  let other; // a different group

  beforeAll(async () => {
    a = await createShop();
    b = await createShop({ groupId: a.groupId });
    other = await createShop();
    shopsToDrop.push(a.shopId, b.shopId, other.shopId);
  });

  test('an owner switches between the branches of their own group only', async () => {
    const branches = await request(app).get('/api/auth/branches').set(as(a.ownerToken));
    expect(branches.body.data.branches.map((x) => x.id).sort()).toEqual([a.shopId, b.shopId].sort());

    const sw = await request(app).post('/api/auth/switch-shop').set(as(a.ownerToken)).send({ shop_id: b.shopId });
    expect(sw.status).toBe(200);
    expect(sw.body.user).toMatchObject({ role: 'owner', shop_id: b.shopId, home_shop_id: a.shopId });
    // the new token works inside branch b
    expect((await request(app).get('/api/customers').set(as(sw.body.token))).status).toBe(200);

    // another group: same "not found" as a shop that does not exist
    const foreign = await request(app).post('/api/auth/switch-shop').set(as(a.ownerToken)).send({ shop_id: other.shopId });
    expect(foreign.status).toBe(404);
    const missing = await request(app).post('/api/auth/switch-shop').set(as(a.ownerToken)).send({ shop_id: 99999999 });
    expect(missing.status).toBe(404);
  });

  test('a manager cannot switch branch', async () => {
    const branches = await request(app).get('/api/auth/branches').set(as(a.managerToken));
    expect(branches.body.data.branches).toEqual([]);
    expect((await request(app).post('/api/auth/switch-shop').set(as(a.managerToken)).send({ shop_id: b.shopId })).status).toBe(404);
  });

  test('dev switches to any shop and it is written to the audit log', async () => {
    const sw = await request(app).post('/api/auth/switch-shop').set(as(devToken)).send({ shop_id: other.shopId });
    expect(sw.status).toBe(200);
    expect(sw.body.user.shop_id).toBe(other.shopId);
    const audit = await request(app).get(`/api/dev/audit?action=switch_shop&shop_id=${other.shopId}`).set(as(devToken));
    expect(audit.body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('owner overview: sums the owner group, never another group, and managers cannot open it', async () => {
    const mk = async (shop, name, amount) => {
      const [c] = await pool.query("INSERT INTO customers (shop_id, customer_code, customer_name, phone) VALUES (?, ?, ?, '')", [shop.shopId, `OV-${shop.shopId}`, name]);
      const [v] = await pool.query(
        "INSERT INTO vehicles (shop_id, customer_id, brand, model, license_plate) VALUES (?, ?, 'Toyota', 'Vios', ?)",
        [shop.shopId, c.insertId, `OV-${shop.shopId}`]
      );
      const [r] = await pool.query(
        "INSERT INTO receipts (shop_id, receipt_no, customer_id, vehicle_id, receipt_date, total_amount, payment_method) VALUES (?, ?, ?, ?, ?, ?, 'เงินสด')",
        [shop.shopId, `OV-${shop.shopId}`, c.insertId, v.insertId, today, amount]
      );
      return { customerId: c.insertId, vehicleId: v.insertId, receiptId: r.insertId };
    };
    const ra = await mk(a, 'OV A', 1000);
    const rb = await mk(b, 'OV B', 500);
    const ro = await mk(other, 'OV Other', 7777);
    try {
      const res = await request(app).get(`/api/owner/overview?from=${today}&to=${today}`).set(as(a.ownerToken));
      expect(res.status).toBe(200);
      const byId = Object.fromEntries(res.body.data.branches.map((x) => [x.shop_id, x]));
      expect(Object.keys(byId).map(Number).sort()).toEqual([a.shopId, b.shopId].sort());
      expect(byId[a.shopId].total_revenue).toBe(1000);
      expect(byId[b.shopId].total_revenue).toBe(500);
      expect(byId[a.shopId].by_method['เงินสด']).toMatchObject({ bill_count: 1, total: 1000 });
      expect(res.body.data.total.total_revenue).toBe(1500);

      expect((await request(app).get(`/api/owner/overview?from=${today}&to=${today}`).set(as(a.managerToken))).status).toBe(403);
      expect((await request(app).get('/api/owner/overview?from=2026-02-30x').set(as(a.ownerToken))).status).toBe(400);
    } finally {
      for (const r of [ra, rb, ro]) {
        await pool.query('DELETE FROM receipts WHERE id = ?', [r.receiptId]);
        await pool.query('DELETE FROM vehicles WHERE id = ?', [r.vehicleId]);
        await pool.query('DELETE FROM customers WHERE id = ?', [r.customerId]);
      }
    }
  });
});
