// scripts/split_vehicle_models.js: one lumped catalogue entry becomes one entry per generation.
const request = require('supertest');
const pool = require('../src/db/pool');
const { createApp } = require('../src/app');
const { createShop, dropShop } = require('./helpers');
const { runPlan } = require('../scripts/split_vehicle_models');

const app = createApp();
const as = (token) => ({ Authorization: `Bearer ${token}` });
const BRAND = `SplitT${Date.now().toString(36)}`;
const OLD = 'Zed (2000-ปัจจุบัน)';
const GEN1 = 'Zed (2000-2010)';
const GEN2 = 'Zed (2010-ปัจจุบัน)';
const IMAGE = '/part-images/split-test.png';

const plan = {
  splits: [
    { brand: BRAND, old_model: 'Zed', old_years: '2000-ปัจจุบัน', model: 'Zed', year_range: '2000-2010' },
    { brand: BRAND, old_model: 'Zed', old_years: '2000-ปัจจุบัน', model: 'Zed', year_range: '2010-ปัจจุบัน' },
  ],
  retire: [{ brand: BRAND, model: 'Junk' }, { brand: BRAND, model: 'HasParts' }],
};

let shop;

// run the plan the way the script does: in a transaction, then commit or roll back
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
const count = async (sql, params) => Number((await pool.query(sql, params))[0][0].n);

beforeAll(async () => {
  shop = await createShop();
  await pool.query("INSERT INTO vehicle_models (brand, model, year_range, status) VALUES (?, 'Zed', '2000-ปัจจุบัน', 'approved')", [BRAND]);
  await pool.query("INSERT INTO vehicle_models (brand, model, year_range, status) VALUES (?, 'Junk', NULL, 'approved'), (?, 'HasParts', NULL, 'approved')", [BRAND, BRAND]);
  for (const [name, price] of [['Shock', 100], ['Mount', 200], ['Rack', 300]]) {
    await pool.query('INSERT INTO catalog_parts (brand, model, part_name, category, price) VALUES (?, ?, ?, ?, ?)', [BRAND, OLD, name, 'Cat', price]);
  }
  await pool.query('INSERT INTO catalog_parts (brand, model, part_name, price) VALUES (?, ?, ?, ?)', [BRAND, 'HasParts', 'Thing', 5]);
  // shop's own price on Shock, Mount hidden by the shop, Rack carries a picture
  await pool.query('INSERT INTO quote_part_prices (shop_id, brand, model, part_name, price, own_price) VALUES (?, ?, ?, ?, 999, 1)', [shop.shopId, BRAND, OLD, 'Shock']);
  await pool.query('INSERT INTO quote_part_prices (shop_id, brand, model, part_name, price, is_active, own_price) VALUES (?, ?, ?, ?, 200, 0, 0)', [shop.shopId, BRAND, OLD, 'Mount']);
  await pool.query('INSERT INTO quote_part_prices (shop_id, brand, model, part_name, price, image_data, own_price) VALUES (?, ?, ?, ?, 300, ?, 0)', [shop.shopId, BRAND, OLD, 'Rack', IMAGE]);
});

afterAll(async () => {
  await pool.query('DELETE FROM quote_part_prices WHERE brand = ?', [BRAND]);
  await pool.query('DELETE FROM catalog_parts WHERE brand = ?', [BRAND]);
  await pool.query('DELETE FROM vehicle_models WHERE brand = ?', [BRAND]);
  await dropShop(shop.shopId);
  await pool.end();
});

test('a dry run reports the work but writes nothing', async () => {
  const { stats } = await execute(false);
  expect(stats).toMatchObject({ groups: 1, newModels: 2, masterRows: 6, shopRows: 6, retired: 2 });
  expect(await count('SELECT COUNT(*) AS n FROM vehicle_models WHERE brand = ?', [BRAND])).toBe(3);
  expect(await count('SELECT COUNT(*) AS n FROM catalog_parts WHERE brand = ?', [BRAND])).toBe(4);
  expect(await count("SELECT COUNT(*) AS n FROM vehicle_models WHERE brand = ? AND status = 'retired'", [BRAND])).toBe(0);
});

test('applying splits the entry: parts and the shop prices follow, the old entry is retired, not deleted', async () => {
  const { stats, notes } = await execute(true);
  expect(stats).toMatchObject({ groups: 1, newModels: 2, masterRows: 6, shopRows: 6, retired: 2 });
  // "HasParts" was not retired because it has master parts
  expect(notes.join('\n')).toMatch(/not retired.*HasParts/);

  const [[old]] = await pool.query("SELECT status FROM vehicle_models WHERE brand = ? AND model = 'Zed' AND year_range = '2000-ปัจจุบัน'", [BRAND]);
  expect(old.status).toBe('retired');
  expect(await count("SELECT COUNT(*) AS n FROM vehicle_models WHERE brand = ? AND model = 'Zed' AND status = 'approved'", [BRAND])).toBe(2);
  expect(await count("SELECT COUNT(*) AS n FROM vehicle_models WHERE brand = ? AND model = 'Junk' AND status = 'retired'", [BRAND])).toBe(1);

  // the old master parts still exist but are hidden; every generation got its own copy
  expect(await count('SELECT COUNT(*) AS n FROM catalog_parts WHERE brand = ? AND model = ? AND is_active = 0', [BRAND, OLD])).toBe(3);
  for (const gen of [GEN1, GEN2]) {
    expect(await count('SELECT COUNT(*) AS n FROM catalog_parts WHERE brand = ? AND model = ? AND is_active = 1', [BRAND, gen])).toBe(3);
  }

  // the shop's own rows followed to every generation: its own price, the part it hid (still hidden), the picture
  for (const gen of [GEN1, GEN2]) {
    const [rows] = await pool.query('SELECT part_name, price, is_active, image_data, own_price FROM quote_part_prices WHERE shop_id = ? AND brand = ? AND model = ? ORDER BY part_name', [shop.shopId, BRAND, gen]);
    expect(rows.map((r) => r.part_name)).toEqual(['Mount', 'Rack', 'Shock']);
    expect(Number(rows.find((r) => r.part_name === 'Shock').price)).toBe(999);
    expect(rows.find((r) => r.part_name === 'Mount').is_active).toBe(0);
    expect(rows.find((r) => r.part_name === 'Rack').image_data).toBe(IMAGE);
  }

  // the picker lists the generations, not the retired entry
  const vehicleModels = (await request(app).get('/api/vehicle-models/models').query({ brand: BRAND }).set(as(shop.token))).body.data;
  expect(vehicleModels.map((m) => m.label).sort()).toEqual([GEN1, GEN2, 'HasParts'].sort());
});

test('running it again changes nothing', async () => {
  const { stats } = await execute(true);
  expect(stats).toMatchObject({ groups: 0, skipped: 1, newModels: 0, masterRows: 0, shopRows: 0 });
  expect(await count('SELECT COUNT(*) AS n FROM catalog_parts WHERE brand = ?', [BRAND])).toBe(10);
});
