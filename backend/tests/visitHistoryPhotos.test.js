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

// เจ้าของร้านขอให้พนักงานคนอื่น/ลูกค้าที่มาดูย้อนหลังเห็นรูปรถ/รูปอะไหล่ได้จาก
// หน้าประวัติ (VehicleHistoryPage.jsx/CustomerHistoryPage.jsx) โดยตรง — ก่อนหน้านี้
// buildVisitHistory ไม่เคยดึงรูปมาให้เลย
describe('GET /api/vehicles/:id/history — รวมรูปรถ/รูปอะไหล่ของแต่ละครั้งที่มาด้วย', () => {
  let token;
  let fixture;
  let jobId;

  beforeAll(async () => {
    token = await getOfficeToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle({ namePrefix: 'Visit History Photo Test Customer' });
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

  afterAll(async () => {
    await pool.end();
  });

  test('มีรูปรถตอนรับเข้าที่แนบไว้ → เห็นในประวัติ พร้อม photo_type ถูกต้อง', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    await request(app)
      .post(`/api/jobs/${jobId}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .send({ photos: [png] });

    const res = await request(app)
      .get(`/api/vehicles/${fixture.vehicleId}/history`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(res.status).toBe(200);
    expect(res.body.data.visits).toHaveLength(1);
    expect(res.body.data.visits[0].photos).toHaveLength(1);
    expect(res.body.data.visits[0].photos[0].photo_type).toBe('intake');
  });

  test('ไม่มีรูปเลย → photos เป็น array ว่าง ไม่ error', async () => {
    const res = await request(app)
      .get(`/api/vehicles/${fixture.vehicleId}/history`)
      .set('Authorization', `Bearer ${token}`)
      .send();
    expect(res.status).toBe(200);
    expect(res.body.data.visits[0].photos).toEqual([]);
  });
});
