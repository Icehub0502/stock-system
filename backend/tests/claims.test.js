const request = require('supertest');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { getOfficeToken, getTechnicianToken, createCustomerWithVehicle, cleanupCustomer } = require('./helpers');

const app = createApp();

describe('/api/claims — บันทึกเคลมอิสระ ไม่ผูกกับใบเสร็จ/ใบเสนอราคาเดิม', () => {
  let officeToken;
  let techToken;
  let customerId;
  let vehicleId;

  beforeAll(async () => {
    officeToken = await getOfficeToken();
    techToken = await getTechnicianToken();
  });

  beforeEach(async () => {
    const fixture = await createCustomerWithVehicle({ namePrefix: 'Claim Test' });
    customerId = fixture.customerId;
    vehicleId = fixture.vehicleId;
  });

  afterEach(async () => {
    await pool.execute('DELETE FROM claims WHERE customer_id = ?', [customerId]);
    await cleanupCustomer(customerId);
  });

  test('ช่าง (technician) → 403 เข้าถึงไม่ได้เลย', async () => {
    const res = await request(app).get('/api/claims').set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(403);
  });

  test('ไม่มี token เลย → 401', async () => {
    const res = await request(app).get('/api/claims');
    expect(res.status).toBe(401);
  });

  test('ออฟฟิศสร้างเคลมพร้อมรายการอะไหล่ → เลขที่เคลมรูปแบบ CLM-YYMMDD-NNN และดึงรายละเอียดกลับมาครบ', async () => {
    const createRes = await request(app)
      .post('/api/claims')
      .set('Authorization', `Bearer ${officeToken}`)
      .send({
        customer_id: customerId,
        vehicle_id: vehicleId,
        claim_date: '2026-09-02',
        symptom: 'เบรกมีเสียงหลังเปลี่ยน',
        remark: 'ทดสอบ',
        items: [
          { product_name: 'ผ้าเบรกหน้า', quantity: 1, unit_price: 0 },
          { product_name: 'น้ำมันเบรก', quantity: 2, unit_price: 150 },
        ],
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.claim_no).toMatch(/^CLM-\d{6}-\d{3}$/);

    const detailRes = await request(app)
      .get(`/api/claims/${createRes.body.id}`)
      .set('Authorization', `Bearer ${officeToken}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.data.symptom).toBe('เบรกมีเสียงหลังเปลี่ยน');
    expect(detailRes.body.data.items).toHaveLength(2);
    expect(detailRes.body.data.items.map((it) => it.product_name).sort()).toEqual(['น้ำมันเบรก', 'ผ้าเบรกหน้า'].sort());

    const listRes = await request(app).get('/api/claims').set('Authorization', `Bearer ${officeToken}`);
    const row = listRes.body.data.find((r) => r.id === createRes.body.id);
    expect(row.item_count).toBe(2);
  });

  test('แก้ไขเคลม → แทนที่รายการอะไหล่ทั้งหมด (ของเก่าหายไป ของใหม่เข้ามาแทน)', async () => {
    const createRes = await request(app)
      .post('/api/claims')
      .set('Authorization', `Bearer ${officeToken}`)
      .send({
        customer_id: customerId,
        vehicle_id: vehicleId,
        claim_date: '2026-09-02',
        items: [{ product_name: 'ของเดิม', quantity: 1, unit_price: 100 }],
      });

    const putRes = await request(app)
      .put(`/api/claims/${createRes.body.id}`)
      .set('Authorization', `Bearer ${officeToken}`)
      .send({
        customer_id: customerId,
        vehicle_id: vehicleId,
        claim_date: '2026-09-03',
        symptom: 'แก้ไขแล้ว',
        items: [{ product_name: 'ของใหม่', quantity: 3, unit_price: 50 }],
      });
    expect(putRes.status).toBe(200);

    const detailRes = await request(app)
      .get(`/api/claims/${createRes.body.id}`)
      .set('Authorization', `Bearer ${officeToken}`);
    expect(detailRes.body.data.symptom).toBe('แก้ไขแล้ว');
    expect(detailRes.body.data.items).toHaveLength(1);
    expect(detailRes.body.data.items[0]).toMatchObject({ product_name: 'ของใหม่', quantity: 3 });
  });

  test('ลบเคลม → ลบรายการอะไหล่ตามไปด้วย (ON DELETE CASCADE)', async () => {
    const createRes = await request(app)
      .post('/api/claims')
      .set('Authorization', `Bearer ${officeToken}`)
      .send({
        customer_id: customerId,
        vehicle_id: vehicleId,
        claim_date: '2026-09-02',
        items: [{ product_name: 'ของทดสอบลบ', quantity: 1, unit_price: 0 }],
      });
    const claimId = createRes.body.id;

    const delRes = await request(app).delete(`/api/claims/${claimId}`).set('Authorization', `Bearer ${officeToken}`);
    expect(delRes.status).toBe(200);

    const [items] = await pool.query('SELECT id FROM claim_items WHERE claim_id = ?', [claimId]);
    expect(items).toHaveLength(0);

    const getRes = await request(app).get(`/api/claims/${claimId}`).set('Authorization', `Bearer ${officeToken}`);
    expect(getRes.status).toBe(404);
  });

  test('ไม่เลือกรถ/ลูกค้า → 400', async () => {
    const res = await request(app)
      .post('/api/claims')
      .set('Authorization', `Bearer ${officeToken}`)
      .send({ claim_date: '2026-09-02', items: [] });
    expect(res.status).toBe(400);
  });
});
