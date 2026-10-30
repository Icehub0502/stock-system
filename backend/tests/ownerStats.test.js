// Owner numbers: periods against earlier ones, close rate, channels, unusual events, forecast, group isolation.
const request = require('supertest');
const pool = require('../src/db/pool');
const { createApp } = require('../src/app');
const { createShop, dropShop } = require('./helpers');
const { buildForecast } = require('../src/routes/ownerStats.routes');

const app = createApp();
const as = (token) => ({ Authorization: `Bearer ${token}` });
const unique = Date.now().toString(36);
const dayOffset = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

let shopA;
let shopB;
let customerId;
let vehicleId;
let n = 0;

async function addReceipt(date, total, items = []) {
  n += 1;
  const [r] = await pool.query(
    'INSERT INTO receipts (shop_id, receipt_no, receipt_date, customer_id, vehicle_id, total_amount) VALUES (?, ?, ?, ?, ?, ?)',
    [shopA.shopId, `OS${unique}${n}`.slice(0, 30), date, customerId, vehicleId, total]
  );
  for (const it of items) {
    await pool.query('INSERT INTO receipt_items (receipt_id, product_name_snapshot, qty, price, amount) VALUES (?, ?, 1, ?, ?)', [r.insertId, it.name, it.amount, it.amount]);
  }
  return r.insertId;
}

async function addQuotation(status, total, reasonLabel = null) {
  n += 1;
  let reason = null;
  if (reasonLabel) [[{ id: reason }]] = await pool.query('SELECT id FROM decline_reasons WHERE label = ?', [reasonLabel]);
  await pool.query(
    'INSERT INTO quotations (shop_id, quotation_no, quotation_date, customer_id, vehicle_id, status, total_amount, decline_reason) VALUES (?, ?, CURDATE(), ?, ?, ?, ?, ?)',
    [shopA.shopId, `OQ${unique}${n}`.slice(0, 20), customerId, vehicleId, status, total, reason === null ? null : String(reason)]
  );
}

beforeAll(async () => {
  shopA = await createShop();
  shopB = await createShop();
  customerId = (await pool.query("INSERT INTO customers (shop_id, customer_code, customer_name, phone, found_via) VALUES (?, 'OS-1', ?, NULL, 'facebook')", [shopA.shopId, `Owner ${unique}`]))[0].insertId;
  vehicleId = (await pool.query('INSERT INTO vehicles (shop_id, customer_id, brand, model, license_plate) VALUES (?, ?, ?, ?, ?)', [shopA.shopId, customerId, 'Toyota', 'Vios', `OS${unique}`.slice(0, 15)]))[0].insertId;

  // eight earlier months of sales, growing, and two receipts today
  for (let i = 8; i >= 1; i -= 1) await addReceipt(dayOffset(i * 31), 10000 + (8 - i) * 1000);
  await addReceipt(dayOffset(0), 1000, [{ name: 'ลูกหมาก', amount: 1200 }, { name: 'ส่วนลด', amount: -200 }]);
  await addReceipt(dayOffset(0), 500);
  await addQuotation('approved', 3000);
  await addQuotation('pending', 2000);
  await addQuotation('declined', 1000, 'ราคาสูงไป');
});

afterAll(async () => {
  await pool.query('DELETE FROM receipts WHERE shop_id = ?', [shopA.shopId]);
  await pool.query('DELETE FROM quotations WHERE shop_id = ?', [shopA.shopId]);
  await pool.query('DELETE FROM vehicles WHERE shop_id = ?', [shopA.shopId]);
  await pool.query('DELETE FROM customers WHERE shop_id = ?', [shopA.shopId]);
  await dropShop(shopA.shopId);
  await dropShop(shopB.shopId);
  await pool.end();
});

describe('forecast maths', () => {
  const months = (list) => list.map((revenue, i) => ({ month: `2026-0${i + 1}`, revenue }));

  test('a straight trend continues, the running month follows its run rate, the year total adds up', () => {
    const f = buildForecast({ monthly: months([1000, 2000, 3000]), today: '2026-10-15', monthToDate: 1500, yearToDate: 20000 });
    expect(f.months_used).toBe(3);
    expect(f.confidence).toBe('low');
    expect(f.run_rate).toBe(3100); // 1500 / 15 * 31
    expect(f.months[0]).toMatchObject({ month: '2026-10', basis: 'run_rate', likely: 3100 });
    expect(f.months[1]).toMatchObject({ month: '2026-11', basis: 'trend', likely: 5000, low: 5000, high: 5000 });
    expect(f.months[2]).toMatchObject({ month: '2026-12', likely: 6000 });
    expect(f.months[3].month).toBe('2027-01');
    // 20000 so far + rest of October (3100 - 1500) + November + December
    expect(f.year_end.likely).toBe(20000 + 1600 + 5000 + 6000);
  });

  test('nothing sold yet this month: no run rate to carry on with, the running month follows the trend', () => {
    const f = buildForecast({ monthly: months([1000, 2000, 3000]), today: '2026-10-15', monthToDate: 0, yearToDate: 6000 });
    expect(f.run_rate).toBeNull();
    expect(f.months[0]).toMatchObject({ month: '2026-10', basis: 'trend', likely: 4000 });
  });

  test('fewer than three full months: only the run rate, no trend and no year total', () => {
    const f = buildForecast({ monthly: months([1000, 2000]), today: '2026-10-15', monthToDate: 1500, yearToDate: 3500 });
    expect(f.confidence).toBe('none');
    expect(f.months).toEqual([]);
    expect(f.year_end).toBeNull();
    expect(f.run_rate).toBe(3100);
  });

  test('a falling trend never goes below zero, and noisy months give a wider band', () => {
    const f = buildForecast({ monthly: months([9000, 6000, 3000, 500]), today: '2026-10-03', monthToDate: 100, yearToDate: 18600 });
    expect(f.months[0].basis).toBe('trend'); // fewer than 7 days into the month
    expect(f.months.every((m) => m.likely >= 0 && m.low >= 0)).toBe(true);
    const noisy = buildForecast({ monthly: months([1000, 9000, 2000, 8000]), today: '2026-10-15', monthToDate: 1500, yearToDate: 1 });
    expect(noisy.months[1].high - noisy.months[1].low).toBeGreaterThan(0);
  });
});

describe('owner stats', () => {
  test('owners only', async () => {
    for (const t of [shopA.token, shopA.managerToken]) {
      expect((await request(app).get('/api/owner-stats/summary').set(as(t))).status).toBe(403);
    }
    expect((await request(app).get('/api/owner-stats/summary')).status).toBe(401);
    expect((await request(app).get('/api/owner-stats/summary').set(as(shopA.ownerToken))).status).toBe(200);
  });

  test('periods, series and the forecast come from the receipts', async () => {
    const { body } = await request(app).get('/api/owner-stats/summary').set(as(shopA.ownerToken));
    const d = body.data;
    expect(d.periods.today).toMatchObject({ revenue: 1500, bills: 2, cars: 1, avg_per_car: 1500 });
    expect(d.periods.today.previous.revenue).toBe(0);
    expect(d.data_since).toBe(dayOffset(8 * 31));
    expect(d.series.daily).toHaveLength(30);
    expect(d.series.daily[29].revenue).toBe(1500);
    expect(d.series.monthly).toHaveLength(12);
    expect(d.series.yearly.length).toBeGreaterThan(0);
    expect(d.forecast.months_used).toBeGreaterThanOrEqual(3);
    expect(d.forecast.months).toHaveLength(7);
    expect(d.forecast.year_end.low).toBeLessThanOrEqual(d.forecast.year_end.high);
    expect(d.cost).toEqual({ available: false });
  });

  test('close rate by value, decline reasons, channels, discounts, top items and brands', async () => {
    const { body } = await request(app).get('/api/owner-stats/summary').set(as(shopA.ownerToken));
    const d = body.data;
    expect(d.sales.month).toMatchObject({ offered_value: 6000, approved_value: 3000, close_rate_value: 50 });
    expect(d.sales.month.decline_reasons).toEqual([{ reason: 'ราคาสูงไป', count: 1, value: 1000 }]);
    expect(d.customers.channels[0]).toMatchObject({ channel: 'facebook', customers: 1 });
    expect(d.customers.active).toBe(1);
    expect(d.unusual.discount_total).toBe(-200);
    expect(d.unusual.discounts[0]).toMatchObject({ name: 'ส่วนลด', amount: -200 });
    expect(d.top_items[0]).toMatchObject({ name: 'ลูกหมาก', revenue: 1200 });
    expect(d.top_brands[0]).toMatchObject({ brand: 'Toyota' });
    expect(d.branches).toHaveLength(1);
    expect(d.branches[0].shop_id).toBe(shopA.shopId);
  });

  test('another group never sees these numbers; ?shops cannot reach outside the group', async () => {
    const own = await request(app).get('/api/owner-stats/summary').set(as(shopB.ownerToken));
    expect(own.body.data.periods.today.revenue).toBe(0);
    expect(own.body.data.shops.map((s) => s.id)).toEqual([shopB.shopId]);
    const reach = await request(app).get(`/api/owner-stats/summary?shops=${shopA.shopId}`).set(as(shopB.ownerToken));
    expect(reach.body.data.periods.today.revenue).toBe(0);
    expect(reach.body.data.selected_shop_ids).toEqual([shopB.shopId]);
  });
});
