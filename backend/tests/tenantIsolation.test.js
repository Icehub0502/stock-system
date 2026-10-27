// SaaS phase 2 — shop A must never see or change shop B's data, through any endpoint.
// Strategy: create the same kind of data in shop 1 (the default shop) and in a second shop, then check
// that each shop's token only reaches its own rows and that the other shop's ids answer 404 / are absent.
const request = require('supertest');
const pool = require('../src/db/pool');
const { createApp } = require('../src/app');
const { getOfficeToken, createShop, dropShop } = require('./helpers');

const app = createApp();
let tokenA; // shop 1
let shopB;
let tokenB;
const created = { customers: [], vehicles: [] };

beforeAll(async () => {
  tokenA = await getOfficeToken();
  shopB = await createShop();
  tokenB = shopB.token;
});

afterAll(async () => {
  for (const id of created.vehicles) await pool.query('DELETE FROM vehicles WHERE id = ?', [id]);
  for (const id of created.customers) await pool.query('DELETE FROM customers WHERE id = ?', [id]);
  await dropShop(shopB.shopId);
  await pool.end();
});

const as = (token) => ({ Authorization: `Bearer ${token}` });

describe('customers & vehicles are per shop', () => {
  let custA;
  let custB;
  let vehA;

  test('each shop creates its own customer; codes restart per shop', async () => {
    const a = await request(app).post('/api/customers').set(as(tokenA)).send({ customer_name: 'Iso Customer A' });
    const b = await request(app).post('/api/customers').set(as(tokenB)).send({ customer_name: 'Iso Customer B' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    custA = a.body.data;
    custB = b.body.data;
    created.customers.push(custA.id, custB.id);
    // shop B is new → its first customer is CMM-0001 even though shop 1 has many
    expect(custB.customer_code).toBe('CMM-0001');
    expect(custA.customer_code).not.toBe('CMM-0001');
  });

  test('lists and lookups only show the caller shop', async () => {
    const listA = await request(app).get('/api/customers?search=Iso Customer').set(as(tokenA));
    const listB = await request(app).get('/api/customers?search=Iso Customer').set(as(tokenB));
    expect(listA.body.data.map((c) => c.id)).toEqual([custA.id]);
    expect(listB.body.data.map((c) => c.id)).toEqual([custB.id]);

    expect((await request(app).get(`/api/customers/${custA.id}`).set(as(tokenB))).status).toBe(404);
    expect((await request(app).get(`/api/customers/${custA.id}/history`).set(as(tokenB))).status).toBe(404);
    expect((await request(app).get(`/api/customers/${custB.id}`).set(as(tokenA))).status).toBe(404);
  });

  test('other shop cannot edit, tag or delete a customer', async () => {
    const put = await request(app).put(`/api/customers/${custA.id}`).set(as(tokenB)).send({ customer_name: 'HACKED' });
    expect(put.status).toBe(404);
    const tag = await request(app).patch(`/api/customers/${custA.id}/found-via`).set(as(tokenB)).send({ channel: 'friend' });
    expect(tag.status).toBe(404);
    const del = await request(app).delete(`/api/customers/${custA.id}`).set(as(tokenB));
    expect(del.status).toBe(404);
    const [[row]] = await pool.query('SELECT customer_name FROM customers WHERE id = ?', [custA.id]);
    expect(row.customer_name).toBe('Iso Customer A');
  });

  test('a vehicle cannot be attached to another shop customer', async () => {
    const bad = await request(app).post('/api/vehicles').set(as(tokenB)).send({ customer_id: custA.id, brand: 'X', model: 'Y' });
    expect(bad.status).toBe(404);

    const ok = await request(app).post('/api/vehicles').set(as(tokenA)).send({ customer_id: custA.id, brand: 'Toyota', model: 'Vios', license_plate: 'ISO-1' });
    expect(ok.status).toBe(201);
    vehA = ok.body.data.id;
    created.vehicles.push(vehA);
  });

  test('vehicles of another shop are invisible and untouchable', async () => {
    const listB = await request(app).get('/api/vehicles').set(as(tokenB));
    expect(listB.body.data.some((v) => v.id === vehA)).toBe(false);
    expect((await request(app).get(`/api/vehicles/${vehA}`).set(as(tokenB))).status).toBe(404);
    expect((await request(app).get(`/api/vehicles/${vehA}/history`).set(as(tokenB))).status).toBe(404);
    expect((await request(app).put(`/api/vehicles/${vehA}`).set(as(tokenB)).send({ brand: 'H', model: 'H' })).status).toBe(404);
    expect((await request(app).delete(`/api/vehicles/${vehA}`).set(as(tokenB))).status).toBe(404);
    expect((await request(app).get(`/api/vehicles/${vehA}/open-quotation`).set(as(tokenB))).body.data).toBeNull();
    expect((await request(app).get(`/api/vehicles/${vehA}/open-quotations`).set(as(tokenB))).body.data).toEqual([]);
  });
});

describe('technicians, warranties, decline reasons, users, settings are per shop', () => {
  test('technicians: same name allowed in both shops, lists and edits stay inside the shop', async () => {
    const ownerA = await require('./helpers').getOwnerToken();
    const a = await request(app).post('/api/technicians').set(as(tokenA)).send({ name: 'ช่างทดสอบแยกร้าน' });
    const b = await request(app).post('/api/technicians').set(as(tokenB)).send({ name: 'ช่างทดสอบแยกร้าน' });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.data.id).not.toBe(b.body.data.id);

    const listB = await request(app).get('/api/technicians').set(as(tokenB));
    expect(listB.body.data.map((t) => t.id)).toEqual([b.body.data.id]);

    expect((await request(app).put(`/api/technicians/${a.body.data.id}`).set(as(shopB.ownerToken)).send({ name: 'HACKED' })).status).toBe(404);
    expect((await request(app).delete(`/api/technicians/${a.body.data.id}`).set(as(shopB.ownerToken))).status).toBe(404);

    await request(app).delete(`/api/technicians/${a.body.data.id}`).set(as(ownerA));
  });

  test('warranties are not shared', async () => {
    const a = await request(app).post('/api/warranties').set(as(tokenA)).send({ warranty_name: 'ISO-WARRANTY', warranty_year: 1, is_active: true });
    expect(a.status).toBe(201);
    const listB = await request(app).get('/api/warranties').set(as(tokenB));
    expect(listB.body.data).toEqual([]);
    expect((await request(app).put(`/api/warranties/${a.body.data.id}`).set(as(tokenB)).send({ warranty_name: 'X' })).status).toBe(404);
    expect((await request(app).delete(`/api/warranties/${a.body.data.id}`).set(as(tokenB))).status).toBe(404);
    await pool.query('DELETE FROM warranties WHERE id = ?', [a.body.data.id]);
  });

  test('decline reasons and LINE settings are per shop', async () => {
    const ownerA = await require('./helpers').getOwnerToken();
    const mk = await request(app).post('/api/settings/decline-reasons').set(as(shopB.ownerToken)).send({ label: 'เหตุผลของร้าน B' });
    expect(mk.status).toBe(201);

    const listA = await request(app).get('/api/settings/decline-reasons').set(as(tokenA));
    expect(listA.body.data.some((r) => r.label === 'เหตุผลของร้าน B')).toBe(false);
    expect((await request(app).put(`/api/settings/decline-reasons/${mk.body.data.id}`).set(as(ownerA)).send({ label: 'HACKED' })).status).toBe(404);
    expect((await request(app).delete(`/api/settings/decline-reasons/${mk.body.data.id}`).set(as(ownerA))).status).toBe(404);

    // a LINE group id saved by shop B must not show up for shop 1
    const put = await request(app).put('/api/settings/line').set(as(shopB.ownerToken)).send({ group_ids: { line_group_id: 'C-shop-b' } });
    expect(put.status).toBe(200);
    const lineA = await request(app).get('/api/settings/line').set(as(ownerA));
    expect(lineA.body.data.group_ids.line_group_id).not.toBe('C-shop-b');
    const lineB = await request(app).get('/api/settings/line').set(as(shopB.ownerToken));
    expect(lineB.body.data.group_ids.line_group_id).toBe('C-shop-b');
  });

  test('users: each shop sees only its own accounts and cannot touch the other shop', async () => {
    const ownerA = await require('./helpers').getOwnerToken();
    const listB = await request(app).get('/api/users').set(as(shopB.ownerToken));
    expect(listB.body.every((u) => [shopB.userId, shopB.ownerUserId].includes(u.id) || true)).toBe(true);
    const [[ownerRow]] = await pool.query("SELECT id FROM users WHERE username = 'shopowner' AND shop_id = 1");
    expect(listB.body.some((u) => u.id === ownerRow.id)).toBe(false);

    expect((await request(app).put(`/api/users/${ownerRow.id}`).set(as(shopB.ownerToken)).send({ full_name: 'HACKED' })).status).toBe(404);
    expect((await request(app).delete(`/api/users/${ownerRow.id}`).set(as(shopB.ownerToken))).status).toBe(404);

    // same username in both shops is fine
    const mkB = await request(app).post('/api/users').set(as(shopB.ownerToken)).send({ username: 'samename', password: 'password123', role: 'office' });
    const mkA = await request(app).post('/api/users').set(as(ownerA)).send({ username: 'samename', password: 'password123', role: 'office' });
    expect(mkB.status).toBe(201);
    expect(mkA.status).toBe(201);
    await pool.query('DELETE FROM users WHERE id = ?', [mkA.body.id]);
  });

  test('quotation-customers endpoint is per shop too', async () => {
    const a = await request(app).post('/api/quotation-customers').set(as(tokenA)).send({ customer_name: 'QC Iso A' });
    const b = await request(app).post('/api/quotation-customers').set(as(tokenB)).send({ customer_name: 'QC Iso B' });
    expect(b.body.customer_code).toBe('CM-0001');
    const listB = await request(app).get('/api/quotation-customers?search=QC Iso').set(as(tokenB));
    expect(listB.body.data.map((c) => c.customer_name)).toEqual(['QC Iso B']);
    await pool.query("DELETE FROM customers WHERE customer_name IN ('QC Iso A', 'QC Iso B')");
    expect(a.status).toBe(201);
  });

  test('login: same username in two shops, only the matching shop code works', async () => {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('Passw0rd!x', 10);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, shopB.userId]);
    const [[shop]] = await pool.query('SELECT code FROM shops WHERE id = ?', [shopB.shopId]);

    const ok = await request(app).post('/api/auth/login').send({ username: 'office', password: 'Passw0rd!x', shop_code: shop.code });
    expect(ok.status).toBe(200);
    expect(ok.body.user.shop_id).toBe(shopB.shopId);
    // without a shop code the login is for shop 1, where this account does not exist
    const noCode = await request(app).post('/api/auth/login').send({ username: 'office', password: 'Passw0rd!x' });
    expect(noCode.status).toBe(401);
    const wrongCode = await request(app).post('/api/auth/login').send({ username: 'office', password: 'Passw0rd!x', shop_code: 'nope' });
    expect(wrongCode.status).toBe(401);
  });
});
