const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { getOfficeToken, getManagerToken, getTechnicianToken } = require('./helpers');
const { partKind, sameModelName, findStockFor, fitsCar, sameKindOfPart } = require('../src/utils/priceListMatch');

const app = createApp();

describe('which stock a price line is about', () => {
  const car = { brand: 'Toyota', model: 'Vigo G1', year_range: 'ปี 2004-2011' };
  const stock = (over) => ({ category_name: 'แร็ค', description: '', fitments: [], ...over });

  test('the kind of part, most specific first', () => {
    expect(partKind('ลูกหมากปลายแร็ค')).toBe(partKind('ลูกหมากปีกนก'));
    expect(partKind('แร็ค OEM')).not.toBe(partKind('ลูกหมากปลายแร็ค'));
    expect(partKind('โช้คอัพหน้า')).toBe(partKind('โช๊คหลัง'));
    expect(partKind('ค่าตั้งศูนย์')).toBeNull();
  });
  test('model names, generations and years', () => {
    expect(sameModelName('Vigo G1', 'vigo')).toBe(true);
    expect(sameModelName('Vios', 'Civic')).toBe(false);
    expect(sameModelName('A', 'A4')).toBe(false);
    const fit = (over) => stock({ fitments: [{ brand: 'TOYOTA', model: 'Vigo', year_from: null, year_to: null, ...over }] });
    expect(fitsCar(fit(), car)).toBe(true);
    expect(fitsCar(fit({ year_from: 2005, year_to: 2008 }), car)).toBe(true);
    expect(fitsCar(fit({ year_from: 2015, year_to: 2020 }), car)).toBe(false);
    expect(fitsCar(fit({ brand: 'Honda' }), car)).toBe(false);
    expect(fitsCar(stock({ description: 'แร็ค TOYOTA VIGO 2WD' }), car)).toBe(true);
    expect(fitsCar(stock({ description: 'แร็ค CIVIC' }), car)).toBe(false);
  });
  test('words a price names must be on the stock, and front is not rear', () => {
    expect(sameKindOfPart('ลูกหมากปลายแร็ค', stock({ category_name: 'ลูกหมากปลาย' }))).toBe(true);
    expect(sameKindOfPart('ลูกหมากปลายแร็ค', stock({ category_name: 'ลูกหมากกันโคลง' }))).toBe(false);
    expect(sameKindOfPart('โช๊คหน้า', stock({ category_name: 'โช๊ค', description: 'โช๊คหลัง VIGO' }))).toBe(false);
    expect(sameKindOfPart('โช๊คหน้า', stock({ category_name: 'โช๊ค', description: 'โช๊คหน้า VIGO' }))).toBe(true);
    expect(sameKindOfPart('โช๊ค', stock({ category_name: 'โช๊ค', description: 'โช๊คหลัง VIGO' }))).toBe(true);
    expect(sameKindOfPart('แร็คมือสอง', stock({ description: 'แร็คใหม่ VIGO' }))).toBe(false);
  });
  test('a promo set or a line of no known kind matches nothing', () => {
    const items = [stock({ description: 'แร็ค VIGO' })];
    expect(findStockFor({ ...car, item_name: 'แร็ค OEM', is_set: false }, items)).toHaveLength(1);
    expect(findStockFor({ ...car, item_name: 'แร็ค OEM', is_set: true }, items)).toHaveLength(0);
    expect(findStockFor({ ...car, item_name: 'ค่าตั้งศูนย์', is_set: false }, items)).toHaveLength(0);
  });
});

describe('/api/price-list', () => {
  let officeToken;
  let managerToken;
  let techToken;
  let salesToken;
  let accountantToken;
  let groupId;
  let modelId;
  let otherModelId;
  let categoryId;
  const suffix = Date.now().toString(36).toUpperCase();
  const madeUsers = [];
  const item = (text) => `${text} ${suffix}`;

  const as = (token) => request(app).get('/api/price-list').set('Authorization', `Bearer ${token}`);
  const mine = (res) => res.body.data.rows.filter((r) => r.item_name.includes(suffix));

  async function roleToken(role) {
    const [u] = await pool.query("INSERT INTO users (shop_id, username, password_hash, full_name, role) VALUES (1, ?, 'x', ?, ?)", [`t_${role}_${suffix}`, role, role]);
    madeUsers.push(u.insertId);
    return jwt.sign({ id: u.insertId, username: `t_${role}_${suffix}`, role, shop_id: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
  }

  beforeAll(async () => {
    officeToken = await getOfficeToken();
    managerToken = await getManagerToken();
    techToken = await getTechnicianToken();
    salesToken = await roleToken('sales');
    accountantToken = await roleToken('accountant');
    const [[shop]] = await pool.query('SELECT group_id FROM shops WHERE id = 1');
    groupId = shop.group_id;
    const [m] = await pool.query("INSERT INTO vehicle_models (brand, model, year_range, status) VALUES (?, ?, 'ปี 2004-2011', 'approved')", [`Brand${suffix}`, 'Vigoz G1']);
    modelId = m.insertId;
    const [o] = await pool.query("INSERT INTO vehicle_models (brand, model, year_range, status) VALUES (?, 'Civicz', 'ปี 2016-2020', 'approved')", [`Brand${suffix}`]);
    otherModelId = o.insertId;
    const price = (model, name, part, labor = null, isSet = 0, active = 1) => pool.query(
      `INSERT INTO model_item_prices (group_id, vehicle_model_id, item_key, item_name, part_price, labor_price, is_set, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [groupId, model, name.toLowerCase().replace(/\s+/g, ''), name, part, labor, isSet, active]
    );
    await price(modelId, item('แร็ค OEM'), 5000, 500);
    await price(modelId, item('ชุดโปรช่วงล่าง'), 9000, null, 1);
    await price(modelId, item('แร็คถูก'), 100);
    await price(modelId, item('รายการที่เลิกใช้'), 100, null, 0, 0);
    const observe = (model, name, unit) => pool.query(
      "INSERT INTO price_observations (group_id, shop_id, vehicle_model_id, item_key, item_name, unit_price) VALUES (?, 1, ?, ?, ?, ?)",
      [groupId, model, name.toLowerCase().replace(/\s+/g, ''), name, unit]
    );
    await observe(otherModelId, item('โช๊คหน้า'), 1200);
    await observe(otherModelId, item('โช๊คหน้า'), 1500);
    await observe(modelId, item('แร็ค OEM'), 4000);

    const [c] = await pool.query('INSERT INTO stock_categories (shop_id, name) VALUES (1, ?)', [`แร็ค ${suffix}`]);
    categoryId = c.insertId;
    await pool.query(
      "INSERT INTO stock_items (shop_id, category_id, oem_code, description, stock_qty, avg_cost) VALUES (1, ?, ?, 'แร็ค VIGOZ 2WD', 3, 3000)",
      [categoryId, `R1-${suffix}`]
    );
    await pool.query(
      "INSERT INTO stock_items (shop_id, category_id, oem_code, description, stock_qty, avg_cost) VALUES (1, ?, ?, 'แร็ค CIVICZ', 1, 800)",
      [categoryId, `R2-${suffix}`]
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM stock_items WHERE category_id = ?', [categoryId]);
    await pool.query('DELETE FROM stock_categories WHERE id = ?', [categoryId]);
    await pool.query('DELETE FROM model_item_prices WHERE vehicle_model_id IN (?)', [[modelId, otherModelId]]);
    await pool.query('DELETE FROM price_observations WHERE vehicle_model_id IN (?)', [[modelId, otherModelId]]);
    await pool.query('DELETE FROM vehicle_models WHERE id IN (?)', [[modelId, otherModelId]]);
    if (madeUsers.length) await pool.query('DELETE FROM users WHERE id IN (?)', [madeUsers]);
  });

  test('standard prices with their total, and only the active ones', async () => {
    const rows = mine(await as(officeToken));
    const rack = rows.find((r) => r.item_name === item('แร็ค OEM'));
    expect(rack).toMatchObject({ source: 'standard', part_price: 5000, labor_price: 500, total_price: 5500, brand: `Brand${suffix}` });
    expect(rack.model_name).toContain('Vigoz');
    expect(rows.some((r) => r.item_name === item('รายการที่เลิกใช้'))).toBe(false);
  });

  test('a typed price fills in only where there is no standard one, the latest, with how often', async () => {
    const rows = mine(await as(officeToken));
    const typed = rows.find((r) => r.item_name === item('โช๊คหน้า'));
    expect(typed).toMatchObject({ source: 'typed', part_price: 1500, times: 2, labor_price: null });
    expect(rows.filter((r) => r.item_name === item('แร็ค OEM'))).toHaveLength(1);
  });

  test('stock is found by car and kind of part, with the codes shown; a set matches nothing', async () => {
    const rows = mine(await as(officeToken));
    const rack = rows.find((r) => r.item_name === item('แร็ค OEM'));
    expect(rack.stock).toEqual({ matched: 1, qty: 3, items: [{ code: `R1-${suffix}`, description: 'แร็ค VIGOZ 2WD', qty: 3 }] });
    expect(rows.find((r) => r.item_name === item('ชุดโปรช่วงล่าง')).stock.matched).toBe(0);
  });

  test('cost only reaches manager level, and never office, sales or a technician', async () => {
    const forManager = mine(await as(managerToken));
    const rack = forManager.find((r) => r.item_name === item('แร็ค OEM'));
    expect(rack).toMatchObject({ cost_min: 3000, cost_max: 3000, below_cost: false });
    expect(forManager.find((r) => r.item_name === item('แร็คถูก'))).toMatchObject({ below_cost: true });

    for (const token of [officeToken, salesToken]) {
      const res = await as(token);
      expect(res.body.data.sees_cost).toBe(false);
      expect(JSON.stringify(res.body)).not.toMatch(/cost_min|cost_max|below_cost|avg_cost/);
    }
    const accountant = await as(accountantToken);
    expect(accountant.body.data.sees_cost).toBe(true);
    expect((await as(techToken)).status).toBe(403);
  });

  describe('the list follows the first branch, and a branch takes off what it does not sell', () => {
    const name = () => item('บริการที่ยังไม่มีราคา');
    const post = (token, body) => request(app).post('/api/price-list/hidden').set('Authorization', `Bearer ${token}`).send(body);
    const del = (token, body) => request(app).delete('/api/price-list/hidden').set('Authorization', `Bearer ${token}`).send(body);

    beforeAll(async () => {
      await pool.query("INSERT INTO service_items (shop_id, category, product_name, is_active) VALUES (1, 'งานบริการ', ?, 1)", [name()]);
      await pool.query("INSERT INTO service_items (shop_id, category, product_name, is_active) VALUES (1, 'งานบริการ', ?, 0)", [item('เลิกขายแล้ว')]);
      await pool.query("INSERT INTO service_items (shop_id, category, product_name, is_active, is_set, set_price) VALUES (1, 'ชุดโปร', ?, 1, 1, 7900)", [item('ชุดราคาคงที่')]);
      await pool.query("INSERT INTO service_items (shop_id, category, product_name, is_active) VALUES (1, 'แร็คพวงมาลัย', ?, 1)", [item('แร็ค OEM')]);
    });
    afterAll(async () => {
      await pool.query('DELETE FROM service_items WHERE shop_id = 1 AND product_name LIKE ?', [`%${suffix}`]);
      await pool.query('DELETE FROM price_list_hidden WHERE shop_id = 1 AND item_name LIKE ?', [`%${suffix}`]);
    });

    test('active items with no price still show, without a car or a total; a set shows its set price', async () => {
      const rows = mine(await as(officeToken));
      expect(rows.find((r) => r.item_name === name())).toMatchObject({ source: 'catalog', brand: '', total_price: null, part_price: null, category: 'งานบริการ' });
      expect(rows.some((r) => r.item_name === item('เลิกขายแล้ว'))).toBe(false);
      expect(rows.find((r) => r.item_name === item('ชุดราคาคงที่'))).toMatchObject({ source: 'catalog', is_set: true, total_price: 7900 });
    });

    test('an item with a price appears once with its car, taking its category from the list', async () => {
      const rows = mine(await as(officeToken)).filter((r) => r.item_name === item('แร็ค OEM'));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ source: 'standard', category: 'แร็คพวงมาลัย' });
    });

    test('sales and managers take an item off and put it back; office, a technician and accounts cannot', async () => {
      expect((await post(officeToken, { item_name: name() })).status).toBe(403);
      expect((await post(techToken, { item_name: name() })).status).toBe(403);
      expect((await post(accountantToken, { item_name: name() })).status).toBe(403);
      expect((await post(salesToken, { item_name: '' })).status).toBe(400);

      expect((await post(salesToken, { item_name: name() })).status).toBe(201);
      expect(mine(await as(officeToken)).some((r) => r.item_name === name())).toBe(false);
      const forSales = await as(salesToken);
      expect(forSales.body.data.may_edit_list).toBe(true);
      expect(forSales.body.data.hidden.some((h) => h.item_name === name())).toBe(true);
      for (const token of [officeToken, accountantToken]) {
        const res = await as(token);
        expect(res.body.data.may_edit_list).toBe(false);
        expect(res.body.data.hidden).toEqual([]);
      }
      // the item itself is untouched
      const [[row]] = await pool.query('SELECT is_active FROM service_items WHERE shop_id = 1 AND product_name = ?', [name()]);
      expect(row.is_active).toBe(1);

      expect((await del(officeToken, { item_name: name() })).status).toBe(403);
      expect((await del(managerToken, { item_name: name() })).status).toBe(200);
      expect(mine(await as(officeToken)).some((r) => r.item_name === name())).toBe(true);
    });

    test('taking off an item removes all its cars from the list, and its price stays', async () => {
      expect((await post(managerToken, { item_name: item('แร็ค OEM') })).status).toBe(201);
      expect(mine(await as(officeToken)).some((r) => r.item_name === item('แร็ค OEM'))).toBe(false);
      const [[price]] = await pool.query('SELECT is_active FROM model_item_prices WHERE vehicle_model_id = ? AND item_name = ?', [modelId, item('แร็ค OEM')]);
      expect(price.is_active).toBe(1);
      await del(managerToken, { item_name: item('แร็ค OEM') });
    });
  });
});
