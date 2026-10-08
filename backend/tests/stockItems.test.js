const request = require('supertest');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { getOfficeToken, getTechnicianToken } = require('./helpers');

const app = createApp();

describe('/api/stock-items — สต๊อกรวม', () => {
  let token;
  let categoryId;
  const createdItemIds = [];
  const suffix = Date.now().toString(36);

  beforeAll(async () => {
    token = await getOfficeToken();
    const res = await request(app)
      .post('/api/stock-items/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `TEST-CAT-${suffix}` });
    categoryId = res.body.id;
  });

  afterAll(async () => {
    if (createdItemIds.length) {
      await pool.query('DELETE FROM stock_item_movements WHERE item_id IN (?)', [createdItemIds]);
      await pool.query('DELETE FROM stock_items WHERE id IN (?)', [createdItemIds]);
    }
    await pool.execute('DELETE FROM stock_categories WHERE id = ?', [categoryId]);
  });

  const auth = (req) => req.set('Authorization', `Bearer ${token}`);

  async function createItem(extra = {}) {
    const res = await auth(request(app).post('/api/stock-items')).send({
      category_id: categoryId,
      oem_code: `OEM-${suffix}-${Math.random().toString(36).slice(2, 7)}`,
      description: 'ทดสอบ',
      stock_qty: 5,
      ...extra,
    });
    if (res.body.id) createdItemIds.push(res.body.id);
    return res;
  }

  test('technician เข้าไม่ได้ (403)', async () => {
    const techToken = await getTechnicianToken();
    const res = await request(app).get('/api/stock-items').set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(403);
  });

  test('ไม่ล็อกอินเข้าไม่ได้ (401)', async () => {
    const res = await request(app).get('/api/stock-items');
    expect(res.status).toBe(401);
  });

  test('หมวดตั้งต้นมีครบ และชื่อหมวดซ้ำคืน 409', async () => {
    const list = await auth(request(app).get('/api/stock-items/categories'));
    expect(list.status).toBe(200);
    expect(list.body.some((c) => c.id === categoryId)).toBe(true);
    const dup = await auth(request(app).post('/api/stock-items/categories')).send({ name: `TEST-CAT-${suffix}` });
    expect(dup.status).toBe(409);
  });

  test('เพิ่มรายการ + ค้นหา + บันทึกประวัติตอนสร้าง', async () => {
    const res = await createItem({ oem_code: `FIND-${suffix}` });
    expect(res.status).toBe(201);
    const search = await auth(request(app).get('/api/stock-items')).query({ q: `FIND-${suffix}` });
    expect(search.body).toHaveLength(1);
    expect(search.body[0].stock_qty).toBe(5);
    const moves = await auth(request(app).get(`/api/stock-items/${res.body.id}/movements`));
    expect(moves.body).toHaveLength(1);
    expect(moves.body[0]).toMatchObject({ qty_before: 0, qty_after: 5, reason: 'create' });
  });

  test('รหัส OEM ซ้ำในหมวดเดียวกันคืน 409', async () => {
    const code = `DUP-${suffix}`;
    expect((await createItem({ oem_code: code })).status).toBe(201);
    expect((await createItem({ oem_code: code })).status).toBe(409);
  });

  test('validation: ไม่มีรหัส OEM / จำนวนติดลบ / ทศนิยม ถูกปฏิเสธ', async () => {
    expect((await createItem({ oem_code: '  ' })).status).toBe(400);
    expect((await createItem({ stock_qty: -1 })).status).toBe(400);
    expect((await createItem({ stock_qty: 1.5 })).status).toBe(400);
  });

  test('ปรับ +/− และตั้งยอด มีประวัติ และห้ามติดลบ', async () => {
    const { body } = await createItem({ stock_qty: 2 });
    const id = body.id;
    const up = await auth(request(app).patch(`/api/stock-items/${id}/qty`)).send({ delta: 3 });
    expect(up.body.stock_qty).toBe(5);
    const below = await auth(request(app).patch(`/api/stock-items/${id}/qty`)).send({ delta: -6 });
    expect(below.status).toBe(400);
    const set = await auth(request(app).patch(`/api/stock-items/${id}/qty`)).send({ set_to: 1, note: 'นับจริง' });
    expect(set.body.stock_qty).toBe(1);
    const both = await auth(request(app).patch(`/api/stock-items/${id}/qty`)).send({ delta: 1, set_to: 1 });
    expect(both.status).toBe(400);
    const moves = await auth(request(app).get(`/api/stock-items/${id}/movements`));
    expect(moves.body.map((m) => m.reason)).toEqual(['set', 'adjust', 'create']);
  });

  test('ซ่อนรายการแล้วไม่โผล่ในรายการ และเพิ่มรหัสเดิมกลับมาได้', async () => {
    const code = `HIDE-${suffix}`;
    const { body } = await createItem({ oem_code: code, stock_qty: 4 });
    expect((await auth(request(app).delete(`/api/stock-items/${body.id}`))).status).toBe(200);
    const list = await auth(request(app).get('/api/stock-items')).query({ q: code });
    expect(list.body).toHaveLength(0);
    const again = await createItem({ oem_code: code, stock_qty: 7 });
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(body.id);
    const after = await auth(request(app).get('/api/stock-items')).query({ q: code });
    expect(after.body[0].stock_qty).toBe(7);
  });

  test('แก้ไขข้อมูลทั่วไปไม่แตะจำนวน', async () => {
    const { body } = await createItem({ stock_qty: 3 });
    const put = await auth(request(app).put(`/api/stock-items/${body.id}`)).send({
      category_id: categoryId, oem_code: `EDIT-${suffix}`, description: 'แก้แล้ว', stock_qty: 99, min_stock: 2,
    });
    expect(put.status).toBe(200);
    const got = await auth(request(app).get('/api/stock-items')).query({ q: `EDIT-${suffix}` });
    expect(got.body[0]).toMatchObject({ description: 'แก้แล้ว', min_stock: 2, stock_qty: 3 });
  });

  test('ของแยกซ้าย/ขวา: ยอดแต่ละข้าง + ผลรวม + ปรับทีละข้าง + ประวัติบอกตำแหน่ง', async () => {
    const { status, body } = await createItem({
      has_sides: true, oem_code_right: `R-${suffix}`, stocks: { left: 2, right: 3 }, stock_qty: undefined,
    });
    expect(status).toBe(201);
    const id = body.id;
    const get = async () => (await auth(request(app).get('/api/stock-items')).query({ q: `R-${suffix}` })).body[0];
    expect(await get()).toMatchObject({
      has_sides: 1, has_axles: 0, stock_qty: 5, oem_code_right: `R-${suffix}`,
      positions: [{ position: 'left', qty: 2 }, { position: 'right', qty: 3 }],
    });

    const up = await auth(request(app).patch(`/api/stock-items/${id}/qty`)).send({ position: 'right', delta: 2 });
    expect(up.body).toMatchObject({ stock_qty: 7, position: 'right', qty: 5 });
    expect((await get()).positions).toEqual([{ position: 'left', qty: 2 }, { position: 'right', qty: 5 }]);

    const noPos = await auth(request(app).patch(`/api/stock-items/${id}/qty`)).send({ delta: 1 });
    expect(noPos.status).toBe(400);
    const wrongPos = await auth(request(app).patch(`/api/stock-items/${id}/qty`)).send({ position: 'front', delta: 1 });
    expect(wrongPos.status).toBe(400);
    const below = await auth(request(app).patch(`/api/stock-items/${id}/qty`)).send({ position: 'left', delta: -3 });
    expect(below.status).toBe(400);

    const moves = await auth(request(app).get(`/api/stock-items/${id}/movements`));
    expect(moves.body[0]).toMatchObject({ position: 'right', qty_before: 3, qty_after: 5, reason: 'adjust' });
  });

  test('โช๊ค: แยกทั้งหน้า/หลังและซ้าย/ขวา = 4 ตำแหน่ง ยอดรวมถูก', async () => {
    const { status, body } = await createItem({
      has_sides: true, has_axles: true, oem_code_right: null, stock_qty: undefined,
      stocks: { front_left: 1, front_right: 2, rear_left: 3, rear_right: 4 },
    });
    expect(status).toBe(201);
    const item = (await auth(request(app).get('/api/stock-items')).query({ q: 'OEM-' + suffix })).body.find((i) => i.id === body.id);
    expect(item.stock_qty).toBe(10);
    expect(item.positions.map((p) => p.position)).toEqual(['front_left', 'front_right', 'rear_left', 'rear_right']);
    const res = await auth(request(app).patch(`/api/stock-items/${body.id}/qty`)).send({ position: 'rear_right', set_to: 0 });
    expect(res.body).toMatchObject({ stock_qty: 6, qty: 0 });
    const left = await auth(request(app).patch(`/api/stock-items/${body.id}/qty`)).send({ position: 'left', delta: 1 });
    expect(left.status).toBe(400);
  });

  test('โช๊คแยกหน้า/หลังอย่างเดียว = 2 ตำแหน่ง', async () => {
    const { status, body } = await createItem({
      has_axles: true, stock_qty: undefined, stocks: { front: 5, rear: 1 },
    });
    expect(status).toBe(201);
    const item = (await auth(request(app).get('/api/stock-items')).query({ q: 'OEM-' + suffix })).body.find((i) => i.id === body.id);
    expect(item).toMatchObject({ has_sides: 0, has_axles: 1, stock_qty: 6 });
    expect(item.positions).toEqual([{ position: 'front', qty: 5 }, { position: 'rear', qty: 1 }]);
  });

  test('ของธรรมดาห้ามส่ง position', async () => {
    const { body } = await createItem({ stock_qty: 2 });
    const res = await auth(request(app).patch(`/api/stock-items/${body.id}/qty`)).send({ position: 'left', delta: 1 });
    expect(res.status).toBe(400);
  });

  test('รุ่นรถ/ปี: บันทึก ค้นหาด้วยรุ่นรถ แก้แทนทั้งชุด และ validate ปี', async () => {
    const created = await createItem({
      fitments: [
        { brand: 'TOYOTA', model: `VIGO${suffix}`, year_from: 2005, year_to: 2011 },
        { brand: 'TOYOTA', model: `VIGO${suffix}`, year_from: 2005, year_to: 2011 },
        { brand: 'ISUZU', model: 'D-MAX', year_from: '', year_to: '' },
      ],
    });
    expect(created.status).toBe(201);
    const found = await auth(request(app).get('/api/stock-items')).query({ q: `VIGO${suffix}` });
    expect(found.body).toHaveLength(1);
    expect(found.body[0].fitments).toHaveLength(2);
    expect(found.body[0].fitments[0]).toMatchObject({ brand: 'ISUZU', model: 'D-MAX', year_from: null, year_to: null });

    const item = found.body[0];
    const put = await auth(request(app).put(`/api/stock-items/${item.id}`)).send({
      category_id: categoryId, oem_code: item.oem_code, description: '', min_stock: 1,
      fitments: [{ brand: 'HONDA', model: 'CITY', year_from: 2014, year_to: 2019 }],
    });
    expect(put.status).toBe(200);
    const after = await auth(request(app).get('/api/stock-items')).query({ q: item.oem_code });
    expect(after.body[0].fitments).toEqual([{ brand: 'HONDA', model: 'CITY', year_from: 2014, year_to: 2019 }]);

    expect((await createItem({ fitments: [{ brand: 'X', model: 'Y', year_from: 2020, year_to: 2010 }] })).status).toBe(400);
    expect((await createItem({ fitments: [{ brand: 'X', model: 'Y', year_from: 1800 }] })).status).toBe(400);
    expect((await createItem({ fitments: [{ brand: '', model: 'Y' }] })).status).toBe(400);
  });
});
