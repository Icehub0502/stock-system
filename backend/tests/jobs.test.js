const request = require('supertest');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { getOfficeToken, createCustomerWithVehicle, cleanupCustomer } = require('./helpers');

const app = createApp();

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe('POST /api/jobs — auto-links a matching pending LINE quotation', () => {
  let token;
  let fixture;

  beforeAll(async () => {
    token = await getOfficeToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle({ namePrefix: 'Auto-link Test Customer' });
  });

  afterEach(async () => {
    await cleanupCustomer(fixture.customerId);
  });

  test('a same-day pending quotation for the same customer/vehicle gets linked instead of creating a duplicate', async () => {
    // จำลองใบเสนอราคาว่างที่บอทไลน์สร้างไว้ก่อนลูกค้าจะมาถึงร้าน
    const [quoteResult] = await pool.execute(
      `INSERT INTO quotations (quotation_no, quotation_date, customer_id, vehicle_id, total_amount, status)
       VALUES (?, ?, ?, ?, 0, 'pending')`,
      [`IV-TEST-${Date.now()}`, todayStr(), fixture.customerId, fixture.vehicleId]
    );
    const pendingQuotationId = quoteResult.insertId;

    const createRes = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        vehicle_id: fixture.vehicleId,
        customer_id: fixture.customerId,
        job_date: todayStr(),
        symptom: 'ทดสอบออโต้ลิงก์',
      });
    expect(createRes.status).toBe(201);

    const [[job]] = await pool.query('SELECT quotation_id FROM jobs WHERE id = ?', [createRes.body.id]);
    expect(job.quotation_id).toBe(pendingQuotationId);

    const [quotations] = await pool.query(
      'SELECT id FROM quotations WHERE customer_id = ? AND vehicle_id = ?',
      [fixture.customerId, fixture.vehicleId]
    );
    // ต้องมีใบเสนอราคาใบเดียว (ใบเดิมที่ผูกไว้) ไม่มีใบใหม่ถูกสร้างซ้อน
    expect(quotations).toHaveLength(1);

    await pool.execute('DELETE FROM jobs WHERE id = ?', [createRes.body.id]);
  });

  test('a pending quotation from a different day is left alone (not linked)', async () => {
    await pool.execute(
      `INSERT INTO quotations (quotation_no, quotation_date, customer_id, vehicle_id, total_amount, status)
       VALUES (?, '2020-01-01', ?, ?, 0, 'pending')`,
      [`IV-TEST-${Date.now()}`, fixture.customerId, fixture.vehicleId]
    );

    const createRes = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        vehicle_id: fixture.vehicleId,
        customer_id: fixture.customerId,
        job_date: todayStr(),
        symptom: 'ทดสอบไม่ลิงก์ข้ามวัน',
      });
    expect(createRes.status).toBe(201);

    const [[job]] = await pool.query('SELECT quotation_id FROM jobs WHERE id = ?', [createRes.body.id]);
    expect(job.quotation_id).toBeNull();

    await pool.execute('DELETE FROM jobs WHERE id = ?', [createRes.body.id]);
  });
});

describe('PATCH /api/jobs/:id/quote-draft* — concurrent draft/signature writes do not clobber each other', () => {
  let token;
  let fixture;
  let jobId;

  beforeAll(async () => {
    token = await getOfficeToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle({ namePrefix: 'Quote Draft Race Test Customer' });
    const createRes = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicle_id: fixture.vehicleId, customer_id: fixture.customerId, job_date: todayStr() });
    jobId = createRes.body.id;
  });

  afterEach(async () => {
    await pool.execute('DELETE FROM jobs WHERE id = ?', [jobId]);
    await cleanupCustomer(fixture.customerId);
  });

  test('saving items and saving a customer signature at the same time both survive', async () => {
    const savedItems = request(app)
      .patch(`/api/jobs/${jobId}/quote-draft`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ product_name: 'ลูกหมากปลาย', quantity: 1, unit_price: 500 }] });

    const savedSignature = request(app)
      .patch(`/api/jobs/${jobId}/quote-draft/signature`)
      .set('Authorization', `Bearer ${token}`)
      .send({ signature: 'data:image/png;base64,iVBORw0KGgo=' });

    const [itemsRes, signatureRes] = await Promise.all([savedItems, savedSignature]);
    expect(itemsRes.status).toBe(200);
    expect(signatureRes.status).toBe(200);

    const [[job]] = await pool.query('SELECT quote_draft FROM jobs WHERE id = ?', [jobId]);
    const draft = JSON.parse(job.quote_draft);
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0].product_name).toBe('ลูกหมากปลาย');
    expect(draft.customer_signature).toBe('data:image/png;base64,iVBORw0KGgo=');
  });
});

describe('DELETE /api/jobs/:id — blocked once the linked quotation is approved with a receipt', () => {
  let token;
  let fixture;
  let jobId;

  beforeAll(async () => {
    token = await getOfficeToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle({ namePrefix: 'Delete Guard Test Customer' });
    const createRes = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicle_id: fixture.vehicleId, customer_id: fixture.customerId, job_date: todayStr() });
    jobId = createRes.body.id;
  });

  afterEach(async () => {
    await pool.execute('DELETE FROM jobs WHERE id = ?', [jobId]);
    await cleanupCustomer(fixture.customerId);
  });

  test('a job with an approved quotation + receipt cannot be deleted', async () => {
    await request(app)
      .patch(`/api/jobs/${jobId}/quote-draft`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ product_name: 'ค่าแรง', quantity: 1, unit_price: 300 }] });

    const approveRes = await request(app)
      .post(`/api/jobs/${jobId}/quotation/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(approveRes.status).toBe(200);

    const deleteRes = await request(app)
      .delete(`/api/jobs/${jobId}`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(deleteRes.status).toBe(409);

    const [[job]] = await pool.query('SELECT id FROM jobs WHERE id = ?', [jobId]);
    expect(job).toBeTruthy();

    // เคลียร์ receipt/quotation ที่ approve สร้างไว้เอง เพราะ cleanupCustomer ลบแค่
    // รายการที่ยัง customer_id ตรงอยู่ (job นี้จะถูกลบทิ้งใน afterEach แทน DELETE endpoint)
    const [[jobRow]] = await pool.query('SELECT quotation_id FROM jobs WHERE id = ?', [jobId]);
    const [[quotation]] = await pool.query('SELECT converted_receipt_id FROM quotations WHERE id = ?', [jobRow.quotation_id]);
    if (quotation?.converted_receipt_id) {
      await pool.execute('DELETE FROM receipt_items WHERE receipt_id = ?', [quotation.converted_receipt_id]);
      await pool.execute('DELETE FROM receipts WHERE id = ?', [quotation.converted_receipt_id]);
    }
    await pool.execute('DELETE FROM quotation_items WHERE quotation_id = ?', [jobRow.quotation_id]);
    await pool.execute('UPDATE jobs SET quotation_id = NULL WHERE id = ?', [jobId]);
    await pool.execute('DELETE FROM quotations WHERE id = ?', [jobRow.quotation_id]);
  });
});

describe('POST /api/jobs/:id/part-photos — concurrent uploads do not collide on sort_order', () => {
  let token;
  let fixture;
  let jobId;

  beforeAll(async () => {
    token = await getOfficeToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle({ namePrefix: 'Part Photo Race Test Customer' });
    const createRes = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicle_id: fixture.vehicleId, customer_id: fixture.customerId, job_date: todayStr() });
    jobId = createRes.body.id;
    // รูปอะไหล่เพิ่มได้เฉพาะงานที่ผ่านจุดอนุมัติแล้ว (ดู PART_PHOTO_ALLOWED_STATUSES)
    await pool.execute("UPDATE jobs SET status = 'approved' WHERE id = ?", [jobId]);
  });

  afterEach(async () => {
    await pool.execute('DELETE FROM jobs WHERE id = ?', [jobId]);
    await cleanupCustomer(fixture.customerId);
  });

  test('3 concurrent single-photo uploads get 3 distinct, gapless sort_order values', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const upload = () =>
      request(app)
        .post(`/api/jobs/${jobId}/part-photos`)
        .set('Authorization', `Bearer ${token}`)
        .send({ photos: [png] });

    const results = await Promise.all([upload(), upload(), upload()]);
    for (const res of results) {
      expect(res.status).toBe(201);
    }

    const [rows] = await pool.query(
      "SELECT sort_order FROM job_photos WHERE job_id = ? AND photo_type = 'part' ORDER BY sort_order",
      [jobId]
    );
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1, 2]);
  });
});

afterAll(async () => {
  await pool.end();
});
