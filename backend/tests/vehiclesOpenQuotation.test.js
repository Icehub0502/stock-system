const request = require('supertest');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { getOfficeToken, createCustomerWithVehicle, cleanupCustomer } = require('./helpers');

const app = createApp();

// เจ้าของร้านเจอปัญหาจริง: ลูกค้ามีใบเสนอราคาเดิมค้างไว้ (เช่นคุยผ่านไลน์เมื่อวาน มี
// รายการ+มัดจำอยู่แล้ว) วันนี้เข้ามาทำจริง — เดิมไม่มีทางดึงใบเดิมมาใช้ตรงๆ ตอนกด
// "เพิ่มคิว" เลย (การจับคู่อัตโนมัติจำกัดแค่วันเดียวกัน กันจับใบเก่าที่ไม่เกี่ยวข้อง
// ผิดๆ) endpoint นี้ให้พนักงานเห็นแล้วเลือกดึงเข้ามาเองได้ (ดู AddJobModal.jsx)
describe('GET /api/vehicles/:id/open-quotation — หาใบเสนอราคาเดิมที่ยังเปิดอยู่ของรถ (ไม่จำกัดวันที่)', () => {
  let token;
  let fixture;

  beforeAll(async () => {
    token = await getOfficeToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle({ namePrefix: 'Open Quotation Test Customer' });
  });

  afterEach(async () => {
    await cleanupCustomer(fixture.customerId);
  });

  afterAll(async () => {
    await pool.end();
  });

  test('ไม่มีใบเสนอราคาเลย → คืน null', async () => {
    const res = await request(app)
      .get(`/api/vehicles/${fixture.vehicleId}/open-quotation`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  test('มีใบเสนอราคาที่ยังไม่ปิด จากวันอื่น (ไม่ใช่วันนี้) → เจอ พร้อมข้อมูลมัดจำ', async () => {
    await pool.execute(
      `INSERT INTO quotations (quotation_no, quotation_date, customer_id, vehicle_id, total_amount, status, deposit_amount, deposit_date, symptom)
       VALUES (?, '2020-01-01', ?, ?, 22650, 'pending', 2000, '2020-01-01', 'ทดสอบอาการ')`,
      [`IV-OPENQ-${Date.now()}`, fixture.customerId, fixture.vehicleId]
    );

    const res = await request(app)
      .get(`/api/vehicles/${fixture.vehicleId}/open-quotation`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(res.status).toBe(200);
    expect(res.body.data).toBeTruthy();
    expect(Number(res.body.data.total_amount)).toBe(22650);
    expect(Number(res.body.data.deposit_amount)).toBe(2000);
    expect(res.body.data.symptom).toBe('ทดสอบอาการ');
  });

  test('ใบเสนอราคาปิดบิลไปแล้ว (closed_at) → ไม่นับ คืน null', async () => {
    await pool.execute(
      `INSERT INTO quotations (quotation_no, quotation_date, customer_id, vehicle_id, total_amount, status, closed_at)
       VALUES (?, '2020-01-01', ?, ?, 5000, 'approved', NOW())`,
      [`IV-OPENQ-${Date.now()}`, fixture.customerId, fixture.vehicleId]
    );

    const res = await request(app)
      .get(`/api/vehicles/${fixture.vehicleId}/open-quotation`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  test('ใบเสนอราคาผูกกับงานที่ยัง active อยู่แล้ว → ไม่นับซ้ำ คืน null', async () => {
    const [quoteResult] = await pool.execute(
      `INSERT INTO quotations (quotation_no, quotation_date, customer_id, vehicle_id, total_amount, status)
       VALUES (?, '2020-01-01', ?, ?, 5000, 'pending')`,
      [`IV-OPENQ-${Date.now()}`, fixture.customerId, fixture.vehicleId]
    );
    const quotationId = quoteResult.insertId;

    const createRes = await request(app)
      .post('/api/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ vehicle_id: fixture.vehicleId, customer_id: fixture.customerId, job_date: '2020-01-01', quotation_id: quotationId });
    expect(createRes.status).toBe(201);

    const res = await request(app)
      .get(`/api/vehicles/${fixture.vehicleId}/open-quotation`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();

    await pool.execute('DELETE FROM jobs WHERE id = ?', [createRes.body.id]);
  });
});
