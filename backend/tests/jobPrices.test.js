// Standard prices on the job page: the car's generation comes with the job, the draft keeps what the price memory
// needs, and the prices staff typed are remembered when the draft becomes a quotation.
const request = require('supertest');
const pool = require('../src/db/pool');
const { createApp } = require('../src/app');
const { createShop, dropShop } = require('./helpers');

const app = createApp();
const as = (token) => ({ Authorization: `Bearer ${token}` });
const unique = Date.now().toString(36);
const BRAND = `JobPriceT${unique}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

let shop;
let modelId;
let customerId;
let vehicleId;
let jobId;
const quotationIds = [];

beforeAll(async () => {
  shop = await createShop();
  modelId = (await pool.query("INSERT INTO vehicle_models (brand, model, year_range, status) VALUES (?, 'Beta', '2015-2020', 'approved')", [BRAND]))[0].insertId;
  customerId = (await pool.query('INSERT INTO customers (shop_id, customer_name, phone) VALUES (?, ?, NULL)', [shop.shopId, `Job price ${unique}`]))[0].insertId;
  vehicleId = (await pool.query('INSERT INTO vehicles (shop_id, customer_id, brand, model, license_plate) VALUES (?, ?, ?, ?, ?)', [shop.shopId, customerId, BRAND, 'Beta', `JP${unique}`.slice(0, 15)]))[0].insertId;
  const job = await request(app).post('/api/jobs').set(as(shop.token)).send({ vehicle_id: vehicleId, customer_id: customerId, job_date: todayStr() });
  expect(job.status).toBe(201);
  jobId = job.body.data?.id ?? job.body.id ?? job.body.job_id;
});

afterAll(async () => {
  await pool.query('DELETE FROM price_observations WHERE shop_id = ?', [shop.shopId]);
  await pool.query('DELETE FROM jobs WHERE shop_id = ?', [shop.shopId]);
  if (quotationIds.length) {
    await pool.query('DELETE FROM repair_notices WHERE shop_id = ?', [shop.shopId]);
    await pool.query('DELETE FROM quotation_items WHERE quotation_id IN (?)', [quotationIds]);
  }
  await pool.query('DELETE FROM quotations WHERE shop_id = ?', [shop.shopId]);
  await pool.query('DELETE FROM vehicles WHERE shop_id = ?', [shop.shopId]);
  await pool.query('DELETE FROM customers WHERE shop_id = ?', [shop.shopId]);
  await pool.query('DELETE FROM vehicle_models WHERE brand = ?', [BRAND]);
  await dropShop(shop.shopId);
  await pool.end();
});

describe('job page standard prices', () => {
  test('the job detail carries the generation stored on the car', async () => {
    expect((await request(app).get(`/api/jobs/${jobId}`).set(as(shop.token))).body.data.vehicle_model_id).toBeNull();
    const attach = await request(app).post('/api/model-prices/attach-vehicle').set(as(shop.token)).send({ vehicle_id: vehicleId, vehicle_model_id: modelId });
    expect(attach.status).toBe(200);
    expect((await request(app).get(`/api/jobs/${jobId}`).set(as(shop.token))).body.data.vehicle_model_id).toBe(modelId);
  });

  test('the draft keeps the price key, set member and skip flags', async () => {
    const res = await request(app).patch(`/api/jobs/${jobId}/quote-draft`).set(as(shop.token)).send({
      items: [
        { product_name: 'โช๊ค A', quantity: 1, unit_price: 8500, price_key_name: 'ชุดโปร A' },
        { product_name: 'ลูกหมาก B', quantity: 2, unit_price: 0, set_member: true },
        { product_name: 'ค่าแรงโช๊ค A', quantity: 1, unit_price: 350, skip_price_memory: true },
        { product_name: 'น้ำมัน', quantity: 1, unit_price: 900 },
      ],
    });
    expect(res.status).toBe(200);
    const draft = (await request(app).get(`/api/jobs/${jobId}`).set(as(shop.token))).body.data.quote_draft;
    expect(draft.items[0]).toMatchObject({ price_key_name: 'ชุดโปร A' });
    expect(draft.items[1]).toMatchObject({ set_member: true });
    expect(draft.items[2]).toMatchObject({ skip_price_memory: true });
    expect(draft.items[3].price_key_name).toBeUndefined();
  });

  test('deciding turns the draft into a quotation and remembers the typed prices (not the skipped or zero ones)', async () => {
    const res = await request(app).post(`/api/jobs/${jobId}/quotation/schedule`).set(as(shop.token)).send({ scheduled_date: todayStr() });
    expect(res.status).toBe(200);
    quotationIds.push(res.body.quotation_id);
    const [rows] = await pool.query(
      'SELECT item_name, unit_price, vehicle_model_id, group_id FROM price_observations WHERE shop_id = ? AND source_id = ? ORDER BY item_name',
      [shop.shopId, res.body.quotation_id]
    );
    expect(rows.map((r) => r.item_name).sort()).toEqual(['ชุดโปร A', 'น้ำมัน'].sort());
    expect(rows.every((r) => r.vehicle_model_id === modelId && r.group_id === shop.groupId)).toBe(true);
    expect(Number(rows.find((r) => r.item_name === 'ชุดโปร A').unit_price)).toBe(8500);
  });
});
