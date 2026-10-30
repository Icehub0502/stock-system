// Vehicle history page API: what was done to a car, which warranties still run, parts changed, and shop isolation.
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
const receiptIds = [];

async function addReceipt(date, mileage, items) {
  const [r] = await pool.query(
    'INSERT INTO receipts (shop_id, receipt_no, receipt_date, customer_id, vehicle_id, mileage, total_amount) VALUES (?, ?, ?, ?, ?, ?, 0)',
    [shopA.shopId, `VH${unique}${receiptIds.length}`.slice(0, 30), date, customerId, vehicleId, mileage]
  );
  receiptIds.push(r.insertId);
  for (const it of items) {
    await pool.query(
      'INSERT INTO receipt_items (receipt_id, service_item_id, product_name_snapshot, qty, price, amount, warranty_year, warranty_month, warranty_km) VALUES (?, ?, ?, 1, 1000, 1000, ?, ?, ?)',
      [r.insertId, it.serviceItemId || null, it.name, it.y || 0, it.m || 0, it.km || 0]
    );
  }
}

beforeAll(async () => {
  shopA = await createShop();
  shopB = await createShop();
  const [w] = await pool.query('INSERT INTO warranties (shop_id, warranty_name, warranty_year, warranty_month, warranty_km, is_active) VALUES (?, ?, 1, 0, 100000, 1)', [shopA.shopId, 'ลูกหมาก 1 ปี']);
  const [rack] = await pool.query("INSERT INTO service_items (shop_id, category, product_name, warranty_id) VALUES (?, 'แร็คพวงมาลัย', ?, ?)", [shopA.shopId, `แร็ค VH ${unique}`, w.insertId]);
  await pool.query("INSERT INTO service_items (shop_id, category, product_name) VALUES (?, 'ส่วนลด', ?)", [shopA.shopId, `ส่วนลด VH ${unique}`]);
  customerId = (await pool.query('INSERT INTO customers (shop_id, customer_name, phone) VALUES (?, ?, ?)', [shopA.shopId, `VH ลูกค้า ${unique}`, '089-123-4567']))[0].insertId;
  vehicleId = (await pool.query('INSERT INTO vehicles (shop_id, customer_id, brand, model, license_plate) VALUES (?, ?, ?, ?, ?)', [shopA.shopId, customerId, 'Toyota', 'Vios', `VH${unique}`.slice(0, 15)]))[0].insertId;

  // recent: rack (warranty only in the configuration), ball joint with the warranty stored, a discount and a labour line
  await addReceipt(daysAgo(30), 50000, [
    { name: `แร็ค VH ${unique}`, serviceItemId: rack.insertId },
    { name: 'ลูกหมากล่าง', y: 1, km: 100000 },
    { name: `ส่วนลด VH ${unique}` },
    { name: 'ค่าแรงลูกหมากล่าง' },
  ]);
  // old: a 6 month warranty that has run out
  await addReceipt(daysAgo(400), 20000, [{ name: 'แบตเตอรี่', m: 6 }]);
});

afterAll(async () => {
  await pool.query('DELETE FROM receipts WHERE shop_id = ?', [shopA.shopId]);
  await pool.query('DELETE FROM claims WHERE shop_id = ?', [shopA.shopId]);
  await pool.query('DELETE FROM vehicles WHERE shop_id = ?', [shopA.shopId]);
  await pool.query('DELETE FROM customers WHERE shop_id = ?', [shopA.shopId]);
  await pool.query('DELETE FROM service_items WHERE shop_id = ?', [shopA.shopId]);
  await pool.query('DELETE FROM warranties WHERE shop_id = ?', [shopA.shopId]);
  await dropShop(shopA.shopId);
  await dropShop(shopB.shopId);
  await pool.end();
});

describe('vehicle history', () => {
  test('search finds the car by plate or customer; another shop sees nothing', async () => {
    const byPlate = await request(app).get(`/api/vehicle-history/search?search=VH${unique}`).set(as(shopA.token));
    expect(byPlate.status).toBe(200);
    expect(byPlate.body.data.map((r) => r.vehicle_id)).toContain(vehicleId);
    expect(byPlate.body.data[0].last_receipt_date).toBe(daysAgo(30));
    const byName = await request(app).get(`/api/vehicle-history/search?search=${encodeURIComponent(`ลูกค้า ${unique}`)}`).set(as(shopA.token));
    expect(byName.body.data.map((r) => r.vehicle_id)).toEqual([vehicleId]);
    // a phone typed without dashes finds the same car
    const byPhone = await request(app).get('/api/vehicle-history/search?search=0891234567').set(as(shopA.token));
    expect(byPhone.body.data.map((r) => r.vehicle_id)).toEqual([vehicleId]);
    const other = await request(app).get(`/api/vehicle-history/search?search=VH${unique}`).set(as(shopB.token));
    expect(other.body.data).toEqual([]);
  });

  test('warranties that still run, expired ones left out, parts changed without discounts and labour', async () => {
    const res = await request(app).get(`/api/vehicle-history/${vehicleId}`).set(as(shopA.token));
    expect(res.status).toBe(200);
    const { active_warranties: active, changed_items: changed, visits } = res.body.data;

    // the rack (configured warranty) and the ball joint (stored warranty) share one line: 1 year 100,000 km
    expect(active).toHaveLength(1);
    expect(active[0].label).toBe('1 ปี 100,000 กม.');
    expect(active[0].items.map((i) => i.name).sort()).toEqual([`แร็ค VH ${unique}`, 'ลูกหมากล่าง'].sort());
    expect(active[0].items.find((i) => i.name === 'ลูกหมากล่าง').km_limit).toBe(150000);

    expect(changed.map((c) => c.name).sort()).toEqual([`แร็ค VH ${unique}`, 'ลูกหมากล่าง', 'แบตเตอรี่'].sort());
    const battery = visits.find((v) => v.date === daysAgo(400)).items[0];
    expect(battery.warranty).toMatchObject({ label: '6 เดือน', active: false });
    expect(visits.map((v) => v.date)).toEqual([daysAgo(30), daysAgo(400)]);
  });

  test('another shop cannot open the car; bad ids are refused; login is required', async () => {
    expect((await request(app).get(`/api/vehicle-history/${vehicleId}`).set(as(shopB.token))).status).toBe(404);
    expect((await request(app).get('/api/vehicle-history/abc').set(as(shopA.token))).status).toBe(400);
    expect((await request(app).get(`/api/vehicle-history/${vehicleId}`)).status).toBe(401);
  });
});
