// Standard prices per vehicle generation: shared inside a branch group, private to other owners; prices staff type on
// quotations are remembered and can be promoted by a manager.
const request = require('supertest');
const pool = require('../src/db/pool');
const { createApp } = require('../src/app');
const { createShop, dropShop } = require('./helpers');

const app = createApp();
const as = (token) => ({ Authorization: `Bearer ${token}` });
const unique = Date.now().toString(36);
const BRAND = `PriceT${unique}`;

let shopA1; // owner 1, branch 1
let shopA2; // owner 1, branch 2 (same group)
let shopB; // another owner
let gen1;
let gen2;
let pendingId;
const groups = [];

const put = (shop, body) => request(app).put('/api/model-prices').set(as(shop.managerToken)).send(body);
const lookup = (shop, modelId, name) => request(app).get('/api/model-prices/lookup').query({ vehicle_model_id: modelId, name }).set(as(shop.token));
const list = (shop, query = {}) => request(app).get('/api/model-prices').query(query).set(as(shop.managerToken));
const suggestions = (shop, query = {}) => request(app).get('/api/model-prices/suggestions').query(query).set(as(shop.managerToken));

async function quote(shop, { vehicleId = null, modelId = null, items, newVehicle = true }) {
  const body = {
    newCustomer: { customer_name: `Price test ${unique}`, phone: null },
    quotation_date: '2026-10-28',
    items,
  };
  if (vehicleId) {
    // reuse a saved car: the customer of that car
    const [[car]] = await pool.query('SELECT customer_id FROM vehicles WHERE id = ?', [vehicleId]);
    delete body.newCustomer;
    body.customer_id = car.customer_id;
    body.vehicle_id = vehicleId;
  } else if (newVehicle) {
    body.newVehicle = { brand: BRAND, model: 'Alpha' };
  }
  if (modelId) body.vehicle_model_id = modelId;
  const res = await request(app).post('/api/quotations').set(as(shop.token)).send(body);
  expect(res.status).toBe(201);
  const [[row]] = await pool.query('SELECT vehicle_id FROM quotations WHERE id = ?', [res.body.quotation_id]);
  return { quotationId: res.body.quotation_id, vehicleId: row.vehicle_id };
}

beforeAll(async () => {
  shopA1 = await createShop();
  shopA2 = await createShop({ groupId: shopA1.groupId });
  shopB = await createShop();
  groups.push(shopA1.groupId, shopB.groupId);
  const add = async (year, status = 'approved') => (await pool.query(
    'INSERT INTO vehicle_models (brand, model, year_range, status, submitted_shop_id) VALUES (?, ?, ?, ?, ?)',
    [BRAND, 'Alpha', year, status, status === 'pending' ? shopA1.shopId : null]
  ))[0].insertId;
  gen1 = await add('2013-2022');
  gen2 = await add('2022-ปัจจุบัน');
  pendingId = (await pool.query(
    "INSERT INTO vehicle_models (brand, model, year_range, status, submitted_shop_id) VALUES (?, 'Pending car', NULL, 'pending', ?)",
    [BRAND, shopA1.shopId]
  ))[0].insertId;
});

afterAll(async () => {
  await pool.query('DELETE FROM price_observations WHERE vehicle_model_id IN (?, ?)', [gen1, gen2]);
  await pool.query('DELETE FROM model_item_prices WHERE vehicle_model_id IN (?, ?)', [gen1, gen2]);
  await pool.query('DELETE FROM vehicles WHERE brand = ?', [BRAND]);
  await pool.query('DELETE FROM vehicle_models WHERE brand = ?', [BRAND]);
  for (const shop of [shopA1, shopA2, shopB]) await dropShop(shop.shopId);
  await pool.end();
});

describe('which generation a car is', () => {
  const resolve = (query, shop = shopA1) => request(app).get('/api/model-prices/resolve').query(query).set(as(shop.token));

  test('one match when the name carries the years, several when it does not, none when nothing fits', async () => {
    const plain = await resolve({ brand: BRAND, model: 'Alpha' });
    expect(plain.body.data.matches.map((m) => m.id).sort()).toEqual([gen1, gen2].sort());

    for (const typed of ["Alpha ปี '13-22'", "alpha ปี 13-22", 'Alpha (2013-2022)', 'ALPHA ปี 13-22']) {
      const res = await resolve({ brand: BRAND, model: typed });
      expect(res.body.data.matches.map((m) => m.id)).toEqual([gen1]);
    }
    expect((await resolve({ brand: BRAND, model: "Alpha ปี '22-ปัจจุบัน'" })).body.data.matches.map((m) => m.id)).toEqual([gen2]);
    expect((await resolve({ brand: BRAND, model: 'Nothing' })).body.data.matches).toEqual([]);
    expect((await resolve({ brand: BRAND, model: 'Pending car' })).body.data.matches).toEqual([]);
    expect((await resolve({ vehicle_model_id: gen1 })).body.data.matches[0]).toMatchObject({ id: gen1, display_name: "Alpha ปี '13-22'" });
    expect((await resolve({ vehicle_model_id: pendingId })).body.data.matches).toEqual([]);
  });
});

describe('standard prices: who may set them, who sees them', () => {
  test('only a manager can add a price; the input is checked', async () => {
    const body = { vehicle_model_id: gen1, item_name: 'โช๊คอัพหน้า', part_price: 3500 };
    expect((await request(app).put('/api/model-prices').set(as(shopA1.token)).send(body)).status).toBe(403);
    expect((await put(shopA1, { ...body, item_name: '  ' })).status).toBe(400);
    expect((await put(shopA1, { ...body, part_price: -1 })).status).toBe(400);
    expect((await put(shopA1, { ...body, part_price: 'abc' })).status).toBe(400);
    expect((await put(shopA1, { ...body, part_price: '' })).status).toBe(400);
    expect((await put(shopA1, { ...body, labor_price: 'x' })).status).toBe(400);
    expect((await put(shopA1, { ...body, vehicle_model_id: pendingId })).status).toBe(400);
    expect((await put(shopA1, { ...body, vehicle_model_id: 99999999 })).status).toBe(400);
    expect((await put(shopA1, { ...body, item_name: 'x'.repeat(256) })).status).toBe(400);
    expect((await put(shopA1, body)).status).toBe(200);
  });

  test('the other branch of the same owner sees the price (names match ignoring spaces and case); another owner does not', async () => {
    const found = await lookup(shopA2, gen1, 'โช๊คอัพ หน้า');
    expect(found.body.data).toMatchObject({ item_name: 'โช๊คอัพหน้า', is_set: 0 });
    expect(Number(found.body.data.part_price)).toBe(3500);
    expect(found.body.data.labor_price).toBeNull();

    expect((await lookup(shopB, gen1, 'โช๊คอัพหน้า')).body.data).toBeNull();
    expect((await lookup(shopA2, gen2, 'โช๊คอัพหน้า')).body.data).toBeNull();
    expect((await list(shopA2)).body.data.map((r) => r.item_name)).toEqual(['โช๊คอัพหน้า']);
    expect((await list(shopB)).body.data).toEqual([]);
  });

  test('the other owner can set the same item at its own price without touching ours', async () => {
    expect((await put(shopB, { vehicle_model_id: gen1, item_name: 'โช๊คอัพหน้า', part_price: 2900 })).status).toBe(200);
    expect(Number((await lookup(shopB, gen1, 'โช๊คอัพหน้า')).body.data.part_price)).toBe(2900);
    expect(Number((await lookup(shopA1, gen1, 'โช๊คอัพหน้า')).body.data.part_price)).toBe(3500);
  });

  test('labour is kept when a price is changed without it, cleared when sent empty; a set is flagged', async () => {
    expect((await put(shopA1, { vehicle_model_id: gen1, item_name: 'โช๊คอัพหน้า', part_price: 3600, labor_price: 400 })).status).toBe(200);
    let row = (await lookup(shopA1, gen1, 'โช๊คอัพหน้า')).body.data;
    expect([Number(row.part_price), Number(row.labor_price)]).toEqual([3600, 400]);

    expect((await put(shopA1, { vehicle_model_id: gen1, item_name: 'โช๊คอัพหน้า', part_price: 3700 })).status).toBe(200);
    row = (await lookup(shopA1, gen1, 'โช๊คอัพหน้า')).body.data;
    expect([Number(row.part_price), Number(row.labor_price)]).toEqual([3700, 400]);

    expect((await put(shopA1, { vehicle_model_id: gen1, item_name: 'โช๊คอัพหน้า', part_price: 3700, labor_price: null })).status).toBe(200);
    expect((await lookup(shopA1, gen1, 'โช๊คอัพหน้า')).body.data.labor_price).toBeNull();

    expect((await put(shopA1, { vehicle_model_id: gen1, item_name: 'ชุดโปรช่วงล่าง', part_price: 9000, is_set: true })).status).toBe(200);
    expect((await lookup(shopA1, gen1, 'ชุดโปรช่วงล่าง')).body.data.is_set).toBe(1);
    expect((await list(shopA1, { vehicle_model_id: gen1, search: 'โปร' })).body.data.map((r) => r.item_name)).toEqual(['ชุดโปรช่วงล่าง']);
  });

  test('removing a price keeps the row; only the owner\'s own group can remove it; saving again brings it back', async () => {
    const id = (await list(shopA1, { search: 'ชุดโปร' })).body.data[0].id;
    expect((await request(app).delete(`/api/model-prices/${id}`).set(as(shopB.managerToken))).status).toBe(404);
    expect((await request(app).delete(`/api/model-prices/${id}`).set(as(shopA1.token))).status).toBe(403);
    expect((await request(app).delete(`/api/model-prices/${id}`).set(as(shopA2.managerToken))).status).toBe(200);
    expect((await lookup(shopA1, gen1, 'ชุดโปรช่วงล่าง')).body.data).toBeNull();
    const [[stored]] = await pool.query('SELECT is_active FROM model_item_prices WHERE id = ?', [id]);
    expect(stored.is_active).toBe(0);
    expect((await put(shopA1, { vehicle_model_id: gen1, item_name: 'ชุดโปรช่วงล่าง', part_price: 9500, is_set: true })).status).toBe(200);
    expect(Number((await lookup(shopA1, gen1, 'ชุดโปรช่วงล่าง')).body.data.part_price)).toBe(9500);
  });
});

describe('linking a car to its generation', () => {
  test('attaches to a car of the own shop only, and only to an approved generation', async () => {
    const { vehicleId } = await quote(shopA1, { items: [] });
    const attach = (shop, body) => request(app).post('/api/model-prices/attach-vehicle').set(as(shop.token)).send(body);
    expect((await attach(shopA1, { vehicle_id: vehicleId, vehicle_model_id: pendingId })).status).toBe(400);
    expect((await attach(shopB, { vehicle_id: vehicleId, vehicle_model_id: gen1 })).status).toBe(404);
    expect((await attach(shopA1, { vehicle_id: vehicleId, vehicle_model_id: gen1 })).status).toBe(200);
    const [[car]] = await pool.query('SELECT vehicle_model_id FROM vehicles WHERE id = ?', [vehicleId]);
    expect(car.vehicle_model_id).toBe(gen1);
  });
});

describe('prices typed on quotations are remembered', () => {
  let vehicleId;
  let firstQuotation;

  test('lines with a price are recorded under the generation; empty prices, other lines and unknown cars are not', async () => {
    const created = await quote(shopA1, {
      modelId: gen2,
      items: [
        { product_name: 'โช๊คหลัง', quantity: 2, unit_price: 1800 },
        { product_name: 'แถวราคาว่าง', quantity: 1, unit_price: 0 },
        { product_name: 'บูชปีกนก', quantity: 1, unit_price: '' },
        { product_name: 'ค่าแรงโช๊คหลัง', skip_price_memory: true, quantity: 1, unit_price: 300 },
        { product_name: 'ลูกหมากแร็ค (ชุดโปร ส่วนประกอบ)', price_key_name: 'ชุดโปรช่วงล่าง', quantity: 1, unit_price: 9000 },
      ],
    });
    vehicleId = created.vehicleId;
    firstQuotation = created.quotationId;
    const [rows] = await pool.query('SELECT item_name, unit_price, vehicle_model_id, source_id FROM price_observations WHERE source_id = ? ORDER BY item_name', [firstQuotation]);
    expect(rows.map((r) => r.item_name).sort()).toEqual(['ชุดโปรช่วงล่าง', 'โช๊คหลัง'].sort());
    expect(rows.every((r) => r.vehicle_model_id === gen2)).toBe(true);
    // the car is now linked to its generation
    const [[car]] = await pool.query('SELECT vehicle_model_id FROM vehicles WHERE id = ?', [vehicleId]);
    expect(car.vehicle_model_id).toBe(gen2);

    // a quotation for a car whose generation is unknown records nothing, but still saves
    const unknown = await quote(shopA1, { items: [{ product_name: 'โช๊คหลัง', quantity: 1, unit_price: 1700 }] });
    expect((await pool.query('SELECT COUNT(*) AS n FROM price_observations WHERE source_id = ?', [unknown.quotationId]))[0][0].n).toBe(0);
  });

  test('a later quotation for the same car needs no generation in the request: the linked one is used', async () => {
    await quote(shopA2, { vehicleId, items: [{ product_name: 'โช๊คหลัง', quantity: 1, unit_price: 1800 }, { product_name: 'ชุดโปรช่วงล่าง', quantity: 1, unit_price: 9000 }] }).catch(() => null);
    // shop A2 is another branch: the car belongs to shop A1, so it is refused and nothing is recorded for it
    const [[count]] = await pool.query("SELECT COUNT(*) AS n FROM price_observations WHERE shop_id = ?", [shopA2.shopId]);
    expect(count.n).toBe(0);

    await quote(shopA1, { vehicleId, items: [{ product_name: 'โช๊คหลัง', quantity: 1, unit_price: 1800 }] });
    const [[recorded]] = await pool.query("SELECT COUNT(*) AS n FROM price_observations WHERE shop_id = ? AND item_key = ? AND vehicle_model_id = ?", [shopA1.shopId, 'โช๊คหลัง', gen2]);
    expect(recorded.n).toBe(2);
  });

  test('the manager sees what was typed: how often, the prices, and when the last three agree', async () => {
    expect((await request(app).get('/api/model-prices/suggestions').set(as(shopA1.token))).status).toBe(403);
    let res = await suggestions(shopA1);
    let shock = res.body.data.find((r) => r.item_name === 'โช๊คหลัง');
    expect(shock).toMatchObject({ vehicle_model_id: gen2, times: 2, last_price: 1800, stable: false, standard_price: null });
    expect(shock.model_name).toBe("Alpha ปี '22-ปัจจุบัน'");

    await quote(shopA1, { vehicleId, items: [{ product_name: 'โช๊คหลัง', quantity: 1, unit_price: 1800 }] });
    res = await suggestions(shopA1);
    shock = res.body.data.find((r) => r.item_name === 'โช๊คหลัง');
    expect(shock).toMatchObject({ times: 3, stable: true, min_price: 1800, max_price: 1800 });
    // the set was typed once only: below the default minimum of two
    expect(res.body.data.find((r) => r.item_name === 'ชุดโปรช่วงล่าง')).toBeUndefined();
    expect((await suggestions(shopA1, { min: 1 })).body.data.some((r) => r.item_name === 'ชุดโปรช่วงล่าง')).toBe(true);
  });

  test('the owner\'s other branch sees the same list; another owner sees nothing', async () => {
    expect((await suggestions(shopA2)).body.data.some((r) => r.item_name === 'โช๊คหลัง')).toBe(true);
    expect((await suggestions(shopB, { min: 1 })).body.data.filter((r) => r.vehicle_model_id === gen2)).toEqual([]);
  });

  test('promoting a typed price makes it standard and takes it off the list; a later different price shows again', async () => {
    expect((await put(shopA1, { vehicle_model_id: gen2, item_name: 'โช๊คหลัง', part_price: 1800 })).status).toBe(200);
    expect((await suggestions(shopA1)).body.data.find((r) => r.item_name === 'โช๊คหลัง')).toBeUndefined();
    expect(Number((await lookup(shopA2, gen2, 'โช๊คหลัง')).body.data.part_price)).toBe(1800);

    await quote(shopA1, { vehicleId, items: [{ product_name: 'โช๊คหลัง', quantity: 1, unit_price: 1650 }] });
    const shock = (await suggestions(shopA1)).body.data.find((r) => r.item_name === 'โช๊คหลัง');
    expect(shock).toMatchObject({ last_price: 1650, standard_price: 1800, stable: false });
  });

  test('editing a quotation replaces what it recorded', async () => {
    const edit = await request(app).put(`/api/quotations/${firstQuotation}`).set(as(shopA1.token)).send({
      customer_id: (await pool.query('SELECT customer_id FROM quotations WHERE id = ?', [firstQuotation]))[0][0].customer_id,
      vehicle_id: vehicleId,
      quotation_date: '2026-10-28',
      items: [{ product_name: 'โช๊คหลัง', quantity: 1, unit_price: 2000 }],
    });
    expect(edit.status).toBe(200);
    const [rows] = await pool.query('SELECT item_name, unit_price FROM price_observations WHERE source_id = ?', [firstQuotation]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].unit_price)).toBe(2000);
  });
});
