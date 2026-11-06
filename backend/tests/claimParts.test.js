const request = require('supertest');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { getOfficeToken, getManagerToken, getTechnicianToken } = require('./helpers');

const app = createApp();

describe('/api/claims — what a case takes out of stock and what the customer pays', () => {
  let officeToken;
  let managerToken;
  let techToken;
  let customerId;
  let vehicleId;
  let categoryId;
  let plainItem;
  let sidedItem;
  const suffix = Date.now().toString(36).toUpperCase();
  const claimIds = [];
  const receiptIds = [];

  const as = (token, req) => req.set('Authorization', `Bearer ${token}`);
  const parts = (id) => as(officeToken, request(app).get(`/api/claims/${id}/parts`));
  const deduct = (id, body, token = officeToken) => as(token, request(app).post(`/api/claims/${id}/parts/deduct`)).send(body);
  const charge = (id, body, token = officeToken) => as(token, request(app).post(`/api/claims/${id}/charge-receipt`)).send(body);

  async function makeClaim(items) {
    const res = await as(officeToken, request(app).post('/api/claims')).send({
      customer_id: customerId, vehicle_id: vehicleId, symptom: 'ทดสอบ', items,
    });
    claimIds.push(res.body.id);
    return res.body.id;
  }
  const stockOf = async (id) => {
    const [[row]] = await pool.query('SELECT stock_qty FROM stock_items WHERE id = ?', [id]);
    return row.stock_qty;
  };

  beforeAll(async () => {
    officeToken = await getOfficeToken();
    managerToken = await getManagerToken();
    techToken = await getTechnicianToken();
    const [c] = await pool.query("INSERT INTO customers (shop_id, customer_code, customer_name) VALUES (1, ?, 'ทดสอบเคลม')", [`CP${suffix}`]);
    customerId = c.insertId;
    const [v] = await pool.query("INSERT INTO vehicles (shop_id, customer_id, brand, model, license_plate) VALUES (1, ?, 'TOYOTA', 'VIGO', ?)", [customerId, `CP-${suffix}`]);
    vehicleId = v.insertId;
    const cat = await as(managerToken, request(app).post('/api/stock-items/categories')).send({ name: `CP-CAT-${suffix}` });
    categoryId = cat.body.id;
    plainItem = (await as(managerToken, request(app).post('/api/stock-items')).send({ category_id: categoryId, oem_code: `CP-P-${suffix}`, description: 'ลูกหมาก', stock_qty: 5 })).body.id;
    sidedItem = (await as(managerToken, request(app).post('/api/stock-items')).send({
      category_id: categoryId, has_sides: true, codes: { left: `CP-L-${suffix}`, right: `CP-R-${suffix}` }, stocks: { left: 2, right: 2 }, description: 'ปีกนก',
    })).body.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM stock_item_movements WHERE item_id IN (?)', [[plainItem, sidedItem]]);
    await pool.query('DELETE FROM stock_items WHERE id IN (?)', [[plainItem, sidedItem]]);
    await pool.query('DELETE FROM stock_categories WHERE id = ?', [categoryId]);
    if (receiptIds.length) {
      await pool.query('DELETE FROM receipt_items WHERE receipt_id IN (?)', [receiptIds]);
      await pool.query('DELETE FROM receipts WHERE id IN (?)', [receiptIds]);
    }
    if (claimIds.length) await pool.query('DELETE FROM claims WHERE id IN (?)', [claimIds]);
    await pool.query('DELETE FROM vehicles WHERE id = ?', [vehicleId]);
    await pool.query('DELETE FROM customers WHERE id = ?', [customerId]);
  });

  test('taking a part out moves the stock, says which case, and giving it back returns it', async () => {
    const id = await makeClaim([{ product_name: 'ลูกหมาก', quantity: 2, unit_price: 0 }]);
    const res = await deduct(id, { item_id: plainItem, position: null, qty: 2 });
    expect(res.status).toBe(201);
    expect(await stockOf(plainItem)).toBe(3);

    const info = (await parts(id)).body.data;
    expect(info.moves).toHaveLength(1);
    expect(info.moves[0]).toMatchObject({ item_id: plainItem, qty: 2, code: `CP-P-${suffix}` });
    const [[mv]] = await pool.query('SELECT note, vehicle_model, claim_id FROM stock_item_movements WHERE id = ?', [res.body.movement_ids[0]]);
    expect(mv.note).toMatch(/^เคลม /);
    expect(mv.vehicle_model).toBe('TOYOTA VIGO');
    expect(mv.claim_id).toBe(id);

    expect((await as(managerToken, request(app).delete(`/api/stock-deductions/movements/${info.moves[0].id}`))).status).toBe(200);
    expect(await stockOf(plainItem)).toBe(5);
    expect((await parts(id)).body.data.moves).toEqual([]);
  });

  test('a position is required on a split item, and stock cannot go below zero', async () => {
    const id = await makeClaim([{ product_name: 'ปีกนก', quantity: 1, unit_price: 0 }]);
    expect((await deduct(id, { item_id: sidedItem, position: null, qty: 1 })).status).toBe(400);
    expect((await deduct(id, { item_id: sidedItem, position: 'left', qty: 3 })).status).toBe(400);
    expect((await deduct(id, { item_id: sidedItem, position: 'left', qty: 1 })).status).toBe(201);
    expect(await stockOf(sidedItem)).toBe(3);
    expect((await parts(id)).body.data.moves[0]).toMatchObject({ position: 'left', position_label: 'ซ้าย', code: `CP-L-${suffix}` });
  });

  test('saving the case again does not forget what it took', async () => {
    const id = await makeClaim([{ product_name: 'ลูกหมาก', quantity: 1, unit_price: 0 }]);
    await deduct(id, { item_id: plainItem, position: null, qty: 1 });
    const saved = await as(officeToken, request(app).put(`/api/claims/${id}`)).send({
      customer_id: customerId, vehicle_id: vehicleId, symptom: 'แก้ไข', items: [{ product_name: 'ลูกหมากใหม่', quantity: 1, unit_price: 0 }],
    });
    expect(saved.status).toBe(200);
    const info = (await parts(id)).body.data;
    expect(info.moves).toHaveLength(1);
    expect(info.items[0].product_name).toBe('ลูกหมากใหม่');
  });

  test('what the customer pays becomes a receipt of today and reaches the daily sales, once', async () => {
    const id = await makeClaim([
      { product_name: 'ค่าอะไหล่', quantity: 2, unit_price: 150 },
      { product_name: 'เปลี่ยนให้ฟรี', quantity: 1, unit_price: 0 },
    ]);
    expect((await parts(id)).body.data.charge_total).toBe(300);
    const daily = async () => (await as(managerToken, request(app).get('/api/receipts/daily-summary'))).body.data;
    const today = async () => {
      const [[{ d }]] = await pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS d");
      const row = (await daily()).find((r) => String(r.date).slice(0, 10) === d);
      return row || { total_revenue: 0, by_method: {} };
    };
    const before = await today();

    expect((await charge(id, {})).status).toBe(400);
    expect((await charge(id, { payment_method: 'ไม่มีช่องทางนี้' })).status).toBe(400);
    const res = await charge(id, { payment_method: 'เงินสด' });
    expect(res.status).toBe(201);
    expect(res.body.total_amount).toBe(300);
    receiptIds.push(res.body.receipt_id);

    const receipt = (await as(officeToken, request(app).get(`/api/receipts/${res.body.receipt_id}`))).body.data;
    expect(Number(receipt.total_amount)).toBe(300);
    expect(receipt.payment_method).toBe('เงินสด');
    expect(receipt.remark).toMatch(/^ค่าอะไหล่เคลม /);
    expect(receipt.items).toHaveLength(1);
    expect(receipt.items[0].product_name_snapshot).toBe('ค่าอะไหล่');
    // a receipt without one makes the next server start fail (see db/init.js)
    expect(Number(receipt.car_sequence_no)).toBeGreaterThan(0);

    const after = await today();
    expect(Number(after.total_revenue) - Number(before.total_revenue)).toBe(300);

    expect((await charge(id, { payment_method: 'เงินสด' })).status).toBe(409);
    expect((await parts(id)).body.data.receipt).toMatchObject({ id: res.body.receipt_id, payment_method: 'เงินสด' });
  });

  test('a case with nothing to charge has no receipt; a deleted receipt can be issued again', async () => {
    const free = await makeClaim([{ product_name: 'ฟรี', quantity: 1, unit_price: 0 }]);
    expect((await charge(free, { payment_method: 'เงินสด' })).status).toBe(400);

    const id = await makeClaim([{ product_name: 'ค่าอะไหล่', quantity: 1, unit_price: 100 }]);
    const first = await charge(id, { payment_method: 'คลิก' });
    await pool.query('DELETE FROM receipt_items WHERE receipt_id = ?', [first.body.receipt_id]);
    await pool.query('DELETE FROM receipts WHERE id = ?', [first.body.receipt_id]);
    expect((await parts(id)).body.data.receipt).toBeNull();
    const second = await charge(id, { payment_method: 'คลิก' });
    expect(second.status).toBe(201);
    receiptIds.push(second.body.receipt_id);
  });

  test('access and validation', async () => {
    const id = await makeClaim([{ product_name: 'ค่าอะไหล่', quantity: 1, unit_price: 100 }]);
    expect((await deduct(id, { item_id: plainItem, position: null, qty: 1 }, techToken)).status).toBe(403);
    expect((await charge(id, { payment_method: 'เงินสด' }, techToken)).status).toBe(403);
    expect((await deduct(id, { item_id: plainItem, position: null, qty: 0 })).status).toBe(400);
    expect((await deduct(999999999, { item_id: plainItem, position: null, qty: 1 })).status).toBe(404);
    expect((await charge(999999999, { payment_method: 'เงินสด' })).status).toBe(404);
    expect((await parts(999999999)).status).toBe(404);
    expect((await deduct(id, { item_id: 999999999, position: null, qty: 1 })).status).toBe(404);
  });
});
