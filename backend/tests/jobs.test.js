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

describe('POST /api/jobs — รูปตอนสร้างงาน รองรับทั้ง {full, thumb} และ string เดิม', () => {
  let token;
  let fixture;

  beforeAll(async () => {
    token = await getOfficeToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle({ namePrefix: 'Create Job Photo Test Customer' });
  });

  afterEach(async () => {
    await cleanupCustomer(fixture.customerId);
  });

  test('ส่งรูปแบบ {full, thumb} ตอนสร้างงาน → เก็บทั้งสองค่าแยกคอลัมน์', async () => {
    const fullPng = 'data:image/png;base64,iVBORw0KGgo=CREATEFULL';
    const thumbPng = 'data:image/png;base64,iVBORw0KGgo=CREATETHUMB';

    const createRes = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        vehicle_id: fixture.vehicleId,
        customer_id: fixture.customerId,
        job_date: todayStr(),
        photos: [{ full: fullPng, thumb: thumbPng }],
      });
    expect(createRes.status).toBe(201);

    const [[photo]] = await pool.query(
      'SELECT photo_data, photo_thumb_data FROM job_photos WHERE job_id = ?',
      [createRes.body.id]
    );
    expect(photo.photo_data).toBe(fullPng);
    expect(photo.photo_thumb_data).toBe(thumbPng);

    await pool.execute('DELETE FROM jobs WHERE id = ?', [createRes.body.id]);
  });

  test('ส่งรูปแบบ string ธรรมดา (โค้ดเวอร์ชันเก่า) → ยังบันทึกรูปเต็มได้ปกติ ไม่มี thumb', async () => {
    const fullPng = 'data:image/png;base64,iVBORw0KGgo=CREATELEGACY';

    const createRes = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        vehicle_id: fixture.vehicleId,
        customer_id: fixture.customerId,
        job_date: todayStr(),
        photos: [fullPng],
      });
    expect(createRes.status).toBe(201);

    const [[photo]] = await pool.query(
      'SELECT photo_data, photo_thumb_data FROM job_photos WHERE job_id = ?',
      [createRes.body.id]
    );
    expect(photo.photo_data).toBe(fullPng);
    expect(photo.photo_thumb_data).toBeNull();

    await pool.execute('DELETE FROM jobs WHERE id = ?', [createRes.body.id]);
  });
});

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

  test('explicitly pulling in a deposited (no_date) quotation from another day moves its quotation_date to today and clears the waiting status', async () => {
    const [quoteResult] = await pool.execute(
      `INSERT INTO quotations (quotation_no, quotation_date, customer_id, vehicle_id, total_amount, deposit_amount, deposit_date, status)
       VALUES (?, '2020-01-01', ?, ?, 22000, 5000, '2020-01-01', 'no_date')`,
      [`IV-TEST-${Date.now()}`, fixture.customerId, fixture.vehicleId]
    );
    const depositedQuotationId = quoteResult.insertId;

    const createRes = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        vehicle_id: fixture.vehicleId,
        customer_id: fixture.customerId,
        job_date: todayStr(),
        quotation_id: depositedQuotationId,
        symptom: 'ทดสอบดึงใบมัดจำมาวันนี้',
      });
    expect(createRes.status).toBe(201);

    const [[quotation]] = await pool.query(
      'SELECT quotation_date, status, scheduled_date, deposit_amount FROM quotations WHERE id = ?',
      [depositedQuotationId]
    );
    expect(new Date(quotation.quotation_date).toISOString().slice(0, 10)).toBe(todayStr());
    expect(quotation.status).toBe('pending'); // เอาสถานะ "รอทำ" ออกแล้ว ลูกค้ามาถึงจริง
    expect(quotation.scheduled_date).toBeNull();
    expect(Number(quotation.deposit_amount)).toBe(5000); // ยังเก็บมัดจำเดิมไว้ ไม่หาย

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

// เจ้าของร้านแจ้งบั๊กจริง: พนักงาน 2 คนกรอกข้อมูลรถ "กดพร้อมกัน" ได้เลขคิวชนกัน
// สาเหตุ: ฟอร์มเดาเลขคิวถัดไปจาก GET /jobs/next-queue-no (อ่านเฉย ๆ ไม่ล็อก) ตอน
// เปิดฟอร์ม แล้วส่งเลขนั้นมาตอน submit — เดิมโค้ดเชื่อเลขที่ client ส่งมาตรง ๆ เลย
// ข้าม FOR UPDATE ที่ควรกันชนไปทั้งหมด ถ้าเปิดฟอร์มพร้อมกันสองคนเลยได้เลขแนะนำ
// เดียวกัน แล้วชนกันจริงตอน insert
describe('POST /api/jobs — เลขคิวไม่ชนกัน แม้ client ส่งเลขคิวเดียวกันมาพร้อมกัน (บั๊กที่เจ้าของร้านแจ้ง)', () => {
  let token;
  let fixtureA;
  let fixtureB;

  beforeAll(async () => {
    token = await getOfficeToken();
  });

  beforeEach(async () => {
    fixtureA = await createCustomerWithVehicle({ namePrefix: 'Queue Race Customer A' });
    fixtureB = await createCustomerWithVehicle({ namePrefix: 'Queue Race Customer B' });
  });

  afterEach(async () => {
    await cleanupCustomer(fixtureA.customerId);
    await cleanupCustomer(fixtureB.customerId);
  });

  test('สองคำขอพร้อมกัน ส่งเลขคิวเดียวกันมาทั้งคู่ (เหมือนสองคนเปิดฟอร์มพร้อมกันได้เลขแนะนำเดียวกัน) → ได้เลขคิวคนละเลข', async () => {
    const staleQueueNo = '777'; // เลขที่ทั้งสองฟอร์มบังเอิญเดามาเหมือนกัน
    const submitA = request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicle_id: fixtureA.vehicleId, customer_id: fixtureA.customerId, job_date: todayStr(), queue_no: staleQueueNo });
    const submitB = request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicle_id: fixtureB.vehicleId, customer_id: fixtureB.customerId, job_date: todayStr(), queue_no: staleQueueNo });

    const [resA, resB] = await Promise.all([submitA, submitB]);
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);

    const [[jobA]] = await pool.query('SELECT queue_no FROM jobs WHERE id = ?', [resA.body.id]);
    const [[jobB]] = await pool.query('SELECT queue_no FROM jobs WHERE id = ?', [resB.body.id]);
    expect(jobA.queue_no).not.toBe(jobB.queue_no); // จุดที่เคยพังจริง — ต้องได้คนละเลข

    await pool.execute('DELETE FROM jobs WHERE id IN (?, ?)', [resA.body.id, resB.body.id]);
  });

  test('พิมพ์เลขคิวเองแล้วชนกับงานที่เปิดอยู่แล้วของวันนี้ → เลื่อนไปเลขถัดไปที่ว่างให้อัตโนมัติ', async () => {
    const first = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicle_id: fixtureA.vehicleId, customer_id: fixtureA.customerId, job_date: todayStr(), queue_no: '888' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicle_id: fixtureB.vehicleId, customer_id: fixtureB.customerId, job_date: todayStr(), queue_no: '888' });
    expect(second.status).toBe(201);

    const [[jobFirst]] = await pool.query('SELECT queue_no FROM jobs WHERE id = ?', [first.body.id]);
    const [[jobSecond]] = await pool.query('SELECT queue_no FROM jobs WHERE id = ?', [second.body.id]);
    expect(jobFirst.queue_no).toBe('888'); // คนแรกได้เลขที่พิมพ์จริง
    expect(jobSecond.queue_no).not.toBe('888'); // คนหลังชน เลื่อนไปเลขอื่นแทน

    await pool.execute('DELETE FROM jobs WHERE id IN (?, ?)', [first.body.id, second.body.id]);
  });
});

// เจ้าของร้านแจ้งบั๊กจริงอีกจุด: งานที่รับคิวมาจากไลน์ (ไม่มีรูปตอนสร้าง) ไม่มีทาง
// เพิ่มรูปรถทีหลังได้เลยจากหน้าเว็บ — ต่างจากรูปอะไหล่ (part-photos) ที่มี endpoint
// เพิ่ม/ลบ/จัดลำดับอยู่แล้ว รูปรถตอนรับเข้า (intake) ไม่เคยมี endpoint พวกนี้มาก่อน
describe('POST/DELETE/PATCH /api/jobs/:id/photos — เพิ่ม/ลบ/จัดลำดับรูปรถตอนรับเข้าได้ทุกสถานะงาน', () => {
  let token;
  let fixture;
  let jobId;

  beforeAll(async () => {
    token = await getOfficeToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle({ namePrefix: 'Intake Photo Test Customer' });
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

  test('เพิ่มรูปได้ตั้งแต่สถานะ received (ไม่ต้องรออนุมัติ ต่างจากรูปอะไหล่)', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const [[jobBefore]] = await pool.query('SELECT status FROM jobs WHERE id = ?', [jobId]);
    expect(jobBefore.status).toBe('received');

    const res = await request(app)
      .post(`/api/jobs/${jobId}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .send({ photos: [png, png] });
    expect(res.status).toBe(201);
    expect(res.body.ids).toHaveLength(2);

    const [rows] = await pool.query(
      "SELECT id, sort_order FROM job_photos WHERE job_id = ? AND photo_type = 'intake' ORDER BY sort_order",
      [jobId]
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1]);
  });

  test('ลบรูปแล้วหายจริง ไม่กระทบรูปอะไหล่ (photo_type คนละชนิด)', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const addRes = await request(app)
      .post(`/api/jobs/${jobId}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .send({ photos: [png] });
    const photoId = addRes.body.ids[0];

    const delRes = await request(app)
      .delete(`/api/jobs/${jobId}/photos/${photoId}`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(delRes.status).toBe(200);

    const [rows] = await pool.query('SELECT id FROM job_photos WHERE id = ?', [photoId]);
    expect(rows).toHaveLength(0);
  });

  test('ลบรูปอะไหล่ไม่ได้ผ่าน endpoint นี้ (photo_type ไม่ตรง)', async () => {
    await pool.execute("UPDATE jobs SET status = 'approved' WHERE id = ?", [jobId]);
    const [partResult] = await pool.execute(
      "INSERT INTO job_photos (job_id, photo_data, sort_order, photo_type) VALUES (?, 'data:image/png;base64,x', 0, 'part')",
      [jobId]
    );
    const res = await request(app)
      .delete(`/api/jobs/${jobId}/photos/${partResult.insertId}`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(res.status).toBe(404);
  });

  test('จัดลำดับ (move) สลับตำแหน่งกับรูปข้างเคียงได้', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const addRes = await request(app)
      .post(`/api/jobs/${jobId}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .send({ photos: [png, png] });
    const [firstId, secondId] = addRes.body.ids;

    const moveRes = await request(app)
      .patch(`/api/jobs/${jobId}/photos/${secondId}/move`)
      .set('Authorization', `Bearer ${token}`)
      .send({ direction: -1 });
    expect(moveRes.status).toBe(200);

    const [rows] = await pool.query(
      "SELECT id, sort_order FROM job_photos WHERE job_id = ? AND photo_type = 'intake' ORDER BY sort_order",
      [jobId]
    );
    expect(rows[0].id).toBe(secondId);
    expect(rows[1].id).toBe(firstId);
  });

  test('ส่งรูปแบบ {full, thumb} → GET /jobs (รายการวันนี้) ใช้ thumb ไม่ใช่รูปเต็ม กันหน้ารายการโหลดหนัก', async () => {
    const fullPng = 'data:image/png;base64,iVBORw0KGgo=FULLFULLFULL';
    const thumbPng = 'data:image/png;base64,iVBORw0KGgo=TINY';

    await request(app)
      .post(`/api/jobs/${jobId}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .send({ photos: [{ full: fullPng, thumb: thumbPng }] });

    const listRes = await request(app)
      .get(`/api/jobs?date=${todayStr()}`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    const listedJob = listRes.body.data.find((j) => j.id === jobId);
    expect(listedJob.photo_thumb).toBe(thumbPng);
  });

  test('ส่งรูปแบบ string ธรรมดา (ไม่มี thumb) → GET /jobs ใช้รูปเต็มแทน (fallback ย้อนหลังให้รูปเก่ายังโชว์ได้)', async () => {
    const fullPng = 'data:image/png;base64,iVBORw0KGgo=LEGACYSTRING';

    await request(app)
      .post(`/api/jobs/${jobId}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .send({ photos: [fullPng] });

    const listRes = await request(app)
      .get(`/api/jobs?date=${todayStr()}`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    const listedJob = listRes.body.data.find((j) => j.id === jobId);
    expect(listedJob.photo_thumb).toBe(fullPng);
  });
});

// เจ้าของร้านขอให้แยกบิลได้เรื่อยๆ ในคิวเดียว (เช่นบิลวันนี้ + บิลมัดจำนัดวันหลัง +
// บิลขอใบเสนอราคาเฉยๆ) — endpoint นี้รวบรวมใบเสนอราคาทั้งหมดของลูกค้า+รถ+วันเดียว
// กับงานนี้มาให้ ไม่ต้องเพิ่มคอลัมน์ผูกใหม่
describe('GET /api/jobs/:id/quotations — บิลอื่นๆ ของงานนี้ (ลูกค้า+รถ+วันเดียวกัน)', () => {
  let token;
  let fixture;
  let jobId;

  beforeAll(async () => {
    token = await getOfficeToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle({ namePrefix: 'Sibling Bill Test Customer' });
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

  test('ไม่มีบิลอื่นเลย → คืน array ว่าง', async () => {
    const res = await request(app)
      .get(`/api/jobs/${jobId}/quotations`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('มีบิลแยกต่างหาก (ลูกค้า+รถ+วันเดียวกัน) → เห็นในรายการ พร้อม flag is_primary ถูกต้อง', async () => {
    // บิลหลัก — ผูกกับ job.quotation_id ผ่านช่องทางปกติ
    await request(app)
      .patch(`/api/jobs/${jobId}/quote-draft`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ product_name: 'ค่าแรง', quantity: 1, unit_price: 500 }] });
    const approveRes = await request(app)
      .post(`/api/jobs/${jobId}/quotation/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    const primaryQuotationId = approveRes.body.quotation_id;

    // บิลแยก — สร้างตรงผ่าน POST /quotations เหมือนที่ ExtraBillModal.jsx จะเรียก
    const extraRes = await request(app)
      .post('/api/quotations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: todayStr(),
        items: [{ product_name: 'โช๊คอัพ', quantity: 2, unit_price: 1500 }],
        deposit_amount: 1000,
        deposit_date: todayStr(),
      });
    expect(extraRes.status).toBe(201);

    const res = await request(app)
      .get(`/api/jobs/${jobId}/quotations`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);

    const primary = res.body.data.find((q) => q.id === primaryQuotationId);
    const extra = res.body.data.find((q) => q.id === extraRes.body.quotation_id);
    expect(primary.is_primary).toBe(true);
    expect(extra.is_primary).toBe(false);
    expect(Number(extra.deposit_amount)).toBe(1000);

    // เคลียร์บิลแยกที่สร้างเอง (afterEach เคลียร์ได้แค่บิลที่ job ผูกอยู่ผ่าน quotation_id)
    await pool.execute('DELETE FROM repair_notices WHERE quotation_id = ?', [extraRes.body.quotation_id]);
    await pool.execute('DELETE FROM quotation_items WHERE quotation_id = ?', [extraRes.body.quotation_id]);
    await pool.execute('DELETE FROM quotations WHERE id = ?', [extraRes.body.quotation_id]);
    // และบิลหลักที่ approve สร้าง receipt ไว้ด้วย
    const [[quotation]] = await pool.query('SELECT converted_receipt_id FROM quotations WHERE id = ?', [primaryQuotationId]);
    if (quotation?.converted_receipt_id) {
      await pool.execute('DELETE FROM receipt_items WHERE receipt_id = ?', [quotation.converted_receipt_id]);
      await pool.execute('DELETE FROM receipts WHERE id = ?', [quotation.converted_receipt_id]);
    }
    await pool.execute('DELETE FROM repair_notices WHERE quotation_id = ?', [primaryQuotationId]);
    await pool.execute('DELETE FROM quotation_items WHERE quotation_id = ?', [primaryQuotationId]);
    await pool.execute('UPDATE jobs SET quotation_id = NULL WHERE id = ?', [jobId]);
    await pool.execute('DELETE FROM quotations WHERE id = ?', [primaryQuotationId]);
  });
});

// QR คงที่แปะห้องรับรอง — ย้ายจาก QR ต่อคัน (เดิม /:id/qr เติมทะเบียนอัตโนมัติ)
// เป็น QR เดียวลิงก์แค่หน้า /track เฉย ๆ พิมพ์ครั้งเดียวใช้ถาวรได้ ไม่ผูกกับ job id
describe('GET /api/jobs/qr/track — QR คงที่ ลิงก์หน้า /track เฉยๆ ไม่ผูกกับงานไหน', () => {
  let token;

  beforeAll(async () => {
    token = await getOfficeToken();
  });

  test('คืน tracking_url ที่ลงท้ายด้วย /track เฉยๆ ไม่มี query param ผูกรถคันไหน', async () => {
    const res = await request(app)
      .get('/api/jobs/qr/track')
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(res.status).toBe(200);
    expect(res.body.tracking_url).toMatch(/\/track$/);
    expect(res.body.qr_data_url).toMatch(/^data:image\/png;base64,/);
  });
});

afterAll(async () => {
  await pool.end();
});
