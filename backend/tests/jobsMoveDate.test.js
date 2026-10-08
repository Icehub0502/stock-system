const request = require('supertest');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { getOfficeToken, getTechnicianToken, createCustomerWithVehicle, cleanupCustomer } = require('./helpers');

const app = createApp();

describe('PATCH /api/jobs/move-date — ย้ายรถค้างส่งไปแฟ้มวันอื่น', () => {
  let officeToken;
  let techToken;
  let fixture;
  const jobIds = [];
  // วันไกลอนาคตกันชนกับข้อมูลจริงในฐานข้อมูลทดสอบ
  const fromDate = '2099-03-10';
  const toDate = '2099-03-11';
  const suffix = Date.now().toString(36);

  beforeAll(async () => {
    officeToken = await getOfficeToken();
    techToken = await getTechnicianToken();
    fixture = await createCustomerWithVehicle({ namePrefix: 'Move Date Test Customer' });
  });

  afterAll(async () => {
    if (jobIds.length) await pool.query('DELETE FROM jobs WHERE id IN (?)', [jobIds]);
    await cleanupCustomer(fixture.customerId);
  });

  async function insertJob({ date, queue, status = 'approved' }) {
    const jobNo = `T-${suffix}-${jobIds.length}`.slice(0, 20);
    const [res] = await pool.execute(
      `INSERT INTO jobs (job_no, queue_no, job_date, customer_id, vehicle_id, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [jobNo, queue, date, fixture.customerId, fixture.vehicleId, status]
    );
    jobIds.push(res.insertId);
    return res.insertId;
  }

  const move = (body, token = officeToken) =>
    request(app).patch('/api/jobs/move-date').set('Authorization', `Bearer ${token}`).send(body);
  const getJob = async (id) => (await pool.execute('SELECT job_date, queue_no FROM jobs WHERE id = ?', [id]))[0][0];

  test('ย้ายหลายคัน: เปลี่ยนวัน เลขคิวที่ไม่ซ้ำคงเดิม ที่ซ้ำ/ไม่มีได้เลขถัดไปของวันปลายทาง', async () => {
    const existing = await insertJob({ date: toDate, queue: '1' });
    const a = await insertJob({ date: fromDate, queue: '1' }); // ซ้ำกับของเดิม → ได้ 2
    const b = await insertJob({ date: fromDate, queue: '7' }); // ไม่ซ้ำ → คงเลข 7
    const c = await insertJob({ date: fromDate, queue: null }); // ไม่มีเลข → ถัดจาก 7 = 8
    const res = await move({ ids: [a, b, c], job_date: toDate });
    expect(res.status).toBe(200);
    expect((await getJob(existing)).queue_no).toBe('1');
    const rows = await Promise.all([a, b, c].map(getJob));
    expect(rows.map((r) => r.job_date)).toEqual([toDate, toDate, toDate]);
    const queues = rows.map((r) => r.queue_no);
    expect(new Set(queues).size).toBe(3);
    expect(queues).toContain('7');
    expect(queues).not.toContain('1');
  });

  test('ย้ายกลับวันก่อนหน้าได้ และย้ายไปวันเดิม (no-op) ไม่เปลี่ยนอะไร', async () => {
    const id = await insertJob({ date: toDate, queue: '50' });
    expect((await move({ ids: [id], job_date: fromDate })).status).toBe(200);
    expect(await getJob(id)).toMatchObject({ job_date: fromDate, queue_no: '50' });
    const again = await move({ ids: [id], job_date: fromDate });
    expect(again.status).toBe(200);
    expect(again.body.moved).toEqual([]);
  });

  test('สถานะที่ไม่ใช่รถค้างส่ง (ส่งแล้ว/รับเข้าใหม่) ย้ายไม่ได้ และไม่ย้ายคันอื่นในชุดเดียวกัน', async () => {
    const ok = await insertJob({ date: fromDate, queue: '60' });
    const delivered = await insertJob({ date: fromDate, queue: '61', status: 'delivered' });
    const res = await move({ ids: [ok, delivered], job_date: toDate });
    expect(res.status).toBe(400);
    expect((await getJob(ok)).job_date).toBe(fromDate);
  });

  test('validation และสิทธิ์', async () => {
    const id = await insertJob({ date: fromDate, queue: '70' });
    expect((await move({ ids: [id], job_date: '2099-02-31' })).status).toBe(400);
    expect((await move({ ids: [id], job_date: 'ไม่ใช่วันที่' })).status).toBe(400);
    expect((await move({ ids: [], job_date: toDate })).status).toBe(400);
    expect((await move({ ids: ['x'], job_date: toDate })).status).toBe(400);
    expect((await move({ ids: [99999999], job_date: toDate })).status).toBe(404);
    expect((await move({ ids: [id], job_date: toDate }, techToken)).status).toBe(403);
    expect((await getJob(id)).job_date).toBe(fromDate);
  });
});
