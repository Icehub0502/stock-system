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

  afterAll(async () => {
    await pool.end();
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
