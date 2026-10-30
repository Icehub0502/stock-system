// Branch manager page: cars by status with stuck ones flagged, quotations to chase, today's money, deposits, low stock.
const request = require('supertest');
const pool = require('../src/db/pool');
const { createApp } = require('../src/app');
const { createShop, dropShop } = require('./helpers');

const app = createApp();
const as = (token) => ({ Authorization: `Bearer ${token}` });
const unique = Date.now().toString(36);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

let shopA;
let shopB;
let customerId;
let vehicleId;
let categoryId;
let n = 0;

async function addJob(status, daysIn) {
  n += 1;
  await pool.query(
    'INSERT INTO jobs (shop_id, job_no, job_date, customer_id, vehicle_id, status, received_at) VALUES (?, ?, ?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL ? DAY))',
    [shopA.shopId, `MG${unique}${n}`.slice(0, 20), daysAgo(daysIn), customerId, vehicleId, status, daysIn]
  );
}
async function addQuotation(status, daysOld, { declineLabel, deposit } = {}) {
  n += 1;
  let reason = null;
  if (declineLabel) [[{ id: reason }]] = await pool.query('SELECT id FROM decline_reasons WHERE label = ?', [declineLabel]);
  await pool.query(
    'INSERT INTO quotations (shop_id, quotation_no, quotation_date, customer_id, vehicle_id, status, total_amount, decline_reason, deposit_amount, deposit_date) VALUES (?, ?, ?, ?, ?, ?, 5000, ?, ?, ?)',
    [shopA.shopId, `MQ${unique}${n}`.slice(0, 20), daysAgo(daysOld), customerId, vehicleId, status, reason === null ? null : String(reason), deposit || null, deposit ? daysAgo(1) : null]
  );
}

beforeAll(async () => {
  shopA = await createShop();
  shopB = await createShop();
  customerId = (await pool.query('INSERT INTO customers (shop_id, customer_name, phone) VALUES (?, ?, ?)', [shopA.shopId, `Mgr ${unique}`, '0812345678']))[0].insertId;
  vehicleId = (await pool.query('INSERT INTO vehicles (shop_id, customer_id, brand, model, license_plate) VALUES (?, ?, ?, ?, ?)', [shopA.shopId, customerId, 'Toyota', 'Vios', `MG${unique}`.slice(0, 15)]))[0].insertId;
  // the page counts from this day on; the fixtures below are all newer
  await pool.query("INSERT INTO app_settings (shop_id, `key`, value) VALUES (?, 'manager_page_since', ?)", [shopA.shopId, daysAgo(30)]);
  categoryId = (await pool.query('INSERT INTO stock_categories (name) VALUES (?)', [`MgrCat ${unique}`]))[0].insertId;

  await addJob('inspecting', 5); // stuck
  await addJob('repairing', 0);
  await addJob('delivered', 9); // not in the shop any more
  await addQuotation('pending', 4);
  await addQuotation('declined', 6, { declineLabel: 'นำรถมาทำวันอื่น' });
  await addQuotation('declined', 6, { declineLabel: 'ราคาสูงไป' }); // lost for good: not chased
  await addQuotation('scheduled', 2, { deposit: 500 });
  // started before the page's start day: left out of everything
  await addJob('inspecting', 40);
  await addQuotation('pending', 45);
  await pool.query(
    'INSERT INTO receipts (shop_id, receipt_no, receipt_date, customer_id, vehicle_id, total_amount, payment_method) VALUES (?, ?, CURDATE(), ?, ?, 1200, ?)',
    [shopA.shopId, `MR${unique}`.slice(0, 30), customerId, vehicleId, 'เงินสด']
  );
  await pool.query('INSERT INTO stock_items (shop_id, category_id, oem_code, description, stock_qty, min_stock) VALUES (?, ?, ?, ?, 1, 3)', [shopA.shopId, categoryId, `LOW${unique}`, 'low item']);
});

afterAll(async () => {
  await pool.query('DELETE FROM jobs WHERE shop_id = ?', [shopA.shopId]);
  await pool.query('DELETE FROM receipts WHERE shop_id = ?', [shopA.shopId]);
  await pool.query('DELETE FROM quotations WHERE shop_id = ?', [shopA.shopId]);
  await pool.query('DELETE FROM stock_items WHERE shop_id = ?', [shopA.shopId]);
  await pool.query('DELETE FROM stock_categories WHERE id = ?', [categoryId]);
  await pool.query('DELETE FROM vehicles WHERE shop_id = ?', [shopA.shopId]);
  await pool.query('DELETE FROM customers WHERE shop_id = ?', [shopA.shopId]);
  await dropShop(shopA.shopId);
  await dropShop(shopB.shopId);
  await pool.end();
});

describe('manager page', () => {
  test('managers only', async () => {
    expect((await request(app).get('/api/manager/today').set(as(shopA.token))).status).toBe(403);
    expect((await request(app).get('/api/manager/today')).status).toBe(401);
    expect((await request(app).get('/api/manager/today').set(as(shopA.managerToken))).status).toBe(200);
  });

  test('cars by status: stuck ones flagged and first, closed ones absent', async () => {
    const { body } = await request(app).get('/api/manager/today').set(as(shopA.managerToken));
    const g = Object.fromEntries(body.data.cars.groups.map((x) => [x.key, x.cars]));
    expect(g.inspect).toHaveLength(1);
    expect(g.inspect[0]).toMatchObject({ overdue: true, overdue_reason: 'stuck', days_in_shop: 5 });
    expect(g.repair).toHaveLength(1);
    expect(g.repair[0].overdue).toBe(false);
    expect(body.data.cars.total).toBe(2);
    expect(body.data.cars.overdue_count).toBe(1);
  });

  test('quotations to chase: unanswered and "not now" declines, not the lost ones', async () => {
    const { body } = await request(app).get('/api/manager/today').set(as(shopA.managerToken));
    const kinds = body.data.chase.items.map((q) => q.kind).sort();
    expect(kinds).toEqual(['later', 'waiting']);
    expect(body.data.chase.total_value).toBe(10000);
    expect(body.data.chase.items.every((q) => q.phone === '0812345678')).toBe(true);
  });

  test('today\'s money by method, open deposits and low stock', async () => {
    const { body } = await request(app).get('/api/manager/today').set(as(shopA.managerToken));
    expect(body.data.money).toMatchObject({ bill_count: 1, total: 1200 });
    expect(body.data.money.by_method).toEqual([{ method: 'เงินสด', bill_count: 1, total: 1200 }]);
    expect(body.data.deposits.total).toBe(500);
    expect(body.data.stock.low_count).toBe(1);
    expect(body.data.stock.items[0]).toMatchObject({ oem_code: `LOW${unique}`, stock_qty: 1, min_stock: 3 });
  });

  test('another shop sees none of it', async () => {
    const { body } = await request(app).get('/api/manager/today').set(as(shopB.managerToken));
    expect(body.data.cars.total).toBe(0);
    expect(body.data.chase.items).toEqual([]);
    expect(body.data.money.total).toBe(0);
    expect(body.data.stock.low_count).toBe(0);
  });
});
