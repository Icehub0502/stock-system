const request = require('supertest');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { getOfficeToken, createCustomerWithVehicle, cleanupCustomer } = require('./helpers');

const app = createApp();

describe('PATCH /api/quotations/:id/approve — auto-creates a matching receipt', () => {
  let token;
  let fixture;

  beforeAll(async () => {
    token = await getOfficeToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle({ namePrefix: 'Quotation Test Customer' });
  });

  afterEach(async () => {
    await cleanupCustomer(fixture.customerId);
  });

  test('approving a quotation creates a receipt whose total matches the quotation total', async () => {
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [
          { product_name: 'แร็คพวงมาลัย', quantity: 1, unit_price: 4500 },
          { product_name: 'ลูกหมากคันชัก', quantity: 2, unit_price: 650 },
        ],
      });
    expect(createRes.status).toBe(201);
    const quotationId = createRes.body.quotation_id;
    expect(quotationId).toBeTruthy();

    const [[quotationBefore]] = await pool.query(
      'SELECT total_amount, status FROM quotations WHERE id = ?',
      [quotationId]
    );
    // 1*4500 + 2*650 = 5800
    expect(Number(quotationBefore.total_amount)).toBe(5800);
    expect(quotationBefore.status).toBe('pending');

    const approveRes = await request(app)
      .patch(`/api/quotations/${quotationId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.receipt_id).toBeTruthy();

    const [[quotationAfter]] = await pool.query(
      'SELECT status, converted_receipt_id FROM quotations WHERE id = ?',
      [quotationId]
    );
    expect(quotationAfter.status).toBe('approved');
    expect(quotationAfter.converted_receipt_id).toBe(approveRes.body.receipt_id);

    const [[receipt]] = await pool.query(
      'SELECT total_amount FROM receipts WHERE id = ?',
      [approveRes.body.receipt_id]
    );
    expect(Number(receipt.total_amount)).toBe(5800);
  });

  test('approving the same quotation twice does not create a second receipt', async () => {
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'บูช', quantity: 1, unit_price: 300 }],
      });
    const quotationId = createRes.body.quotation_id;

    const first = await request(app)
      .patch(`/api/quotations/${quotationId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(first.status).toBe(200);

    const second = await request(app)
      .patch(`/api/quotations/${quotationId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(second.status).toBe(400);

    const [receipts] = await pool.query(
      'SELECT id FROM receipts WHERE customer_id = ?',
      [fixture.customerId]
    );
    expect(receipts.length).toBe(1);
  });
});

describe('PUT /api/quotations/:id — editing an approved quotation syncs its receipt', () => {
  let token;
  let fixture;

  beforeAll(async () => {
    token = await getOfficeToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle({ namePrefix: 'Quotation Sync Test Customer' });
  });

  afterEach(async () => {
    await cleanupCustomer(fixture.customerId);
  });

  afterAll(async () => {
    await pool.end();
  });

  test('editing items/remark on an already-approved quotation updates its linked receipt to match', async () => {
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ลูกหมากปลาย', quantity: 1, unit_price: 1000 }],
      });
    const quotationId = createRes.body.quotation_id;

    const approveRes = await request(app)
      .patch(`/api/quotations/${quotationId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    const receiptId = approveRes.body.receipt_id;

    const editRes = await request(app)
      .put(`/api/quotations/${quotationId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        remark: 'แก้ไขหลังอนุมัติแล้ว',
        items: [{ product_name: 'ลูกหมากปลาย', quantity: 2, unit_price: 1200 }],
      });
    expect(editRes.status).toBe(200);
    expect(editRes.body.synced_receipt).toBe(true);

    const [[receipt]] = await pool.query(
      'SELECT total_amount, remark FROM receipts WHERE id = ?',
      [receiptId]
    );
    // 2 * 1200 = 2400 — receipt must reflect the edited quotation, not the original
    expect(Number(receipt.total_amount)).toBe(2400);
    expect(receipt.remark).toBe('แก้ไขหลังอนุมัติแล้ว');

    const [receiptItems] = await pool.query(
      'SELECT product_name_snapshot, qty, price FROM receipt_items WHERE receipt_id = ?',
      [receiptId]
    );
    expect(receiptItems).toHaveLength(1);
    expect(receiptItems[0].product_name_snapshot).toBe('ลูกหมากปลาย');
    expect(Number(receiptItems[0].qty)).toBe(2);
    expect(Number(receiptItems[0].price)).toBe(1200);
  });

  test('editing a still-pending (not yet approved) quotation does not touch any receipt', async () => {
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ยางกันฝุ่น', quantity: 1, unit_price: 200 }],
      });
    const quotationId = createRes.body.quotation_id;

    const editRes = await request(app)
      .put(`/api/quotations/${quotationId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ยางกันฝุ่น', quantity: 1, unit_price: 300 }],
      });
    expect(editRes.status).toBe(200);
    expect(editRes.body.synced_receipt).toBe(false);

    const [receipts] = await pool.query(
      'SELECT id FROM receipts WHERE customer_id = ?',
      [fixture.customerId]
    );
    expect(receipts).toHaveLength(0);
  });
});
