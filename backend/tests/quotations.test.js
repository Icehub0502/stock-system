const request = require('supertest');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { getOfficeToken, getTechnicianToken, createCustomerWithVehicle, cleanupCustomer } = require('./helpers');

const app = createApp();

describe('quotations.routes.js — office-only role gate', () => {
  let officeToken;
  let technicianToken;
  let fixture;
  let quotationId;

  beforeAll(async () => {
    officeToken = await getOfficeToken();
    technicianToken = await getTechnicianToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle({ namePrefix: 'Role Gate Test Customer' });
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${officeToken}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ทดสอบสิทธิ์', quantity: 1, unit_price: 100 }],
      });
    quotationId = createRes.body.quotation_id;
  });

  afterEach(async () => {
    await cleanupCustomer(fixture.customerId);
  });

  test('a technician token gets 403 on DELETE /quotations/:id', async () => {
    const res = await request(app)
      .delete(`/api/quotations/${quotationId}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send();
    expect(res.status).toBe(403);
  });

  test('a technician token gets 403 on PUT /quotations/:id', async () => {
    const res = await request(app)
      .put(`/api/quotations/${quotationId}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ทดสอบสิทธิ์', quantity: 1, unit_price: 200 }],
      });
    expect(res.status).toBe(403);
  });

  test('a technician token gets 403 on POST /quotations', async () => {
    const res = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ทดสอบสิทธิ์', quantity: 1, unit_price: 100 }],
      });
    expect(res.status).toBe(403);
  });

  test('requires authentication', async () => {
    const res = await request(app).delete(`/api/quotations/${quotationId}`).send();
    expect(res.status).toBe(401);
  });
});

describe('POST /api/quotations — concurrent creation does not produce duplicate quotation_no', () => {
  let token;
  let fixture;

  beforeAll(async () => {
    token = await getOfficeToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle({ namePrefix: 'Concurrency Test Customer' });
  });

  afterEach(async () => {
    await cleanupCustomer(fixture.customerId);
  });

  test('3 concurrent quotation creates all succeed with distinct quotation_no values', async () => {
    const send = () =>
      request(app)
        .post('/api/quotations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          customer_id: fixture.customerId,
          vehicle_id: fixture.vehicleId,
          quotation_date: '2026-07-10',
          items: [{ product_name: 'สินค้าทดสอบการชนกันของเลขที่เอกสาร', quantity: 1, unit_price: 100 }],
        });

    const results = await Promise.all([send(), send(), send()]);

    for (const res of results) {
      expect(res.status).toBe(201);
    }

    const quotationNos = results.map((r) => r.body.quotation_no);
    expect(new Set(quotationNos).size).toBe(quotationNos.length);
  });
});

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

  test('อนุมัติใบเสนอราคาที่ผูกกับงานซึ่งค้างสถานะ carout (เอารถลงไปหลังมัดจำ) → ต้องดันสถานะงานเป็น approved ให้ตามด้วย ไม่งั้นงานจะไม่ขึ้นหน้ารายการงานวันนี้อีกเลยทั้งที่อนุมัติ+ออกใบเสร็จไปแล้วจริง (บั๊กที่เจ้าของร้านแจ้ง — รถ Sonic มัดจำแล้วกลับมาทำต่อวันเดียวกัน)', async () => {
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'โช้คหลัง', quantity: 2, unit_price: 2500 }],
      });
    const quotationId = createRes.body.quotation_id;

    // จำลองงานที่เคยถูกส่งไป carout ตอนมัดจำ (ดู POST /jobs/:id/quotation/deposit)
    // — ลูกค้ากลับมาทำต่อวันเดียวกัน พนักงานเลยไปกดอนุมัติที่หน้าใบเสนอราคาแทนปุ่ม
    // อนุมัติที่หน้างาน (ซึ่งจะ sync สถานะงานให้เองอยู่แล้ว)
    const [jobResult] = await pool.execute(
      `INSERT INTO jobs (job_no, job_date, customer_id, vehicle_id, quotation_id, status, closed_at)
       VALUES (?, CURDATE(), ?, ?, ?, 'carout', NOW())`,
      [`TESTJOB-${Date.now()}`, fixture.customerId, fixture.vehicleId, quotationId]
    );
    const jobId = jobResult.insertId;

    const approveRes = await request(app)
      .patch(`/api/quotations/${quotationId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(approveRes.status).toBe(200);

    const [[jobAfter]] = await pool.query('SELECT status, closed_at, bay FROM jobs WHERE id = ?', [jobId]);
    expect(jobAfter.status).toBe('approved'); // ไม่ค้างเป็น carout อีกต่อไป — กลับมาขึ้นจอบอร์ดได้
    expect(jobAfter.closed_at).toBeNull();
    expect(jobAfter.bay).toBeNull();

    const [history] = await pool.query(
      "SELECT status FROM job_status_history WHERE job_id = ? AND status = 'approved'",
      [jobId]
    );
    expect(history.length).toBe(1);
  });

  test('อนุมัติใบเสนอราคาที่งานซ่อมไปไกลกว่า approved แล้ว (เช่น repairing) → ไม่ดึงสถานะงานถอยหลังกลับมา', async () => {
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ยางหุ้มเพลา', quantity: 1, unit_price: 400 }],
      });
    const quotationId = createRes.body.quotation_id;

    const [jobResult] = await pool.execute(
      `INSERT INTO jobs (job_no, job_date, customer_id, vehicle_id, quotation_id, status)
       VALUES (?, CURDATE(), ?, ?, ?, 'repairing')`,
      [`TESTJOB-${Date.now()}`, fixture.customerId, fixture.vehicleId, quotationId]
    );
    const jobId = jobResult.insertId;

    const approveRes = await request(app)
      .patch(`/api/quotations/${quotationId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(approveRes.status).toBe(200);

    const [[jobAfter]] = await pool.query('SELECT status FROM jobs WHERE id = ?', [jobId]);
    expect(jobAfter.status).toBe('repairing'); // ยังคงเดิม ไม่ถูกดึงกลับมาเป็น approved
  });
});

describe('PATCH /api/quotations/:id/undo-decline — พลาดกด "ลูกค้าไม่ได้ทำ" ดึงกลับเข้าคิว', () => {
  let token;
  let fixture;

  beforeAll(async () => {
    token = await getOfficeToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle({ namePrefix: 'Undo Decline Test Customer' });
  });

  afterEach(async () => {
    await cleanupCustomer(fixture.customerId);
  });

  test('ดึงใบที่ declined กลับเป็น pending และล้างเหตุผลที่บันทึกไว้', async () => {
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ผ้าเบรก', quantity: 1, unit_price: 800 }],
      });
    const quotationId = createRes.body.quotation_id;

    const declineRes = await request(app)
      .patch(`/api/quotations/${quotationId}/decline`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'price_high' });
    expect(declineRes.status).toBe(200);

    const undoRes = await request(app)
      .patch(`/api/quotations/${quotationId}/undo-decline`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(undoRes.status).toBe(200);

    const [[after]] = await pool.query(
      'SELECT status, decline_reason, decline_note FROM quotations WHERE id = ?',
      [quotationId]
    );
    expect(after.status).toBe('pending');
    expect(after.decline_reason).toBeNull();
    expect(after.decline_note).toBeNull();
  });

  test('ใบที่ไม่ได้อยู่ในสถานะ declined → ดึงกลับไม่ได้ (400)', async () => {
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ผ้าเบรก', quantity: 1, unit_price: 800 }],
      });
    const quotationId = createRes.body.quotation_id;

    const undoRes = await request(app)
      .patch(`/api/quotations/${quotationId}/undo-decline`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(undoRes.status).toBe(400);
  });

  test('มีงานที่ผูกอยู่ซึ่งถูกตั้งเป็น rejected คู่กัน (decline จากหน้าคิว) → ดึงงานกลับเป็นสถานะก่อนหน้า rejected ให้ขึ้นบอร์ดคิวอีกครั้ง', async () => {
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ยางหน้า', quantity: 2, unit_price: 1200 }],
      });
    const quotationId = createRes.body.quotation_id;

    await request(app)
      .patch(`/api/quotations/${quotationId}/decline`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'quote_only' });

    const [jobResult] = await pool.execute(
      `INSERT INTO jobs (job_no, job_date, customer_id, vehicle_id, quotation_id, status)
       VALUES (?, CURDATE(), ?, ?, ?, 'rejected')`,
      [`TESTJOB-${Date.now()}`, fixture.customerId, fixture.vehicleId, quotationId]
    );
    const jobId = jobResult.insertId;
    await pool.execute(
      "INSERT INTO job_status_history (job_id, status) VALUES (?, 'quoted'), (?, 'rejected')",
      [jobId, jobId]
    );

    const undoRes = await request(app)
      .patch(`/api/quotations/${quotationId}/undo-decline`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(undoRes.status).toBe(200);

    const [[jobAfter]] = await pool.query('SELECT status, closed_at FROM jobs WHERE id = ?', [jobId]);
    expect(jobAfter.status).toBe('quoted');
    expect(jobAfter.closed_at).toBeNull();
  });
});

describe('PATCH /api/quotations/:id/close — รับชำระเงิน/ปิดบิลจากหน้าเว็บโดยตรง', () => {
  let token;
  let fixture;

  beforeAll(async () => {
    token = await getOfficeToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle({ namePrefix: 'Close Bill Test Customer' });
  });

  afterEach(async () => {
    await cleanupCustomer(fixture.customerId);
  });

  test('ปิดบิลตั้ง closed_at ให้ใบเสนอราคาและอัปเดต payment_method/total_amount ของใบเสร็จ', async () => {
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ค่าแรง', quantity: 1, unit_price: 1000 }],
      });
    const quotationId = createRes.body.quotation_id;

    const approveRes = await request(app)
      .patch(`/api/quotations/${quotationId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(approveRes.status).toBe(200);

    const closeRes = await request(app)
      .patch(`/api/quotations/${quotationId}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ payment_method: 'เงินสด', paid_amount: 1000 });
    expect(closeRes.status).toBe(200);
    expect(Number(closeRes.body.total_amount)).toBe(1000);

    const [[quotationAfter]] = await pool.query('SELECT closed_at FROM quotations WHERE id = ?', [quotationId]);
    expect(quotationAfter.closed_at).toBeTruthy();

    const [[receipt]] = await pool.query(
      'SELECT payment_method, total_amount FROM receipts WHERE id = ?',
      [approveRes.body.receipt_id]
    );
    expect(receipt.payment_method).toBe('เงินสด');
    expect(Number(receipt.total_amount)).toBe(1000);
  });

  test('ไม่ใส่ยอดที่ได้รับจริงมา → fallback เป็นยอดรวมทั้งบิลเดิม', async () => {
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ค่าแรง', quantity: 1, unit_price: 2000 }],
      });
    const quotationId = createRes.body.quotation_id;
    await request(app).patch(`/api/quotations/${quotationId}/approve`).set('Authorization', `Bearer ${token}`).send();

    const closeRes = await request(app)
      .patch(`/api/quotations/${quotationId}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ payment_method: 'โอน' });
    expect(closeRes.status).toBe(200);
    expect(Number(closeRes.body.total_amount)).toBe(2000);
  });

  test('ยังไม่อนุมัติ/ไม่มีใบเสร็จ → ปิดบิลไม่ได้', async () => {
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ค่าแรง', quantity: 1, unit_price: 500 }],
      });
    const quotationId = createRes.body.quotation_id;

    const closeRes = await request(app)
      .patch(`/api/quotations/${quotationId}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ payment_method: 'เงินสด' });
    expect(closeRes.status).toBe(400);
  });

  test('ปิดบิลไปแล้ว ปิดซ้ำไม่ได้', async () => {
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ค่าแรง', quantity: 1, unit_price: 500 }],
      });
    const quotationId = createRes.body.quotation_id;
    await request(app).patch(`/api/quotations/${quotationId}/approve`).set('Authorization', `Bearer ${token}`).send();
    await request(app).patch(`/api/quotations/${quotationId}/close`).set('Authorization', `Bearer ${token}`).send({ payment_method: 'เงินสด' });

    const secondClose = await request(app)
      .patch(`/api/quotations/${quotationId}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({ payment_method: 'เงินสด' });
    expect(secondClose.status).toBe(400);
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

// เจ้าของร้านเจอปัญหาจริง: ใส่มัดจำผ่านฟอร์ม "แก้ไข" ธรรมดา (ไม่ใช่ปุ่ม "วันที่") ตอน
// ใบยังเป็น pending เฉยๆ — มัดจำถูกบันทึกแต่สถานะไม่ขยับ ใบเลยไม่โผล่หน้า "ลูกค้าที่
// นัดหมาย" เลยทั้งที่มีมัดจำจริง
describe('PUT /api/quotations/:id — ใส่มัดจำเข้ามาใหม่ตอนใบยัง pending → ดันสถานะเป็น no_date ให้เอง', () => {
  let token;
  let fixture;

  beforeAll(async () => {
    token = await getOfficeToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle({ namePrefix: 'PUT Deposit Status Test Customer' });
  });

  afterEach(async () => {
    await cleanupCustomer(fixture.customerId);
  });

  test('ใบ pending ไม่มีมัดจำ แก้ไขใส่มัดจำเข้ามาใหม่ → สถานะเปลี่ยนเป็น no_date อัตโนมัติ', async () => {
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ทดสอบ', quantity: 1, unit_price: 1000 }],
      });
    const quotationId = createRes.body.quotation_id;

    const editRes = await request(app)
      .put(`/api/quotations/${quotationId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ทดสอบ', quantity: 1, unit_price: 1000 }],
        deposit_amount: 500,
        deposit_date: '2026-07-10',
      });
    expect(editRes.status).toBe(200);

    const [[row]] = await pool.query('SELECT status FROM quotations WHERE id = ?', [quotationId]);
    expect(row.status).toBe('no_date');
  });

  test('ใบที่อนุมัติไปแล้ว แก้ไขใส่มัดจำเข้ามา → ไม่แตะสถานะ ยัง approved เหมือนเดิม', async () => {
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ทดสอบ', quantity: 1, unit_price: 1000 }],
      });
    const quotationId = createRes.body.quotation_id;
    await request(app).patch(`/api/quotations/${quotationId}/approve`).set('Authorization', `Bearer ${token}`).send();

    const editRes = await request(app)
      .put(`/api/quotations/${quotationId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ทดสอบ', quantity: 1, unit_price: 1000 }],
        deposit_amount: 500,
        deposit_date: '2026-07-10',
      });
    expect(editRes.status).toBe(200);

    const [[row]] = await pool.query('SELECT status FROM quotations WHERE id = ?', [quotationId]);
    expect(row.status).toBe('approved');
  });
});

// มัดจำ (deposit_amount/deposit_date) เป็นฟิลด์ first-class ของใบเสนอราคาแล้ว (บอทไลน์
// เป็นคนตั้งค่าให้ตอนนี้ — ฟอร์มเว็บยังไม่มีช่องกรอกเอง เป็นงานถัดไป) ต้อง snapshot
// ไหลลงใบเสร็จที่จุดเดียวกับ remark/mileage เสมอ (approve-insert และ PUT-triggered sync)
describe('deposit_amount/deposit_date ไหลจากใบเสนอราคาลงใบเสร็จ (approve + PUT sync)', () => {
  let token;
  let fixture;

  beforeAll(async () => {
    token = await getOfficeToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle({ namePrefix: 'Deposit Snapshot Test Customer' });
  });

  afterEach(async () => {
    await cleanupCustomer(fixture.customerId);
  });
  // pool.end() ย้ายไปอยู่ที่ describe บล็อกสุดท้ายของไฟล์นี้แทน (ดูด้านล่าง) —
  // เรียกที่นี่จะปิด pool ก่อน describe บล็อกถัดไปในไฟล์เดียวกันได้ทำงานเสร็จ

  test('อนุมัติใบเสนอราคาที่มีมัดจำอยู่แล้ว (ตั้งไว้ก่อนจากบอทไลน์) → ใบเสร็จที่สร้างมี deposit_amount/deposit_date ตรงกัน', async () => {
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ผ้าเบรค', quantity: 1, unit_price: 1800 }],
      });
    const quotationId = createRes.body.quotation_id;

    // จำลองมัดจำที่บอทไลน์ตั้งไว้ก่อนหน้า (ฟอร์มเว็บยังไม่มีช่องกรอกเอง)
    await pool.query(
      'UPDATE quotations SET deposit_amount = ?, deposit_date = ? WHERE id = ?',
      [500, '2026-07-05', quotationId]
    );

    const approveRes = await request(app)
      .patch(`/api/quotations/${quotationId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(approveRes.status).toBe(200);

    const [[receipt]] = await pool.query(
      'SELECT deposit_amount, deposit_date, total_amount FROM receipts WHERE id = ?',
      [approveRes.body.receipt_id]
    );
    expect(Number(receipt.deposit_amount)).toBe(500);
    expect(new Date(receipt.deposit_date).toISOString().slice(0, 10)).toBe('2026-07-05');
    expect(Number(receipt.total_amount)).toBe(1800); // มัดจำไม่ลดยอดใบเสร็จ — แค่ข้อมูลติดตาม
  });

  test('แก้ไขใบเสนอราคาที่อนุมัติแล้วผ่าน PUT (ฟอร์มยังไม่มีช่องมัดจำ) → มัดจำเดิมในใบเสร็จยังอยู่ ไม่ถูกล้างทิ้ง', async () => {
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ผ้าเบรค', quantity: 1, unit_price: 1800 }],
      });
    const quotationId = createRes.body.quotation_id;

    await pool.query(
      'UPDATE quotations SET deposit_amount = ?, deposit_date = ? WHERE id = ?',
      [500, '2026-07-05', quotationId]
    );

    const approveRes = await request(app)
      .patch(`/api/quotations/${quotationId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    const receiptId = approveRes.body.receipt_id;

    // แก้ไขรายการผ่านฟอร์มเว็บ (ไม่มีช่องมัดจำให้กรอก — body ไม่มี deposit_amount เลย)
    const editRes = await request(app)
      .put(`/api/quotations/${quotationId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ผ้าเบรค', quantity: 2, unit_price: 1800 }],
      });
    expect(editRes.status).toBe(200);
    expect(editRes.body.synced_receipt).toBe(true);

    const [[receipt]] = await pool.query(
      'SELECT deposit_amount, deposit_date, total_amount FROM receipts WHERE id = ?',
      [receiptId]
    );
    expect(Number(receipt.deposit_amount)).toBe(500); // ยังอยู่ ไม่หายไปตอนแก้ไขฟิลด์อื่น
    expect(new Date(receipt.deposit_date).toISOString().slice(0, 10)).toBe('2026-07-05');
    expect(Number(receipt.total_amount)).toBe(3600);
  });
});

// gap-fill: POST /quotations และ PUT /quotations/:id ตอนนี้รับ deposit_amount/
// deposit_date จาก body โดยตรงแล้ว (เดิมรับแค่จากบอทไลน์เท่านั้น — ดู describe
// ด้านบน) ให้หน้าเว็บกรอกมัดจำเองได้ผ่านฟอร์มปกติ — loose validation: ว่าง/ไม่ส่งมา
// = NULL, มีค่า = แปลงเป็นตัวเลข
describe('POST/PUT /quotations — deposit_amount/deposit_date รับค่าจาก body ได้โดยตรง', () => {
  let token;
  let fixture;

  beforeAll(async () => {
    token = await getOfficeToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle({ namePrefix: 'Deposit Gap-fill Test Customer' });
  });

  afterEach(async () => {
    await cleanupCustomer(fixture.customerId);
  });

  test('POST /quotations พร้อม deposit_amount/deposit_date → บันทึกลง DB ตรงกัน', async () => {
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ผ้าเบรค', quantity: 1, unit_price: 1800 }],
        deposit_amount: 700,
        deposit_date: '2026-07-08',
      });
    expect(createRes.status).toBe(201);

    const [[row]] = await pool.query(
      'SELECT deposit_amount, deposit_date FROM quotations WHERE id = ?',
      [createRes.body.quotation_id]
    );
    expect(Number(row.deposit_amount)).toBe(700);
    expect(new Date(row.deposit_date).toISOString().slice(0, 10)).toBe('2026-07-08');
  });

  test('POST /quotations ไม่ส่ง deposit_amount/deposit_date มา → เป็น NULL (ไม่บังคับกรอก)', async () => {
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ผ้าเบรค', quantity: 1, unit_price: 1800 }],
      });
    expect(createRes.status).toBe(201);

    const [[row]] = await pool.query(
      'SELECT deposit_amount, deposit_date FROM quotations WHERE id = ?',
      [createRes.body.quotation_id]
    );
    expect(row.deposit_amount).toBeNull();
    expect(row.deposit_date).toBeNull();
  });

  test('PUT /quotations/:id พร้อม deposit_amount/deposit_date → อัปเดตค่าใหม่ลง DB ตรงกัน', async () => {
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ผ้าเบรค', quantity: 1, unit_price: 1800 }],
        deposit_amount: 700,
        deposit_date: '2026-07-08',
      });
    const quotationId = createRes.body.quotation_id;

    const editRes = await request(app)
      .put(`/api/quotations/${quotationId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ผ้าเบรค', quantity: 1, unit_price: 1800 }],
        deposit_amount: 1200,
        deposit_date: '2026-07-09',
      });
    expect(editRes.status).toBe(200);

    const [[row]] = await pool.query(
      'SELECT deposit_amount, deposit_date FROM quotations WHERE id = ?',
      [quotationId]
    );
    expect(Number(row.deposit_amount)).toBe(1200);
    expect(new Date(row.deposit_date).toISOString().slice(0, 10)).toBe('2026-07-09');
  });
});

// เจ้าของร้านขอ: ปุ่ม "วันที่" (ตั้งวันนัด) ที่หน้าใบเสนอราคา/หน้านัดหมาย ควรใส่มัดจำ
// พร้อมกันได้เลยในขั้นตอนเดียว ไม่ต้องแยกไปกด "แก้ไข" อีกที (ก่อนหน้านี้ลืมทำแล้ว
// มัดจำไม่ถูกบันทึกไปเลยทั้งที่ตั้งวันนัดแล้ว) — ดู ScheduleDateDialog.jsx
describe('PATCH /quotations/:id/schedule และ /no-date — ใส่มัดจำพร้อมกับตั้งวันนัดได้ในคำขอเดียว', () => {
  let token;
  let fixture;
  let quotationId;

  beforeAll(async () => {
    token = await getOfficeToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle({ namePrefix: 'Schedule Deposit Test Customer' });
    const createRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ทดสอบ', quantity: 1, unit_price: 1000 }],
      });
    quotationId = createRes.body.quotation_id;
  });

  afterEach(async () => {
    await cleanupCustomer(fixture.customerId);
  });

  afterAll(async () => {
    await pool.end();
  });

  test('/schedule พร้อม deposit_amount/deposit_date → ตั้งวันนัดและมัดจำพร้อมกัน', async () => {
    const res = await request(app)
      .patch(`/api/quotations/${quotationId}/schedule`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scheduled_date: '2026-08-01', deposit_amount: 500, deposit_date: '2026-07-11' });
    expect(res.status).toBe(200);

    const [[row]] = await pool.query(
      'SELECT status, scheduled_date, deposit_amount, deposit_date FROM quotations WHERE id = ?',
      [quotationId]
    );
    expect(row.status).toBe('scheduled');
    expect(Number(row.deposit_amount)).toBe(500);
  });

  test('/schedule ไม่ส่งมัดจำมา → ไม่ล้างมัดจำเดิมทิ้ง (COALESCE เก็บของเดิมไว้)', async () => {
    await pool.execute('UPDATE quotations SET deposit_amount = 999, deposit_date = "2026-07-01" WHERE id = ?', [quotationId]);

    const res = await request(app)
      .patch(`/api/quotations/${quotationId}/schedule`)
      .set('Authorization', `Bearer ${token}`)
      .send({ scheduled_date: '2026-08-01' });
    expect(res.status).toBe(200);

    const [[row]] = await pool.query('SELECT deposit_amount FROM quotations WHERE id = ?', [quotationId]);
    expect(Number(row.deposit_amount)).toBe(999);
  });

  test('/no-date พร้อม deposit_amount/deposit_date → ตั้งสถานะ no_date และมัดจำพร้อมกัน', async () => {
    const res = await request(app)
      .patch(`/api/quotations/${quotationId}/no-date`)
      .set('Authorization', `Bearer ${token}`)
      .send({ deposit_amount: 700, deposit_date: '2026-07-12' });
    expect(res.status).toBe(200);

    const [[row]] = await pool.query(
      'SELECT status, scheduled_date, deposit_amount FROM quotations WHERE id = ?',
      [quotationId]
    );
    expect(row.status).toBe('no_date');
    expect(row.scheduled_date).toBeNull();
    expect(Number(row.deposit_amount)).toBe(700);
  });
});
