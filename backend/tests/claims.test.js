const request = require('supertest');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { getManagerToken, getOfficeToken, getTechnicianToken, createCustomerWithVehicle, cleanupCustomer } = require('./helpers');

const app = createApp();

describe('/api/claims — บันทึกเคลมอิสระ ไม่ผูกกับใบเสร็จ/ใบเสนอราคาเดิม', () => {
  let officeToken;
  let techToken;
  let customerId;
  let vehicleId;

  beforeAll(async () => {
    officeToken = await getManagerToken();
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

  describe('เคสมาแก้งาน: วิธีแก้ ติดตามผล ปิดเคส', () => {
    const today = () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const auth = (token = officeToken) => ({ Authorization: `Bearer ${token}` });
    const createCase = (extra = {}) => request(app).post('/api/claims').set(auth()).send({
      customer_id: customerId,
      vehicle_id: vehicleId,
      case_type: 'rework',
      symptom: 'มีเสียงดังหลังเปลี่ยนโช๊ค',
      finding: 'น็อตยึดหลวม',
      resolution: 'ขันน็อตใหม่ตามค่าทอร์ค',
      follow_up_date: today(),
      items: [],
      ...extra,
    });
    const bucketOf = async (id) => {
      const res = await request(app).get('/api/claims/follow-ups').set(auth());
      expect(res.status).toBe(200);
      return ['due', 'upcoming', 'ready', 'open'].find((b) => res.body.data[b].some((c) => c.id === id)) || null;
    };
    const pendingOf = async (id) => (await request(app).get(`/api/claims/${id}`).set(auth())).body.data.follow_ups.find((f) => !f.done_at);
    const report = async (id, body) => {
      const pending = await pendingOf(id);
      return request(app).post(`/api/claims/${id}/follow-ups/${pending.id}/report`).set(auth()).send(body);
    };

    test('มาแก้งานโดยไม่มีอะไหล่บันทึกได้ และถึงวันนัดแล้วขึ้นในรายการต้องโทร', async () => {
      const res = await createCase();
      expect(res.status).toBe(201);
      const detail = await request(app).get(`/api/claims/${res.body.id}`).set(auth());
      expect(detail.body.data).toMatchObject({ case_type: 'rework', status: 'follow_up', resolution: 'ขันน็อตใหม่ตามค่าทอร์ค' });
      expect(await bucketOf(res.body.id)).toBe('due');
    });

    test('ตั้งวันติดตามโดยยังไม่กรอกวิธีแก้ → 400, วันย้อนหลัง → 400', async () => {
      expect((await createCase({ resolution: '  ' })).status).toBe(400);
      expect((await createCase({ follow_up_date: '2020-01-01' })).status).toBe(400);
    });

    test('ยังไม่มีวิธีแก้ = กำลังแก้ และตั้งวันติดตามทีหลังตอนแก้ไขได้', async () => {
      const res = await createCase({ resolution: undefined, follow_up_date: undefined });
      expect(await bucketOf(res.body.id)).toBe('open');
      const put = await request(app).put(`/api/claims/${res.body.id}`).set(auth()).send({
        customer_id: customerId, vehicle_id: vehicleId, symptom: 'มีเสียงดัง', resolution: 'เปลี่ยนบูช', follow_up_date: today(), items: [],
      });
      expect(put.status).toBe(200);
      expect(await bucketOf(res.body.id)).toBe('due');
      // แก้ไขโดยไม่ส่งช่องเคส ค่าเดิมต้องอยู่ครบ
      await request(app).put(`/api/claims/${res.body.id}`).set(auth()).send({ customer_id: customerId, vehicle_id: vehicleId, symptom: 'มีเสียงดัง', items: [] });
      const detail = await request(app).get(`/api/claims/${res.body.id}`).set(auth());
      expect(detail.body.data).toMatchObject({ case_type: 'rework', status: 'follow_up', resolution: 'เปลี่ยนบูช' });
      expect(detail.body.data.follow_ups).toHaveLength(1);
    });

    test('ลูกค้าแจ้งว่าหาย → รอปิดเคส, รายงานซ้ำไม่ได้', async () => {
      const res = await createCase();
      const pending = await pendingOf(res.body.id);
      const url = `/api/claims/${res.body.id}/follow-ups/${pending.id}/report`;
      expect((await request(app).post(url).set(auth()).send({ result: 'ok' })).status).toBe(400);
      expect((await request(app).post(url).set(auth()).send({ result: 'ok', note: 'ลูกค้าบอกเสียงหายแล้ว' })).status).toBe(200);
      expect(await bucketOf(res.body.id)).toBe('ready');
      expect((await request(app).post(url).set(auth()).send({ result: 'ok', note: 'ซ้ำ' })).status).toBe(409);
    });

    test('ติดต่อไม่ได้ต้องระบุวันโทรใหม่ แล้วเกิดรายการโทรครั้งถัดไป', async () => {
      const res = await createCase();
      expect((await report(res.body.id, { result: 'no_answer' })).status).toBe(400);
      expect((await report(res.body.id, { result: 'no_answer', next_date: today() })).status).toBe(200);
      expect(await bucketOf(res.body.id)).toBe('due');
    });

    test('ยังมีปัญหา → กลับไปกำลังแก้ และแก้ใหม่แล้วตั้งติดตามรอบใหม่ได้', async () => {
      const res = await createCase();
      expect((await report(res.body.id, { result: 'still_problem', note: 'ยังมีเสียงตอนเลี้ยว' })).status).toBe(200);
      expect(await bucketOf(res.body.id)).toBe('open');
      await request(app).put(`/api/claims/${res.body.id}`).set(auth()).send({
        customer_id: customerId, vehicle_id: vehicleId, resolution: 'เปลี่ยนลูกหมาก', follow_up_date: today(), items: [],
      });
      expect(await bucketOf(res.body.id)).toBe('due');
      const detail = await request(app).get(`/api/claims/${res.body.id}`).set(auth());
      expect(detail.body.data.follow_ups).toHaveLength(2);
    });

    test('ปิดเคส: ออฟฟิศปิดไม่ได้, ยังไม่ได้โทรปิดไม่ได้, ผู้จัดการปิดได้และเปิดใหม่ได้', async () => {
      const office = await getOfficeToken();
      const res = await createCase();
      const close = (token, body) => request(app).post(`/api/claims/${res.body.id}/close`).set(auth(token)).send(body);
      expect((await close(office, { outcome: 'resolved' })).status).toBe(403);
      expect((await close(officeToken, { outcome: 'resolved' })).status).toBe(409);
      await report(res.body.id, { result: 'ok', note: 'เรียบร้อยดี' });
      expect((await close(officeToken, {})).status).toBe(400);
      expect((await close(officeToken, { outcome: 'resolved', lesson: 'ตรวจทอร์คก่อนส่งรถ' })).status).toBe(200);
      expect(await bucketOf(res.body.id)).toBeNull();

      const reopened = await request(app).post(`/api/claims/${res.body.id}/reopen`).set(auth());
      expect(reopened.status).toBe(200);
      expect(await bucketOf(res.body.id)).toBe('open');
    });

    test('ค้นเคสเก่าจากวิธีแก้ได้ และเคสตัวอย่างของรุ่นเดียวกันขึ้นตอนเปิดเคสใหม่', async () => {
      const res = await createCase({ resolution: 'เปลี่ยนซีลกันรั่วรุ่นพิเศษ' });
      const list = await request(app).get('/api/claims').query({ search: 'ซีลกันรั่วรุ่นพิเศษ' }).set(auth());
      expect(list.body.data.map((c) => c.id)).toContain(res.body.id);
      const similar = await request(app).get('/api/claims/similar').query({ vehicle_id: vehicleId }).set(auth());
      expect(similar.body.data.map((c) => c.id)).toContain(res.body.id);
      const excluded = await request(app).get('/api/claims/similar').query({ vehicle_id: vehicleId, exclude: res.body.id }).set(auth());
      expect(excluded.body.data.map((c) => c.id)).not.toContain(res.body.id);
    });

    test('เคสตัวอย่างเจอทั้งรถที่พิมพ์ชื่อรุ่นเองและรถที่เลือกจากรายการ (มีช่วงปีต่อท้าย)', async () => {
      const [[own]] = await pool.query('SELECT brand, model FROM vehicles WHERE id = ?', [vehicleId]);
      const typedName = `${own.model} รุ่นตัวอย่าง`;
      await pool.execute('UPDATE vehicles SET model = ? WHERE id = ?', [typedName, vehicleId]);
      const other = await createCustomerWithVehicle({ namePrefix: 'Claim Similar' });
      await pool.execute('UPDATE vehicles SET brand = ?, model = ? WHERE id = ?', [own.brand, `${typedName} (ปี 2013-2020)`, other.vehicleId]);
      try {
        const res = await createCase({ resolution: 'เปลี่ยนบูชปีกนก' });
        const fromPicked = await request(app).get('/api/claims/similar').query({ vehicle_id: other.vehicleId }).set(auth());
        expect(fromPicked.body.data.map((c) => c.id)).toContain(res.body.id);

        const reverse = await request(app).post('/api/claims').set(auth()).send({
          customer_id: other.customerId, vehicle_id: other.vehicleId, resolution: 'เปลี่ยนลูกหมาก', items: [],
        });
        const fromTyped = await request(app).get('/api/claims/similar').query({ vehicle_id: vehicleId }).set(auth());
        expect(fromTyped.body.data.map((c) => c.id)).toContain(reverse.body.id);
      } finally {
        await pool.execute('DELETE FROM claims WHERE customer_id = ?', [other.customerId]);
        await cleanupCustomer(other.customerId);
      }
    });

    test('ลบเคสแล้วรายการติดตามไปอยู่ในถังขยะด้วย กู้คืนกลับมาครบ', async () => {
      const res = await createCase();
      const pending = await pendingOf(res.body.id);
      expect((await request(app).delete(`/api/claims/${res.body.id}`).set(auth())).status).toBe(200);
      const [rows] = await pool.query('SELECT id FROM claim_follow_ups WHERE id = ?', [pending.id]);
      expect(rows).toHaveLength(0);
      const [[trash]] = await pool.query("SELECT snapshot FROM deleted_records WHERE entity = 'claims' AND record_id = ? ORDER BY id DESC LIMIT 1", [res.body.id]);
      expect(trash.snapshot).toContain('claim_follow_ups');
    });

    test('ประวัติรถนับจำนวนครั้งที่มาแก้ เคลม และอะไหล่ที่เคลม', async () => {
      await createCase();
      await createCase({
        case_type: 'parts_claim',
        items: [{ product_name: 'โช๊คหน้า', quantity: 2, unit_price: 0 }],
      });
      const res = await request(app).get(`/api/vehicle-history/${vehicleId}`).set(auth());
      expect(res.status).toBe(200);
      expect(res.body.data.summary).toMatchObject({ rework_count: 1, parts_claim_count: 1, open_case_count: 2 });
      expect(res.body.data.summary.claimed_parts[0]).toMatchObject({ name: 'โช๊คหน้า', times: 1, qty: 2 });
      expect(res.body.data.claims[0].follow_ups.length).toBeGreaterThan(0);
    });
  });
});
