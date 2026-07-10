const request = require('supertest');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { getOfficeToken, createCustomerWithVehicle, cleanupCustomer } = require('./helpers');

const app = createApp();

describe('POST /api/receipts — total calculation', () => {
  let token;
  let fixture;

  beforeAll(async () => {
    token = await getOfficeToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle();
  });

  afterEach(async () => {
    await cleanupCustomer(fixture.customerId);
  });

  afterAll(async () => {
    await pool.end();
  });

  test('sums qty * price across all line items into total_amount', async () => {
    const res = await request(app)
      .post('/api/receipts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        receipt_date: '2026-07-10',
        mileage: 12345,
        items: [
          { product_name_snapshot: 'โช๊คหลัง KYB', qty: 2, price: 1500 },
          { product_name_snapshot: 'ลูกหมากปีกนกล่าง', qty: 1, price: 850 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const [[receipt]] = await pool.query('SELECT total_amount FROM receipts WHERE id = ?', [res.body.receipt_id]);
    // 2*1500 + 1*850 = 3850
    expect(Number(receipt.total_amount)).toBe(3850);
  });

  test('a discount line item (negative price) reduces the total correctly', async () => {
    const res = await request(app)
      .post('/api/receipts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        receipt_date: '2026-07-10',
        mileage: 0,
        items: [
          { product_name_snapshot: 'ยางกันโคลงหน้า', qty: 1, price: 1000 },
          { product_name_snapshot: 'ส่วนลดค่าแรง', qty: 1, price: -200 },
        ],
      });

    expect(res.status).toBe(201);
    const [[receipt]] = await pool.query('SELECT total_amount FROM receipts WHERE id = ?', [res.body.receipt_id]);
    expect(Number(receipt.total_amount)).toBe(800);
  });

  test('rejects a receipt with no valid items instead of silently creating an empty/zero-total one', async () => {
    const res = await request(app)
      .post('/api/receipts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        receipt_date: '2026-07-10',
        mileage: 0,
        items: [{ product_name_snapshot: '', qty: 0, price: '' }],
      });

    expect(res.status).toBe(400);
  });

  test('requires authentication', async () => {
    const res = await request(app)
      .post('/api/receipts')
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        receipt_date: '2026-07-10',
        items: [{ product_name_snapshot: 'X', qty: 1, price: 100 }],
      });

    expect(res.status).toBe(401);
  });
});
