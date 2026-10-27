const request = require('supertest');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { getManagerToken, createCustomerWithVehicle, cleanupCustomer } = require('./helpers');
const { parseSplitsFromText, normalizePaymentMethod } = require('../src/utils/paymentMethods');

const app = createApp();

afterAll(async () => {
  await pool.end();
});

describe('payment text parsing', () => {
  test('หลายช่องทางพร้อมยอด', () => {
    expect(parseSplitsFromText('เงินสด 5000 + บัตรเครดิต 5,000')).toEqual([
      { method: 'เงินสด', amount: 5000 },
      { method: 'บัตรเครดิต', amount: 5000 },
    ]);
  });

  test('ช่องทางเดียว/ชื่อไม่รู้จัก → ไม่ใช่การแบ่ง', () => {
    expect(parseSplitsFromText('เงินสด')).toEqual([]);
    expect(parseSplitsFromText('เงินสด 500 + โอน 500')).toEqual([]);
  });

  test('normalize คงยอดและชื่อมาตรฐาน', () => {
    expect(normalizePaymentMethod('cash 300 และ jpm')).toBe('เงินสด 300 + JPM');
    expect(normalizePaymentMethod('gsb')).toBe('ออมสิน');
  });
});

describe('PATCH /api/receipts/:id/meta — payment_splits', () => {
  let token;
  let fixture;
  let receiptId;
  const date = '2026-06-15';

  beforeAll(async () => {
    token = await getManagerToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle();
    const res = await request(app)
      .post('/api/receipts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        receipt_date: date,
        mileage: 1000,
        items: [{ product_name_snapshot: 'ค่าแรง', qty: 1, price: 1000 }],
      });
    receiptId = res.body.receipt_id || res.body.id;
  });

  afterEach(async () => {
    await cleanupCustomer(fixture.customerId);
  });

  const patch = (body) => request(app)
    .patch(`/api/receipts/${receiptId}/meta`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

  test('ยอดแบ่งไม่เท่ายอดบิล → 400 และไม่บันทึก', async () => {
    const res = await patch({
      payment_method: '',
      payment_splits: [{ method: 'เงินสด', amount: 400 }, { method: 'บัตรเครดิต', amount: 400 }],
    });
    expect(res.status).toBe(400);
    const [rows] = await pool.query('SELECT 1 FROM receipt_payments WHERE receipt_id = ?', [receiptId]);
    expect(rows).toHaveLength(0);
  });

  test('ช่องทางที่ไม่รู้จัก/ซ้ำ → 400', async () => {
    expect((await patch({ payment_splits: [{ method: 'โอน', amount: 500 }, { method: 'เงินสด', amount: 500 }] })).status).toBe(400);
    expect((await patch({ payment_splits: [{ method: 'เงินสด', amount: 500 }, { method: 'เงินสด', amount: 500 }] })).status).toBe(400);
  });

  test('แบ่งสองช่องทางสำเร็จ — by-date และสรุปรายวันนับตามที่แบ่ง', async () => {
    const res = await patch({
      payment_splits: [{ method: 'เงินสด', amount: 600 }, { method: 'บัตรเครดิต' }],
    });
    expect(res.status).toBe(200);

    const byDate = await request(app).get('/api/receipts/by-date').query({ date }).set('Authorization', `Bearer ${token}`);
    const row = byDate.body.data.find((r) => r.id === receiptId);
    expect(row.payments).toEqual([
      { method: 'เงินสด', amount: 600 },
      { method: 'บัตรเครดิต', amount: 400 },
    ]);
    expect(row.payment_method).toBe('เงินสด 600 + บัตรเครดิต 400');

    const daily = await request(app).get('/api/receipts/daily-summary').set('Authorization', `Bearer ${token}`);
    const day = daily.body.data.find((d) => String(d.date).slice(0, 10) === date);
    expect(day.by_method['เงินสด'].total).toBeGreaterThanOrEqual(600);
    expect(day.by_method['บัตรเครดิต'].total).toBeGreaterThanOrEqual(400);
  });

  test('แก้ยอดบิลโดยไม่แก้การแบ่ง → 400 แต่ส่งการแบ่งใหม่มาพร้อมกันได้', async () => {
    await patch({ payment_splits: [{ method: 'เงินสด', amount: 500 }, { method: 'คลิก', amount: 500 }] });
    const bad = await patch({ payment_method: 'เงินสด 500 + คลิก 500', total_amount: 1200 });
    expect(bad.status).toBe(400);
    const ok = await patch({
      total_amount: 1200,
      payment_splits: [{ method: 'เงินสด', amount: 700 }, { method: 'คลิก', amount: 500 }],
    });
    expect(ok.status).toBe(200);
  });

  test('ส่งช่องทางเดียวกลับมา → ล้างการแบ่งเดิม', async () => {
    await patch({ payment_splits: [{ method: 'เงินสด', amount: 500 }, { method: 'คลิก', amount: 500 }] });
    const res = await patch({ payment_method: 'ออมสิน', payment_splits: [] });
    expect(res.status).toBe(200);
    const [rows] = await pool.query('SELECT 1 FROM receipt_payments WHERE receipt_id = ?', [receiptId]);
    expect(rows).toHaveLength(0);
    const [[r]] = await pool.query('SELECT payment_method FROM receipts WHERE id = ?', [receiptId]);
    expect(r.payment_method).toBe('ออมสิน');
  });
});

describe('PATCH /api/quotations/:id/close — payment_splits', () => {
  let token;
  let fixture;
  let quotationId;

  beforeAll(async () => {
    token = await getManagerToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle();
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ค่าแรง', quantity: 1, unit_price: 3000 }],
      });
    quotationId = createRes.body.quotation_id;
    await request(app).patch(`/api/quotations/${quotationId}/approve`).set('Authorization', `Bearer ${token}`).send();
  });

  afterEach(async () => {
    await cleanupCustomer(fixture.customerId);
  });

  const close = (body) => request(app)
    .patch(`/api/quotations/${quotationId}/close`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

  test('ยอดแบ่งไม่เท่ายอดที่รับ → 400 และบิลยังไม่ปิด', async () => {
    const res = await close({
      paid_amount: 3000,
      payment_splits: [{ method: 'เงินสด', amount: 1000 }, { method: 'JPM', amount: 1000 }],
    });
    expect(res.status).toBe(400);
    const [[q]] = await pool.query('SELECT closed_at FROM quotations WHERE id = ?', [quotationId]);
    expect(q.closed_at).toBeNull();
  });

  test('ปิดบิลด้วยสองช่องทางสำเร็จ', async () => {
    const res = await close({
      paid_amount: 3000,
      payment_splits: [{ method: 'เงินสด', amount: 1500 }, { method: 'บัตรเครดิต', amount: 1500 }],
    });
    expect(res.status).toBe(200);
    const [[q]] = await pool.query('SELECT converted_receipt_id FROM quotations WHERE id = ?', [quotationId]);
    const [rows] = await pool.query('SELECT method, amount FROM receipt_payments WHERE receipt_id = ? ORDER BY id', [q.converted_receipt_id]);
    expect(rows.map((r) => [r.method, Number(r.amount)])).toEqual([['เงินสด', 1500], ['บัตรเครดิต', 1500]]);
  });
});
