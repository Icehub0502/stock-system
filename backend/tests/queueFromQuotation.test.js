const request = require('supertest');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { getOfficeToken, createCustomerWithVehicle, cleanupCustomer } = require('./helpers');

const app = createApp();

afterAll(async () => {
  await pool.end();
});

describe('สร้างคิวจากใบเสนอราคาที่ลูกค้าเคยไม่ได้ทำ + จังหวัดของทะเบียน', () => {
  let token;
  let fixture;
  let quotationId;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    token = await getOfficeToken();
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle({ namePrefix: 'Queue From Quote' });
    const createRes = await request(app)
      .post('/api/quotations')
      .set(auth())
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-10',
        items: [{ product_name: 'ชุดโช๊ค', quantity: 1, unit_price: 4000 }],
      });
    quotationId = createRes.body.quotation_id;
  });

  afterEach(async () => {
    await pool.execute('DELETE FROM jobs WHERE vehicle_id = ?', [fixture.vehicleId]);
    await cleanupCustomer(fixture.customerId);
  });

  const decline = () => request(app)
    .patch(`/api/quotations/${quotationId}/decline`)
    .set(auth())
    .send({ reason: 'other', note: 'ราคาสูงไป' });

  test('ใบที่กด "ลูกค้าไม่ได้ทำ" ยังโผล่ในรายการใบเปิดของรถคันนั้น', async () => {
    expect((await decline()).status).toBe(200);
    const res = await request(app).get(`/api/vehicles/${fixture.vehicleId}/open-quotations`).set(auth());
    expect(res.status).toBe(200);
    const row = res.body.data.find((q) => q.id === quotationId);
    expect(row).toBeTruthy();
    expect(row.status).toBe('declined');
  });

  test('สร้างคิวจากใบที่ไม่ได้ทำ → ใบกลับเป็น pending ล้างเหตุผล และผูกกับงานใหม่', async () => {
    await decline();
    const res = await request(app)
      .post('/api/jobs')
      .set(auth())
      .send({ vehicle_id: fixture.vehicleId, customer_id: fixture.customerId, quotation_id: quotationId });
    expect(res.status).toBe(201);

    const [[q]] = await pool.query('SELECT status, decline_reason, decline_note, quotation_date FROM quotations WHERE id = ?', [quotationId]);
    expect(q.status).toBe('pending');
    expect(q.decline_reason).toBeNull();
    expect(q.decline_note).toBeNull();

    const [[job]] = await pool.query('SELECT quotation_id FROM jobs WHERE id = ?', [res.body.id]);
    expect(job.quotation_id).toBe(quotationId);
  });

  test('ใบที่เคยมีงาน rejected ผูกอยู่ (กดไม่ทำหลังรับคิว) → สร้างคิวใหม่จากใบเดิมได้ และไม่นับเป็นมีคิวเปิดอยู่', async () => {
    const [jobResult] = await pool.execute(
      `INSERT INTO jobs (job_no, job_date, customer_id, vehicle_id, quotation_id, status)
       VALUES (?, CURDATE(), ?, ?, ?, 'quoted')`,
      [`TESTJOB-${Date.now()}`, fixture.customerId, fixture.vehicleId, quotationId]
    );
    await decline();
    const [[old]] = await pool.query('SELECT status FROM jobs WHERE id = ?', [jobResult.insertId]);
    expect(old.status).toBe('rejected');

    const list = await request(app).get('/api/quotations').set(auth());
    expect(list.body.data.find((q) => q.id === quotationId).linked_job_id).toBeNull();

    const res = await request(app)
      .post('/api/jobs')
      .set(auth())
      .send({ vehicle_id: fixture.vehicleId, customer_id: fixture.customerId, quotation_id: quotationId });
    expect(res.status).toBe(201);
  });

  test('ใบที่มีคิวเปิดอยู่แล้ว → สร้างคิวซ้ำไม่ได้', async () => {
    const first = await request(app)
      .post('/api/jobs').set(auth())
      .send({ vehicle_id: fixture.vehicleId, customer_id: fixture.customerId, quotation_id: quotationId });
    expect(first.status).toBe(201);
    const second = await request(app)
      .post('/api/jobs').set(auth())
      .send({ vehicle_id: fixture.vehicleId, customer_id: fixture.customerId, quotation_id: quotationId });
    expect(second.status).toBe(400);
  });

  describe('รถที่กด "นัดวันมาทำ" จากหน้างาน (รถกลับไปก่อน) พอถึงวันนัด', () => {
    let waitingJobId;
    const linkedJobId = async () => (await request(app).get('/api/quotations').set(auth())).body.data
      .find((q) => q.id === quotationId).linked_job_id;

    beforeEach(async () => {
      const [jobResult] = await pool.execute(
        `INSERT INTO jobs (shop_id, job_no, job_date, customer_id, vehicle_id, quotation_id, status, bay)
         VALUES (1, ?, '2026-07-10', ?, ?, ?, 'scheduled', 'A1')`,
        [`TESTWAIT-${Date.now()}`, fixture.customerId, fixture.vehicleId, quotationId]
      );
      waitingJobId = jobResult.insertId;
      await pool.execute("UPDATE quotations SET status = 'scheduled', scheduled_date = CURDATE() WHERE id = ?", [quotationId]);
    });

    test('งานที่รอนัดไม่นับเป็นงานเปิดอยู่: ปุ่มสร้างคิวต้องขึ้น และใบโผล่ตอนเพิ่มคิวของรถคันนี้', async () => {
      expect(await linkedJobId()).toBeNull();
      const open = await request(app).get(`/api/vehicles/${fixture.vehicleId}/open-quotations`).set(auth());
      expect(open.body.data.map((q) => q.id)).toContain(quotationId);
    });

    test('สร้างคิวใหม่จากใบนัดได้ งานรอนัดเดิมจบเป็น "เอารถลง" และงานใหม่คืองานที่เปิดอยู่', async () => {
      const res = await request(app)
        .post('/api/jobs').set(auth())
        .send({ vehicle_id: fixture.vehicleId, customer_id: fixture.customerId, quotation_id: quotationId });
      expect(res.status).toBe(201);

      const [[old]] = await pool.query('SELECT status, bay, closed_at FROM jobs WHERE id = ?', [waitingJobId]);
      expect(old.status).toBe('carout');
      expect(old.bay).toBeNull();
      expect(old.closed_at).not.toBeNull();
      const [[history]] = await pool.query(
        'SELECT status FROM job_status_history WHERE job_id = ? ORDER BY id DESC LIMIT 1', [waitingJobId]
      );
      expect(history.status).toBe('carout');

      const [[q]] = await pool.query('SELECT status, scheduled_date FROM quotations WHERE id = ?', [quotationId]);
      expect(q.status).toBe('pending');
      expect(q.scheduled_date).toBeNull();
      expect(await linkedJobId()).toBe(res.body.id);

      // มีงานเปิดอยู่แล้ว สร้างซ้ำยังต้องไม่ได้
      const again = await request(app)
        .post('/api/jobs').set(auth())
        .send({ vehicle_id: fixture.vehicleId, customer_id: fixture.customerId, quotation_id: quotationId });
      expect(again.status).toBe(400);
    });

    test('อนุมัติใบหลังรับรถกลับมา: สถานะไปที่งานใหม่ ไม่ปลุกงานเก่าที่เอารถลงแล้ว', async () => {
      const created = await request(app)
        .post('/api/jobs').set(auth())
        .send({ vehicle_id: fixture.vehicleId, customer_id: fixture.customerId, quotation_id: quotationId });
      await decline();
      const [[fresh]] = await pool.query('SELECT status FROM jobs WHERE id = ?', [created.body.id]);
      const [[old]] = await pool.query('SELECT status, closed_at FROM jobs WHERE id = ?', [waitingJobId]);
      expect(fresh.status).toBe('rejected');
      expect(old.status).toBe('carout');
      expect(old.closed_at).not.toBeNull();
    });
  });

  test('รายการรถส่งเบอร์ลูกค้ามาด้วย เพื่อเติมในฟอร์มเพิ่มคิวเมื่อเจอทะเบียนเดิม', async () => {
    await pool.execute('UPDATE customers SET phone = ? WHERE id = ?', ['0812345678', fixture.customerId]);
    const res = await request(app).get('/api/vehicles').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.find((v) => v.id === fixture.vehicleId).phone).toBe('0812345678');
  });

  test('แก้ข้อมูลรถโดยไม่ส่งเลขไมล์ ไมล์เดิมต้องไม่หาย และส่งไมล์ใหม่แล้วเปลี่ยนตาม', async () => {
    await pool.execute('UPDATE vehicles SET mileage = 80000 WHERE id = ?', [fixture.vehicleId]);
    const put = (body) => request(app).put(`/api/vehicles/${fixture.vehicleId}`).set(auth()).send({ brand: 'Toyota', model: 'Vios', ...body });
    const mileageNow = async () => Number((await pool.query('SELECT mileage FROM vehicles WHERE id = ?', [fixture.vehicleId]))[0][0].mileage);
    expect((await put({ color: 'แดง' })).status).toBe(200);
    expect(await mileageNow()).toBe(80000);
    expect((await put({ mileage: 81000 })).status).toBe(200);
    expect(await mileageNow()).toBe(81000);
  });

  test('ฟอร์มที่ไม่มีช่องปีรถแก้ข้อมูลรถแล้ว ปีเดิมต้องไม่หาย', async () => {
    await pool.execute('UPDATE vehicles SET year = 2015 WHERE id = ?', [fixture.vehicleId]);
    const put = (body) => request(app).put(`/api/vehicles/${fixture.vehicleId}`).set(auth()).send({ brand: 'Toyota', model: 'Vios', ...body });
    const yearNow = async () => (await pool.query('SELECT year FROM vehicles WHERE id = ?', [fixture.vehicleId]))[0][0].year;
    expect((await put({})).status).toBe(200);
    expect(await yearNow()).toBe(2015);
    expect((await put({ year: 2018 })).status).toBe(200);
    expect(await yearNow()).toBe(2018);
    expect((await put({ year: null })).status).toBe(200);
    expect(await yearNow()).toBeNull();
  });

  test('จังหวัด: บันทึกตอนสร้าง/แก้รถ และตัดช่องว่าง (ว่าง = null)', async () => {
    const create = await request(app)
      .post('/api/vehicles').set(auth())
      .send({ customer_id: fixture.customerId, brand: 'Toyota', model: 'Vios', license_plate: 'กข1234', province: ' เชียงใหม่ ' });
    expect(create.status).toBe(201);
    const id = create.body.data.id;
    const get = await request(app).get(`/api/vehicles/${id}`).set(auth());
    expect(get.body.data.province).toBe('เชียงใหม่');

    const put = await request(app)
      .put(`/api/vehicles/${id}`).set(auth())
      .send({ brand: 'Toyota', model: 'Vios', license_plate: 'กข1234', province: '   ' });
    expect(put.status).toBe(200);
    const get2 = await request(app).get(`/api/vehicles/${id}`).set(auth());
    expect(get2.body.data.province).toBeNull();
  });
});

describe('จังหวัดต้องเป็นหนึ่งใน 77 จังหวัดเท่านั้น', () => {
  let token;
  let fixture;
  beforeAll(async () => { token = await getOfficeToken(); });
  beforeEach(async () => { fixture = await createCustomerWithVehicle({ namePrefix: 'Province Validate' }); });
  afterEach(async () => { await cleanupCustomer(fixture.customerId); });

  test('สะกดผิด/ไม่มีในรายการ → 400 ทั้งสร้างและแก้ไขรถ', async () => {
    const bad = await request(app)
      .post('/api/vehicles').set({ Authorization: `Bearer ${token}` })
      .send({ customer_id: fixture.customerId, brand: 'Toyota', model: 'Vios', license_plate: 'กข1', province: 'เชียงใหม' });
    expect(bad.status).toBe(400);
    const put = await request(app)
      .put(`/api/vehicles/${fixture.vehicleId}`).set({ Authorization: `Bearer ${token}` })
      .send({ brand: 'Toyota', model: 'Vios', license_plate: 'กข1', province: 'Chiang Mai' });
    expect(put.status).toBe(400);
  });
});
