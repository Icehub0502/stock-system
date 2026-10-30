// Adding a car to the queue needs the channel the customer found the shop through (kept on the customer).
const request = require('supertest');
const pool = require('../src/db/pool');
const { createApp } = require('../src/app');
const { createShop, dropShop } = require('./helpers');

const app = createApp();
const as = (token) => ({ Authorization: `Bearer ${token}` });
const unique = Date.now().toString(36);

let shop;
let n = 0;

async function newCar(foundVia = null) {
  n += 1;
  const [c] = await pool.query('INSERT INTO customers (shop_id, customer_code, customer_name, phone, found_via) VALUES (?, ?, ?, NULL, ?)', [shop.shopId, `CH-${n}`, `Chan ${unique} ${n}`, foundVia]);
  const [v] = await pool.query('INSERT INTO vehicles (shop_id, customer_id, brand, model, license_plate) VALUES (?, ?, ?, ?, ?)', [shop.shopId, c.insertId, 'Toyota', 'Vios', `CH${unique}${n}`.slice(0, 15)]);
  return { customerId: c.insertId, vehicleId: v.insertId };
}
const postJob = (car, extra = {}) => request(app).post('/api/jobs').set(as(shop.token)).send({ vehicle_id: car.vehicleId, customer_id: car.customerId, ...extra });

beforeAll(async () => { shop = await createShop(); });

afterAll(async () => {
  await pool.query('DELETE FROM jobs WHERE shop_id = ?', [shop.shopId]);
  await pool.query('DELETE FROM vehicles WHERE shop_id = ?', [shop.shopId]);
  await pool.query('DELETE FROM customers WHERE shop_id = ?', [shop.shopId]);
  await dropShop(shop.shopId);
  await pool.end();
});

describe('queue intake: how the customer found the shop', () => {
  test('a customer without a channel cannot be queued until one is given', async () => {
    const car = await newCar();
    const refused = await postJob(car);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/ช่องทาง/);
    expect((await postJob(car, { found_via: 'not-a-channel' })).status).toBe(400);
    const [[still]] = await pool.query('SELECT found_via FROM customers WHERE id = ?', [car.customerId]);
    expect(still.found_via).toBeNull();
    expect((await pool.query('SELECT id FROM jobs WHERE shop_id = ?', [shop.shopId]))[0]).toHaveLength(0);
  });

  test('the channel is saved on the customer with the job; "other" needs a note', async () => {
    const car = await newCar();
    expect((await postJob(car, { found_via: 'other' })).status).toBe(400);
    const ok = await postJob(car, { found_via: 'other', found_via_note: '  ป้ายโฆษณา  ' });
    expect(ok.status).toBe(201);
    const [[c]] = await pool.query('SELECT found_via, found_via_note FROM customers WHERE id = ?', [car.customerId]);
    expect(c).toEqual({ found_via: 'other', found_via_note: 'ป้ายโฆษณา' });

    const fb = await newCar();
    expect((await postJob(fb, { found_via: 'facebook' })).status).toBe(201);
    const [[c2]] = await pool.query('SELECT found_via, found_via_note FROM customers WHERE id = ?', [fb.customerId]);
    expect(c2).toEqual({ found_via: 'facebook', found_via_note: null });
  });

  test('a customer that already has a channel is queued without one, and the first channel is kept', async () => {
    const car = await newCar('google_map');
    expect((await postJob(car)).status).toBe(201);
    const again = await postJob(car, { found_via: 'returning' });
    expect(again.status).toBe(201);
    const [[c]] = await pool.query('SELECT found_via FROM customers WHERE id = ?', [car.customerId]);
    expect(c.found_via).toBe('google_map');
  });
});
