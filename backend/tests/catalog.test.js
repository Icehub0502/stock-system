// Shared vehicle model book: who may edit it, adding models with a year range, and the review of models typed in by staff.
const request = require('supertest');
const pool = require('../src/db/pool');
const { createApp } = require('../src/app');
const { getDevToken, createShop, dropShop } = require('./helpers');

const app = createApp();
const as = (token) => ({ Authorization: `Bearer ${token}` });
const unique = Date.now().toString(36);
const BRAND = `CatTest${unique}`;

let devToken;
let shopA;
let shopB;

const dev = {
  post: (url, body) => request(app).post(`/api/dev/catalog${url}`).set(as(devToken)).send(body),
  patch: (url, body) => request(app).patch(`/api/dev/catalog${url}`).set(as(devToken)).send(body),
  get: (url) => request(app).get(`/api/dev/catalog${url}`).set(as(devToken)),
  del: (url) => request(app).delete(`/api/dev/catalog${url}`).set(as(devToken)),
};
beforeAll(async () => {
  devToken = await getDevToken();
  shopA = await createShop();
  shopB = await createShop();
});

afterAll(async () => {
  await pool.query('DELETE FROM vehicle_models WHERE brand LIKE ?', [`${BRAND}%`]);
  await pool.query("DELETE FROM dev_audit_log WHERE action LIKE 'catalog_%' AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)");
  await dropShop(shopA.shopId);
  await dropShop(shopB.shopId);
  await pool.end();
});

describe('who may edit the master book', () => {
  test('dev only', async () => {
    for (const t of [shopA.token, shopA.managerToken, shopA.ownerToken]) {
      expect((await request(app).get('/api/dev/catalog/summary').set(as(t))).status).toBe(403);
      expect((await request(app).post('/api/dev/catalog/models').set(as(t)).send({ brand: BRAND, model: 'X' })).status).toBe(403);
      expect((await request(app).get('/api/dev/catalog/pending').set(as(t))).status).toBe(403);
    }
    expect((await dev.get('/summary')).status).toBe(200);
  });
});

describe('adding and renaming models', () => {
  test('year range format is checked; duplicates are refused; an old loose value stays editable', async () => {
    expect((await dev.post('/models', { brand: BRAND, model: '' })).status).toBe(400);
    // year range: 2013-2022 / 2022-ปัจจุบัน only, end not before start
    for (const bad of ['13-22', '2013', '2022-2013', '2013 - 2022', 'abcd-efgh']) {
      expect((await dev.post('/models', { brand: BRAND, model: 'BadYears', year_range: bad })).status).toBe(400);
    }
    expect((await dev.post('/models', { brand: BRAND, model: 'OpenEnded', year_range: '2022-ปัจจุบัน' })).status).toBe(201);
    await pool.query("INSERT INTO vehicle_models (brand, model, year_range, status) VALUES (?, 'Legacy', '1990s-2001', 'approved')", [BRAND]);
    const [[legacy]] = await pool.query("SELECT id FROM vehicle_models WHERE brand = ? AND model = 'Legacy'", [BRAND]);
    expect((await dev.patch(`/models/${legacy.id}`, { model: 'Legacy Renamed' })).status).toBe(200);
    expect((await dev.patch(`/models/${legacy.id}`, { year_range: '1990s-2002' })).status).toBe(400);
    expect((await dev.patch(`/models/${legacy.id}`, { year_range: '1990-2001' })).status).toBe(200);
    expect((await dev.post('/models', { brand: BRAND, model: 'Alpha', year_range: '2020-2024' })).status).toBe(201);
    expect((await dev.post('/models', { brand: BRAND, model: 'alpha', year_range: '2020-2024' })).status).toBe(409);
  });

  test('renaming a model keeps its id, so prices hung on it stay attached', async () => {
    const [[model]] = await pool.query('SELECT id FROM vehicle_models WHERE brand = ? AND model = ?', [BRAND, 'Alpha']);
    expect((await dev.patch(`/models/${model.id}`, { model: 'Alpha Plus' })).status).toBe(200);
    const [[after]] = await pool.query('SELECT model, year_range FROM vehicle_models WHERE id = ?', [model.id]);
    expect(after).toMatchObject({ model: 'Alpha Plus', year_range: '2020-2024' });
    const listed = (await dev.get(`/models?brand=${encodeURIComponent(BRAND)}`)).body.data;
    expect(listed.find((m) => m.id === model.id).display_name).toBe("Alpha Plus ปี '20-24'");
  });
});

describe('deleting a model', () => {
  test('a model with no prices is deleted and its cars lose only the link; one with prices is refused', async () => {
    const free = (await dev.post('/models', { brand: BRAND, model: 'Gone', year_range: '2000-2005' })).body.data.id;
    const kept = (await dev.post('/models', { brand: BRAND, model: 'Kept', year_range: '2006-2010' })).body.data.id;
    const [c] = await pool.query('INSERT INTO customers (shop_id, customer_name, phone) VALUES (?, ?, NULL)', [shopA.shopId, `Del ${unique}`]);
    const [v] = await pool.query('INSERT INTO vehicles (shop_id, customer_id, brand, model, license_plate, vehicle_model_id) VALUES (?, ?, ?, ?, ?, ?)', [shopA.shopId, c.insertId, BRAND, 'Gone', `DL${unique}`.slice(0, 15), free]);
    await pool.query('INSERT INTO model_item_prices (group_id, vehicle_model_id, item_key, item_name, part_price) VALUES (?, ?, ?, ?, 100)', [shopA.groupId, kept, 'x', 'X']);

    expect((await request(app).delete(`/api/dev/catalog/models/${free}`).set(as(shopA.managerToken))).status).toBe(403);
    expect((await dev.del(`/models/${kept}`)).status).toBe(409);
    expect((await dev.del(`/models/${free}`)).status).toBe(200);
    expect((await dev.del(`/models/${free}`)).status).toBe(404);

    const [[car]] = await pool.query('SELECT brand, model, vehicle_model_id FROM vehicles WHERE id = ?', [v.insertId]);
    expect(car).toMatchObject({ brand: BRAND, model: 'Gone', vehicle_model_id: null });
    const [[still]] = await pool.query('SELECT COUNT(*) n FROM vehicle_models WHERE id = ?', [kept]);
    expect(still.n).toBe(1);

    await pool.query('DELETE FROM model_item_prices WHERE vehicle_model_id = ?', [kept]);
    await pool.query('DELETE FROM vehicles WHERE shop_id = ?', [shopA.shopId]);
    await pool.query('DELETE FROM customers WHERE shop_id = ?', [shopA.shopId]);
  });
});

describe('models typed in by staff', () => {
  const PBRAND = `${BRAND}P`;
  let pendingId;

  test('a new model is pending: only the shop that typed it sees it', async () => {
    await dev.post('/models', { brand: PBRAND, model: 'Camry', year_range: '2012-2018' });

    const added = await request(app).post('/api/vehicle-models').set(as(shopA.token)).send({ brand: PBRAND, model: 'Zeta GT' });
    expect(added.status).toBe(201);
    expect(added.body.data.pending).toBe(true);

    const seenBy = async (shop) => (await request(app).get('/api/vehicle-models/models').query({ brand: PBRAND }).set(as(shop.token))).body.data;
    expect((await seenBy(shopA)).find((m) => m.model === 'Zeta GT')).toMatchObject({ pending: true });
    expect((await seenBy(shopB)).find((m) => m.model === 'Zeta GT')).toBeUndefined();
    expect((await seenBy(shopB)).find((m) => m.model === 'Camry')).toMatchObject({ pending: false });
  });

  test('a name that is already in the book (any spelling) is not added again', async () => {
    const again = await request(app).post('/api/vehicle-models').set(as(shopA.token)).send({ brand: PBRAND.toLowerCase(), model: 'zeta-gt' });
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ existed: true, model: 'Zeta GT', brand: PBRAND });

    const camry = await request(app).post('/api/vehicle-models').set(as(shopB.token)).send({ brand: PBRAND, model: 'CAMRY' });
    // an existing generation comes back under the name staff see and save: model + short year range
    expect(camry.body.data).toMatchObject({ existed: true, model: "Camry ปี '12-18'" });
    // typing that very display name (what the picker fills in) is recognised too, so it never becomes a pending model
    const typedDisplay = await request(app).post('/api/vehicle-models').set(as(shopA.token)).send({ brand: PBRAND, model: "camry ปี 12-18" });
    expect(typedDisplay.body.data).toMatchObject({ existed: true, model: "Camry ปี '12-18'" });

    const listed = (await request(app).get('/api/vehicle-models/models').query({ brand: PBRAND }).set(as(shopA.token))).body.data;
    expect(listed.find((m) => m.model === 'Camry')).toMatchObject({ label: 'Camry (2012-2018)', display_name: "Camry ปี '12-18'" });
    expect(listed.find((m) => m.model === 'Zeta GT').display_name).toBe('Zeta GT');

    const [rows] = await pool.query('SELECT COUNT(*) AS n FROM vehicle_models WHERE brand = ?', [PBRAND]);
    expect(rows[0].n).toBe(2);

    expect((await request(app).post('/api/vehicle-models').set(as(shopA.token)).send({ brand: '', model: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/vehicle-models').set(as(shopA.token)).send({ brand: PBRAND, model: 'x'.repeat(101) })).status).toBe(400);
  });

  test('the dev sees the pending model with the shop and a look-alike hint', async () => {
    await request(app).post('/api/vehicle-models').set(as(shopB.token)).send({ brand: PBRAND, model: 'Camry Hybrid' });
    const list = (await dev.get('/pending')).body.data.filter((r) => r.brand === PBRAND);
    expect(list.map((r) => r.model).sort()).toEqual(['Camry Hybrid', 'Zeta GT']);
    const hybrid = list.find((r) => r.model === 'Camry Hybrid');
    expect(hybrid.shop_name).toMatch(/^Test shop/);
    expect(hybrid.similar.map((s) => s.label)).toContain('Camry (2012-2018)');
    pendingId = list.find((r) => r.model === 'Zeta GT').id;
  });

  test('approving puts the model in the shared catalogue for every shop', async () => {
    expect((await dev.post(`/pending/${pendingId}/approve`, {})).status).toBe(200);
    const seenByB = (await request(app).get('/api/vehicle-models/models').query({ brand: PBRAND }).set(as(shopB.token))).body.data;
    expect(seenByB.find((m) => m.model === 'Zeta GT')).toMatchObject({ pending: false });
    expect((await dev.post(`/pending/${pendingId}/approve`, {})).status).toBe(404);
  });

  test('merging renames the shop\'s saved cars and links them to the generation, then removes the pending entry; rejecting only removes it', async () => {
    const [[camry]] = await pool.query("SELECT id FROM vehicle_models WHERE brand = ? AND model = 'Camry'", [PBRAND]);
    const [[hybrid]] = await pool.query("SELECT id FROM vehicle_models WHERE brand = ? AND model = 'Camry Hybrid'", [PBRAND]);

    // a saved vehicle of shop B with that spelling, and the same spelling in shop A (which did not submit it)
    const addVehicle = async (shop) => {
      const [c] = await pool.query('INSERT INTO customers (shop_id, customer_code, customer_name, phone) VALUES (?, ?, ?, ?)', [shop.shopId, `CT${unique}`.slice(0, 20), 'Catalog test', '0800000000']);
      const [v] = await pool.query('INSERT INTO vehicles (customer_id, brand, model) VALUES (?, ?, ?)', [c.insertId, PBRAND, 'Camry Hybrid']);
      return v.insertId;
    };
    const vehicleB = await addVehicle(shopB);
    const vehicleA = await addVehicle(shopA);

    expect((await dev.post(`/pending/${hybrid.id}/merge`, {})).status).toBe(400);
    expect((await dev.post(`/pending/${hybrid.id}/merge`, { target_id: camry.id })).status).toBe(200);

    const [[carB]] = await pool.query('SELECT model FROM vehicles WHERE id = ?', [vehicleB]);
    const [[carA]] = await pool.query('SELECT model FROM vehicles WHERE id = ?', [vehicleA]);
    expect(carB.model).toBe("Camry ปี '12-18'");
    expect(carA.model).toBe('Camry Hybrid');
    // the merged car is linked to the generation, the other shop's car is untouched
    const [[linkB]] = await pool.query('SELECT vehicle_model_id FROM vehicles WHERE id = ?', [vehicleB]);
    const [[linkA]] = await pool.query('SELECT vehicle_model_id FROM vehicles WHERE id = ?', [vehicleA]);
    expect(linkB.vehicle_model_id).toBe(camry.id);
    expect(linkA.vehicle_model_id).toBeNull();
    const [[gone]] = await pool.query('SELECT COUNT(*) AS n FROM vehicle_models WHERE id = ?', [hybrid.id]);
    expect(gone.n).toBe(0);

    await request(app).post('/api/vehicle-models').set(as(shopA.token)).send({ brand: PBRAND, model: 'Typo Car' });
    const [[typo]] = await pool.query("SELECT id FROM vehicle_models WHERE brand = ? AND model = 'Typo Car'", [PBRAND]);
    expect((await dev.del(`/pending/${typo.id}`)).status).toBe(200);
    expect((await dev.del(`/pending/${typo.id}`)).status).toBe(404);
  });

  test('approving a name that is already in the book is refused and points at merging', async () => {
    await request(app).post('/api/vehicle-models').set(as(shopA.token)).send({ brand: PBRAND, model: 'Sigma' });
    // the same model gets approved by hand meanwhile
    await dev.post('/models', { brand: PBRAND, model: 'SIGMA' });
    const [[sigma]] = await pool.query("SELECT id FROM vehicle_models WHERE brand = ? AND model = 'Sigma' AND status = 'pending'", [PBRAND]);
    const res = await dev.post(`/pending/${sigma.id}/approve`, {});
    expect(res.status).toBe(409);
    expect(res.body.duplicate_id).toBeTruthy();
  });
});
