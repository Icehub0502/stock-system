// scripts/rename_vehicle_models.js: catalogue models get the shop's naming ("CR-V" 2006-2011 → "CRV G3") and the
// customers' cars that carry an old name of a generation follow it.
const request = require('supertest');
const pool = require('../src/db/pool');
const { createApp } = require('../src/app');
const { createShop, dropShop } = require('./helpers');
const { runPlan } = require('../scripts/rename_vehicle_models');

const app = createApp();
const as = (token) => ({ Authorization: `Bearer ${token}` });
const BRAND = `RenT${Date.now().toString(36)}`;

const plan = [
  { brand: BRAND, model: 'CR-V', year_range: '2006-2011', new_model: 'CRV G3' },
  { brand: BRAND, model: 'CR-V', year_range: '2012-2016', new_model: 'CRV G4' },
  { brand: BRAND, model: 'Gone', year_range: '2000-2005', new_model: 'Gone G1' },
];

let shop;
const ids = {};
const cars = {};

async function execute(commit) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await runPlan(conn, plan);
    if (commit) await conn.commit(); else await conn.rollback();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
const car = async (id) => (await pool.query('SELECT model, vehicle_model_id FROM vehicles WHERE id = ?', [id]))[0][0];

beforeAll(async () => {
  shop = await createShop();
  const addModel = async (model, years) => (await pool.query(
    "INSERT INTO vehicle_models (brand, model, year_range, status) VALUES (?, ?, ?, 'approved')", [BRAND, model, years]
  ))[0].insertId;
  ids.g3 = await addModel('CR-V', '2006-2011');
  ids.g4 = await addModel('CR-V', '2012-2016');
  ids.vios = await addModel('Vios', '2002-2007');
  const [c] = await pool.query('INSERT INTO customers (shop_id, customer_name, phone) VALUES (?, ?, NULL)', [shop.shopId, 'Rename test']);
  const addCar = async (model, plate, modelId = null) => (await pool.query(
    'INSERT INTO vehicles (shop_id, customer_id, brand, model, license_plate, vehicle_model_id) VALUES (?, ?, ?, ?, ?, ?)',
    [shop.shopId, c.insertId, BRAND, model, plate, modelId]
  ))[0].insertId;
  cars.oldDisplay = await addCar("CR-V ปี '06-11'", 'RN1');
  cars.oldLabel = await addCar('CR-V (2012-2016)', 'RN2');
  cars.plain = await addCar('CR-V', 'RN3');
  cars.typed = await addCar('CRV GEN 4', 'RN4');
  cars.vios = await addCar("Vios ปี '02-07'", 'RN5');
  cars.otherLink = await addCar("CR-V ปี '06-11'", 'RN6', ids.g4);
});

afterAll(async () => {
  await pool.query('DELETE FROM vehicles WHERE shop_id = ?', [shop.shopId]);
  await pool.query('DELETE FROM customers WHERE shop_id = ?', [shop.shopId]);
  await pool.query('DELETE FROM vehicle_models WHERE brand = ?', [BRAND]);
  await dropShop(shop.shopId);
  await pool.end();
});

test('a dry run changes nothing', async () => {
  const { stats } = await execute(false);
  expect(stats).toMatchObject({ renamed: 2, skipped: 1 });
  const [[row]] = await pool.query('SELECT model FROM vehicle_models WHERE id = ?', [ids.g3]);
  expect(row.model).toBe('CR-V');
  expect((await car(cars.oldDisplay)).model).toBe("CR-V ปี '06-11'");
});

test('models are renamed and cars with an old name of one generation follow it', async () => {
  const { stats, notes } = await execute(true);
  expect(stats).toMatchObject({ renamed: 2, skipped: 1, carsRenamed: 3, carsLinked: 3 });
  expect(notes.join('\n')).toContain('Gone');
  const [rows] = await pool.query('SELECT id, model FROM vehicle_models WHERE brand = ? ORDER BY id', [BRAND]);
  expect(rows.map((r) => r.model)).toEqual(['CRV G3', 'CRV G4', 'Vios']);

  expect(await car(cars.oldDisplay)).toEqual({ model: 'CRV G3 (ปี 2006-2011)', vehicle_model_id: ids.g3 });
  expect(await car(cars.oldLabel)).toEqual({ model: 'CRV G4 (ปี 2012-2016)', vehicle_model_id: ids.g4 });
  // a model that was not renamed still moves to the new display style
  expect(await car(cars.vios)).toEqual({ model: 'Vios (ปี 2002-2007)', vehicle_model_id: ids.vios });
  // no generation in the text, text typed by staff, or linked to another generation by staff: left as it is
  expect(await car(cars.plain)).toEqual({ model: 'CR-V', vehicle_model_id: null });
  expect(await car(cars.typed)).toEqual({ model: 'CRV GEN 4', vehicle_model_id: null });
  expect(await car(cars.otherLink)).toEqual({ model: "CR-V ปี '06-11'", vehicle_model_id: ids.g4 });
});

test('running it again changes nothing more', async () => {
  const { stats } = await execute(true);
  expect(stats).toMatchObject({ renamed: 0, alreadyDone: 2, skipped: 1, carsRenamed: 0, carsLinked: 0 });
});

test('the picker shows the new name and the generation is still found from old and new text', async () => {
  const listed = (await request(app).get('/api/vehicle-models/models').query({ brand: BRAND }).set(as(shop.token))).body.data;
  expect(listed.map((m) => m.display_name)).toEqual(['CRV G3 (ปี 2006-2011)', 'CRV G4 (ปี 2012-2016)', 'Vios (ปี 2002-2007)']);
  const resolve = async (model) => (await request(app).get('/api/model-prices/resolve').query({ brand: BRAND, model }).set(as(shop.token)))
    .body.data.matches.map((m) => m.id);
  expect(await resolve('CRV G3 (ปี 2006-2011)')).toEqual([ids.g3]);
  expect(await resolve('crv g3')).toEqual([ids.g3]);
  expect(await resolve('CR-V')).toEqual([ids.g3, ids.g4]);
  expect(await resolve("Vios ปี '02-07'")).toEqual([ids.vios]);
});
