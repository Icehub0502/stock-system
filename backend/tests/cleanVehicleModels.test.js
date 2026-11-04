// scripts/clean_vehicle_models.js: pickups split by body / drive type, clear generation names, no entry without a year.
// Everything runs in one transaction that is rolled back, because the script retires every entry without a year.
const pool = require('../src/db/pool');
const { createCustomerWithVehicle, cleanupCustomer } = require('./helpers');
const { runPlan } = require('../scripts/clean_vehicle_models');

const BRAND = `CleanT${Date.now().toString(36)}`;
const LOW = 'ตัวเตี้ย 2WD';
const HIGH2 = 'ตัวสูง 2WD';
const HIGH4 = 'ตัวสูง 4WD';

const plan = {
  pickups: [{
    brand: BRAND, model: 'Truck G1', year_range: '2000-2010', variants: [LOW, HIGH2, HIGH4], replaces: [{ model: 'Truck', year_range: '2000-2010' }],
  }],
  renames: [{ brand: BRAND, model: 'Sedan (เจน 1)', year_range: '2008-2014', new_model: 'Sedan G1' }],
  moves: [
    { brand: BRAND, model: 'Sedan 08', year_range: null, to_model: 'Sedan G1', to_year_range: '2008-2014' },
    { brand: BRAND, model: 'Missing', year_range: null, to_model: 'Nope', to_year_range: '2000-2001' },
  ],
};

let conn;
let fixture;
const ids = {};

const insertModel = async (model, yearRange, status = 'approved') => {
  const [r] = await conn.query('INSERT INTO vehicle_models (brand, model, year_range, status) VALUES (?, ?, ?, ?)', [BRAND, model, yearRange, status]);
  return r.insertId;
};
const addPrice = (modelId, key) => conn.query(
  'INSERT INTO model_item_prices (group_id, vehicle_model_id, item_key, item_name, part_price) VALUES (1, ?, ?, ?, 500)',
  [modelId, key, key]
);
const statusOf = async (id) => (await conn.query('SELECT status FROM vehicle_models WHERE id = ?', [id]))[0][0].status;

beforeAll(async () => {
  fixture = await createCustomerWithVehicle({ namePrefix: 'Clean Models' });
  conn = await pool.getConnection();
  await conn.beginTransaction();
  ids.truck = await insertModel('Truck', '2000-2010');
  ids.sedan = await insertModel('Sedan (เจน 1)', '2008-2014');
  ids.typed = await insertModel('Sedan 08', null);
  ids.junk = await insertModel('Junk', null);
  ids.pending = await insertModel('Waiting', null, 'pending');
  ids.kept = await insertModel('Other', '2001-2005');
  await addPrice(ids.truck, 'shock');
  await addPrice(ids.typed, 'rack');
  await addPrice(ids.junk, 'kept-on-hidden-entry');
  await conn.query('UPDATE vehicles SET vehicle_model_id = ? WHERE id = ?', [ids.truck, fixture.vehicleId]);
});

afterAll(async () => {
  await conn.rollback();
  conn.release();
  await cleanupCustomer(fixture.customerId);
  await pool.end();
});

describe('clean_vehicle_models', () => {
  let first;
  beforeAll(async () => { first = await runPlan(conn, plan); });

  test('pickups become one entry per type, each with the old prices, and the old entry is retired', async () => {
    const [rows] = await conn.query("SELECT id, model, year_range FROM vehicle_models WHERE brand = ? AND model LIKE 'Truck G1%' AND status = 'approved'", [BRAND]);
    expect(rows.map((r) => r.model).sort()).toEqual([`Truck G1 ${LOW}`, `Truck G1 ${HIGH2}`, `Truck G1 ${HIGH4}`].sort());
    expect(rows.every((r) => r.year_range === '2000-2010')).toBe(true);
    for (const r of rows) {
      const [prices] = await conn.query("SELECT part_price FROM model_item_prices WHERE vehicle_model_id = ? AND item_key = 'shock'", [r.id]);
      expect(prices).toHaveLength(1);
    }
    expect(await statusOf(ids.truck)).toBe('retired');
  });

  test('a car linked to a split pickup loses the link and keeps its typed name', async () => {
    const [[car]] = await conn.query('SELECT model, vehicle_model_id FROM vehicles WHERE id = ?', [fixture.vehicleId]);
    expect(car.vehicle_model_id).toBeNull();
    expect(car.model).toBeTruthy();
  });

  test('a generation gets its clear name, and a repeated entry hands over its prices', async () => {
    const [[sedan]] = await conn.query('SELECT model, status FROM vehicle_models WHERE id = ?', [ids.sedan]);
    expect(sedan).toEqual({ model: 'Sedan G1', status: 'approved' });
    const [moved] = await conn.query("SELECT id FROM model_item_prices WHERE vehicle_model_id = ? AND item_key = 'rack'", [ids.sedan]);
    expect(moved).toHaveLength(1);
    expect(await statusOf(ids.typed)).toBe('retired');
  });

  test('every entry without a year is hidden, its prices stay, entries with a year are untouched', async () => {
    expect(await statusOf(ids.junk)).toBe('retired');
    expect(await statusOf(ids.pending)).toBe('retired');
    expect(await statusOf(ids.kept)).toBe('approved');
    const [prices] = await conn.query('SELECT id FROM model_item_prices WHERE vehicle_model_id = ?', [ids.junk]);
    expect(prices).toHaveLength(1);
    expect(first.notes.join('\n')).toMatch(/skip move.*Missing|skip move \(not an approved entry\): .*Missing/);
    const [[left]] = await conn.query("SELECT COUNT(*) AS n FROM vehicle_models WHERE (year_range IS NULL OR year_range = '') AND status IN ('approved', 'pending')");
    expect(left.n).toBe(0);
  });

  test('running again changes nothing', async () => {
    const again = await runPlan(conn, plan);
    expect(again.stats).toMatchObject({ pickupEntries: 0, pickupRetired: 0, moved: 0, noYearRetired: 0, renamed: 0 });
  });
});
