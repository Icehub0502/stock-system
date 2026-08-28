const crypto = require('crypto');
const request = require('supertest');

// route อ่าน LINE_CHANNEL_SECRET จาก env ตอนรับ request — ต้องตั้งก่อนยิงเทสต์
// (ค่านี้แยกจากของ lineWebhook.test.js กันชนกันถ้า Jest รันหลายไฟล์ใน process เดียว)
const TEST_SECRET = 'test-line-push-secret';
process.env.LINE_CHANNEL_SECRET = TEST_SECRET;

const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const lineWebhook = require('../src/routes/lineWebhook.routes');
const { getOfficeToken, createCustomerWithVehicle, cleanupCustomer } = require('./helpers');

const app = createApp();

function sign(rawBody) {
  return crypto.createHmac('sha256', TEST_SECRET).update(rawBody).digest('base64');
}

function postWebhookRaw(body) {
  const rawBody = JSON.stringify(body);
  return request(app)
    .post('/api/line/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Line-Signature', sign(rawBody))
    .send(rawBody);
}

// ── pushToLine: best-effort เหมือน replyToLine ทุกประการ (ไม่มี token/groupId ก็
// ไม่ยิง fetch เลย ไม่ throw, ยิงแล้ว fetch ล้มก็ไม่ throw) ──
describe('pushToLine — best-effort', () => {
  const originalToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    else process.env.LINE_CHANNEL_ACCESS_TOKEN = originalToken;
    jest.restoreAllMocks();
  });

  test('ไม่มี LINE_CHANNEL_ACCESS_TOKEN → ไม่เรียก fetch เลย ไม่ throw', async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const fetchSpy = jest.spyOn(global, 'fetch');
    await expect(lineWebhook.pushToLine('Gtest', 'hello')).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('มี token แต่ไม่มี groupId → ไม่เรียก fetch เลย ไม่ throw', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    const fetchSpy = jest.spyOn(global, 'fetch');
    await expect(lineWebhook.pushToLine(null, 'hello')).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('มีทั้ง token และ groupId → ยิงไปที่ LINE push API ด้วย payload ที่ถูกต้อง', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, text: async () => '' });
    await lineWebhook.pushToLine('Gtest', 'hello world');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.line.me/v2/bot/message/push');
    expect(options.headers.Authorization).toBe('Bearer test-token');
    const body = JSON.parse(options.body);
    expect(body.to).toBe('Gtest');
    expect(body.messages).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  test('fetch ล้ม (network error) → ไม่ throw', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
    await expect(lineWebhook.pushToLine('Gtest', 'hello')).resolves.toBeUndefined();
  });

  test('LINE ตอบ ไม่ ok → ไม่ throw (log ไว้เฉย ๆ)', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 400, text: async () => 'bad request' });
    await expect(lineWebhook.pushToLine('Gtest', 'hello')).resolves.toBeUndefined();
  });
});

// ── auto-capture group id: ข้อความ/อีเวนต์แรกจากกลุ่มไลน์ → บันทึกลง app_settings
// อัตโนมัติ ไม่ต้องตั้งค่าเอง (ดู captureGroupId ใน lineWebhook.routes.js) ──
describe('LINE group id — auto-capture ลง app_settings', () => {
  afterAll(async () => {
    await pool.execute('DELETE FROM app_settings WHERE `key` = ?', ['line_group_id']);
  });

  test('ข้อความจากกลุ่มไลน์เข้ามา → group id ถูกบันทึกลง app_settings', async () => {
    const groupId = `Gcapture-${Date.now()}`;
    const res = await postWebhookRaw({
      destination: 'Utest',
      events: [
        {
          type: 'message',
          mode: 'active',
          timestamp: Date.now(),
          replyToken: 'test-reply-token',
          source: { type: 'group', groupId },
          message: { type: 'text', id: `msg-${Date.now()}`, text: 'สวัสดีครับ' }, // แชตทั่วไป ไม่ตรงเทมเพลต ไม่สร้างอะไร
        },
      ],
    });
    expect(res.status).toBe(200);

    const [[row]] = await pool.query('SELECT value FROM app_settings WHERE `key` = ?', ['line_group_id']);
    expect(row).toBeTruthy();
    expect(row.value).toBe(groupId);

    const stored = await lineWebhook.getLineGroupId();
    expect(stored).toBe(groupId);
  });
});

// ── การ auto-push กลับเข้ากลุ่มไลน์ตอนแก้ไขข้อมูลผ่านหน้าเว็บ (ใบเสนอราคา/รถ/ลูกค้า)
// ถูกถอดออกทั้งระบบตามคำสั่งเจ้าของร้าน (เคยกินโควต้า push ของ LINE โดยไม่จำเป็น —
// พนักงานคัดลอกข้อความไปแจ้งกลุ่มเองด้วยมืออยู่แล้ว) เทสต์นี้เป็นเซฟตี้เน็ตกันมีใคร
// เผลอเพิ่ม pushQuotationUpdate หรือโค้ดคล้ายกันกลับเข้ามาที่ 3 endpoint นี้อีกในอนาคต
// โดยไม่รู้ตัว — ตั้ง LINE_CHANNEL_ACCESS_TOKEN + mock fetch ไว้เพื่อจับได้ว่ามีความ
// พยายามยิง push จริง (ไม่ใช่แค่ไม่ error)
describe('แก้ไขข้อมูลผ่านหน้าเว็บ ไม่ auto-push กลับเข้ากลุ่มไลน์อีกต่อไป', () => {
  let token;
  let fixture;
  let fetchSpy;
  const testGroupId = 'Gpush-web-edit-test';
  const originalToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  beforeAll(async () => {
    token = await getOfficeToken();
    await pool.execute(
      'INSERT INTO app_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      ['line_group_id', testGroupId]
    );
  });

  beforeEach(async () => {
    fixture = await createCustomerWithVehicle({ namePrefix: 'Push Trigger Test Customer' });
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, text: async () => '' });
  });

  afterEach(async () => {
    await cleanupCustomer(fixture.customerId);
    jest.restoreAllMocks();
    if (originalToken === undefined) delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    else process.env.LINE_CHANNEL_ACCESS_TOKEN = originalToken;
  });

  afterAll(async () => {
    await pool.execute('DELETE FROM app_settings WHERE `key` = ?', ['line_group_id']);
    await pool.end();
  });

  function pushAttempts() {
    return fetchSpy.mock.calls.filter(([url]) => url === 'https://api.line.me/v2/bot/message/push');
  }

  async function insertQuotation({ queueNo = null, closed = false }) {
    const [result] = await pool.execute(
      `INSERT INTO quotations (quotation_no, quotation_date, customer_id, vehicle_id, total_amount, queue_no, closed_at)
       VALUES (?, CURDATE(), ?, ?, 0, ?, ${closed ? 'NOW()' : 'NULL'})`,
      [`TESTPUSH-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, fixture.customerId, fixture.vehicleId, queueNo]
    );
    return result.insertId;
  }

  test('PUT /api/quotations/:id — ใบที่มาจากไลน์และยังเปิดอยู่ → ยังไม่ยิง push', async () => {
    const quotationId = await insertQuotation({ queueNo: '9' });

    const res = await request(app)
      .put(`/api/quotations/${quotationId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_id: fixture.customerId,
        vehicle_id: fixture.vehicleId,
        quotation_date: '2026-07-21',
        queue_no: '9',
        items: [],
      });
    expect(res.status).toBe(200);
    expect(pushAttempts()).toHaveLength(0);
  });

  test('PUT /api/vehicles/:id — รถที่ผูกกับใบเสนอราคาที่มาจากไลน์และยังเปิดอยู่ → ยังไม่ยิง push', async () => {
    await insertQuotation({ queueNo: '11' });

    const res = await request(app)
      .put(`/api/vehicles/${fixture.vehicleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ brand: 'Honda', model: 'Civic', color: 'Red', license_plate: `TESTV-${Date.now()}`, mileage: 5000 });
    expect(res.status).toBe(200);
    expect(pushAttempts()).toHaveLength(0);
  });

  test('PUT /api/customers/:id — ลูกค้าที่มีใบเสนอราคาที่มาจากไลน์และยังเปิดอยู่ → ยังไม่ยิง push', async () => {
    await insertQuotation({ queueNo: '12' });

    const res = await request(app)
      .put(`/api/customers/${fixture.customerId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ customer_name: 'คุณทดสอบแก้ไขแล้ว', phone: '0899999999' });
    expect(res.status).toBe(200);
    expect(pushAttempts()).toHaveLength(0);
  });
});

