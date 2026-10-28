// Shared parts catalogue: master book + per-shop adjustments, and the review of models typed in by staff.
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
const partsFor = async (shop, model) => {
  const res = await request(app).get('/api/quote-parts/parts').query({ brand: BRAND, model }).set(as(shop.token));
  return res.body.data;
};

beforeAll(async () => {
  devToken = await getDevToken();
  shopA = await createShop();
  shopB = await createShop();
});

afterAll(async () => {
  await pool.query('DELETE FROM quote_part_prices WHERE brand LIKE ?', [`${BRAND}%`]);
  await pool.query('DELETE FROM catalog_parts WHERE brand LIKE ?', [`${BRAND}%`]);
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

describe('master parts and a shop adjusting them', () => {
  const MODEL = 'Alpha (2020-2024)';
  let partId;

  test('dev adds a model and a part; validation and duplicates are refused', async () => {
    expect((await dev.post('/models', { brand: BRAND, model: '' })).status).toBe(400);
    // year range: 2013-2022 / 2022-ปัจจุบัน only, end not before start
    for (const bad of ['13-22', '2013', '2022-2013', '2013 - 2022', 'abcd-efgh']) {
      expect((await dev.post('/models', { brand: BRAND, model: 'BadYears', year_range: bad })).status).toBe(400);
    }
    expect((await dev.post('/models', { brand: BRAND, model: 'OpenEnded', year_range: '2022-ปัจจุบัน' })).status).toBe(201);
    // an old loose value stays editable as long as it is not changed
    await pool.query("INSERT INTO vehicle_models (brand, model, year_range, status) VALUES (?, 'Legacy', '1990s-2001', 'approved')", [BRAND]);
    const [[legacy]] = await pool.query("SELECT id FROM vehicle_models WHERE brand = ? AND model = 'Legacy'", [BRAND]);
    expect((await dev.patch(`/models/${legacy.id}`, { model: 'Legacy Renamed' })).status).toBe(200);
    expect((await dev.patch(`/models/${legacy.id}`, { year_range: '1990s-2002' })).status).toBe(400);
    expect((await dev.patch(`/models/${legacy.id}`, { year_range: '1990-2001' })).status).toBe(200);
    expect((await dev.post('/models', { brand: BRAND, model: 'Alpha', year_range: '2020-2024' })).status).toBe(201);
    expect((await dev.post('/models', { brand: BRAND, model: 'alpha', year_range: '2020-2024' })).status).toBe(409);

    expect((await dev.post('/parts', { brand: BRAND, model: 'Nope', part_name: 'Shock', price: 100 })).status).toBe(400);
    expect((await dev.post('/parts', { brand: BRAND, model: MODEL, part_name: 'Shock', price: -5 })).status).toBe(400);
    const created = await dev.post('/parts', { brand: BRAND, model: MODEL, part_name: 'Shock', price: 1000, category: 'Suspension' });
    expect(created.status).toBe(201);
    partId = created.body.data.id;
    expect((await dev.post('/parts', { brand: BRAND, model: MODEL, part_name: 'Shock', price: 1 })).status).toBe(409);
  });

  test('every shop sees the master part at the master price', async () => {
    for (const shop of [shopA, shopB]) {
      const brands = await request(app).get('/api/quote-parts/brands').set(as(shop.token));
      expect(brands.body.data).toContain(BRAND);
      const models = await request(app).get('/api/quote-parts/models').query({ brand: BRAND }).set(as(shop.token));
      expect(models.body.data).toContain(MODEL);
      const parts = await partsFor(shop, MODEL);
      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({ id: `c${partId}`, part_name: 'Shock', source: 'catalog', category: 'Suspension' });
      expect(Number(parts[0].price)).toBe(1000);
    }
  });

  test('a shop sets its own price: only that shop changes, and a later master change does not override it', async () => {
    expect((await request(app).put(`/api/quote-parts/c${partId}`).set(as(shopA.token)).send({ brand: BRAND, model: MODEL, part_name: 'Shock', price: 1 })).status).toBe(403);
    const put = await request(app).put(`/api/quote-parts/c${partId}`).set(as(shopA.managerToken))
      .send({ brand: 'ignored', model: 'ignored', part_name: 'ignored', price: 1200 });
    expect(put.status).toBe(200);

    let a = await partsFor(shopA, MODEL);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ part_name: 'Shock', source: 'custom' });
    expect(Number(a[0].price)).toBe(1200);
    expect(Number(a[0].catalog_price)).toBe(1000);
    expect(Number((await partsFor(shopB, MODEL))[0].price)).toBe(1000);

    expect((await dev.patch(`/parts/${partId}`, { price: 1100 })).status).toBe(200);
    expect(Number((await partsFor(shopA, MODEL))[0].price)).toBe(1200);
    const b = await partsFor(shopB, MODEL);
    expect(Number(b[0].price)).toBe(1100);

    // back to the master price
    const own = (await partsFor(shopA, MODEL))[0];
    expect((await request(app).post(`/api/quote-parts/${own.id}/reset`).set(as(shopA.managerToken))).status).toBe(200);
    a = await partsFor(shopA, MODEL);
    expect(a).toHaveLength(1);
    expect(a[0].source).toBe('catalog');
    expect(Number(a[0].price)).toBe(1100);
  });

  test('a shop deleting a master part only hides it for itself; the dev hiding it hides it for everyone', async () => {
    expect((await request(app).delete(`/api/quote-parts/c${partId}`).set(as(shopA.managerToken))).status).toBe(200);
    expect(await partsFor(shopA, MODEL)).toHaveLength(0);
    expect(await partsFor(shopB, MODEL)).toHaveLength(1);

    expect((await dev.patch(`/parts/${partId}`, { is_active: false })).status).toBe(200);
    expect(await partsFor(shopB, MODEL)).toHaveLength(0);
    expect((await dev.patch(`/parts/${partId}`, { is_active: true })).status).toBe(200);
    expect(await partsFor(shopB, MODEL)).toHaveLength(1);
  });

  test('a part only one shop has stays private to that shop', async () => {
    const created = await request(app).post('/api/quote-parts').set(as(shopA.managerToken))
      .send({ brand: BRAND, model: MODEL, part_name: 'Shop A only', price: 50 });
    expect(created.status).toBe(201);
    expect((await partsFor(shopA, MODEL)).map((p) => p.part_name)).toContain('Shop A only');
    expect((await partsFor(shopB, MODEL)).map((p) => p.part_name)).not.toContain('Shop A only');
    expect((await request(app).delete(`/api/quote-parts/${created.body.data.id}`).set(as(shopA.managerToken))).status).toBe(200);
  });

  test('renaming a model carries the master part and a shop adjustment along', async () => {
    const [[model]] = await pool.query('SELECT id FROM vehicle_models WHERE brand = ? AND model = ?', [BRAND, 'Alpha']);
    // shop B adjusts the part so there is a shop row to follow
    expect((await request(app).put(`/api/quote-parts/c${partId}`).set(as(shopB.managerToken)).send({ brand: BRAND, model: MODEL, part_name: 'Shock', price: 777 })).status).toBe(200);
    expect((await dev.patch(`/models/${model.id}`, { model: 'Alpha Plus' })).status).toBe(200);
    const renamed = 'Alpha Plus (2020-2024)';
    const b = await partsFor(shopB, renamed);
    expect(b).toHaveLength(1);
    expect(Number(b[0].price)).toBe(777);
    expect(await partsFor(shopB, MODEL)).toHaveLength(0);
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
    expect(camry.body.data).toMatchObject({ existed: true, model: 'Camry' });

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

  test('merging renames what the shop already saved, then removes the pending entry; rejecting only removes it', async () => {
    const [[camry]] = await pool.query("SELECT id FROM vehicle_models WHERE brand = ? AND model = 'Camry'", [PBRAND]);
    const [[hybrid]] = await pool.query("SELECT id FROM vehicle_models WHERE brand = ? AND model = 'Camry Hybrid'", [PBRAND]);

    // shop B saved a price under its own pending spelling
    expect((await request(app).post('/api/quote-parts').set(as(shopB.managerToken)).send({ brand: PBRAND, model: 'Camry Hybrid', part_name: 'Mount', price: 10 })).status).toBe(201);

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
    expect(carB.model).toBe('Camry');
    expect(carA.model).toBe('Camry Hybrid');

    const [moved] = await pool.query('SELECT model FROM quote_part_prices WHERE shop_id = ? AND part_name = ?', [shopB.shopId, 'Mount']);
    expect(moved[0].model).toBe('Camry (2012-2018)');
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
