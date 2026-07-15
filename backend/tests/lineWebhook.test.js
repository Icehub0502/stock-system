const crypto = require('crypto');
const request = require('supertest');

// route อ่าน LINE_CHANNEL_SECRET จาก env ตอนรับ request — ต้องตั้งก่อนยิงเทสต์
// (.env.test ไม่มีค่านี้ และไม่มีเทสต์ไฟล์อื่นแตะ webhook จึงไม่รั่วไปกวนใคร)
const TEST_SECRET = 'test-line-channel-secret';
process.env.LINE_CHANNEL_SECRET = TEST_SECRET;

const { createApp } = require('../src/app');
const pool = require('../src/db/pool');

const app = createApp();

function sign(rawBody) {
  return crypto.createHmac('sha256', TEST_SECRET).update(rawBody).digest('base64');
}

function lineBody(text, messageId) {
  return JSON.stringify({
    destination: 'Utest',
    events: [
      {
        type: 'message',
        mode: 'active',
        timestamp: Date.now(),
        replyToken: 'test-reply-token',
        source: { type: 'group', groupId: 'Gtest' },
        message: { type: 'text', id: messageId, text },
      },
    ],
  });
}

function postWebhook(rawBody, signature = sign(rawBody)) {
  return request(app)
    .post('/api/line/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Line-Signature', signature)
    .send(rawBody);
}

describe('POST /api/line/webhook', () => {
  const createdCustomerIds = [];

  afterAll(async () => {
    for (const customerId of createdCustomerIds) {
      await pool.execute('DELETE FROM repair_notices WHERE customer_id = ?', [customerId]);
      const [quotations] = await pool.query('SELECT id FROM quotations WHERE customer_id = ?', [customerId]);
      for (const q of quotations) {
        await pool.execute('DELETE FROM quotation_items WHERE quotation_id = ?', [q.id]);
        await pool.execute('DELETE FROM quotations WHERE id = ?', [q.id]);
      }
      await pool.execute('DELETE FROM vehicles WHERE customer_id = ?', [customerId]);
      await pool.execute('DELETE FROM customers WHERE id = ?', [customerId]);
    }
    await pool.end();
  });

  test('ข้อความคิวที่ถูกต้อง → สร้างลูกค้า+รถ+ใบเสนอราคา(ไม่มีรายการ)+ใบแจ้งซ่อม', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `089${uniq}`; // 10 หลัก ไม่ซ้ำกับข้อมูลเดิมในฐานทดสอบ
    const text = `คิว 9\nคุณเทสไลน์\n${phone}\nToyota Vios\n5ทท4562\nเช็คช่วงล่าง`;

    const res = await postWebhook(lineBody(text, `msg-a-${uniq}`));
    expect(res.status).toBe(200);
    expect(res.body.created).toHaveLength(1);

    const [[quotation]] = await pool.query(
      'SELECT * FROM quotations WHERE quotation_no = ?',
      [res.body.created[0]]
    );
    expect(quotation).toBeTruthy();
    createdCustomerIds.push(quotation.customer_id);

    expect(quotation.queue_no).toBe('9');
    expect(quotation.symptom).toBe('เช็คช่วงล่าง');
    expect(quotation.status).toBe('pending');
    expect(Number(quotation.total_amount)).toBe(0);

    const [[customer]] = await pool.query('SELECT * FROM customers WHERE id = ?', [quotation.customer_id]);
    expect(customer.customer_name).toBe('คุณเทสไลน์');
    expect(customer.phone).toBe(phone);

    const [[vehicle]] = await pool.query('SELECT * FROM vehicles WHERE id = ?', [quotation.vehicle_id]);
    expect(vehicle.brand).toBe('Toyota');
    expect(vehicle.model).toBe('Vios');
    expect(vehicle.license_plate).toBe('5ทท4562');

    const [notices] = await pool.query('SELECT id FROM repair_notices WHERE quotation_id = ?', [quotation.id]);
    expect(notices).toHaveLength(1);
  });

  test('เบอร์โทรเดิมส่งคิวมาอีกครั้ง → ใช้ลูกค้าคนเดิม ไม่สร้างซ้ำ', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `088${uniq}`;

    const first = await postWebhook(
      lineBody(`คิว 1\nคุณลูกค้าประจำ\n${phone}\nHonda City\nเช็คเบรก`, `msg-b1-${uniq}`)
    );
    expect(first.body.created).toHaveLength(1);
    const [[q1]] = await pool.query('SELECT customer_id FROM quotations WHERE quotation_no = ?', [first.body.created[0]]);
    createdCustomerIds.push(q1.customer_id);

    const second = await postWebhook(
      lineBody(`คิว 2\nคุณลูกค้าประจำ\n${phone}\nเปลี่ยนโช้ค`, `msg-b2-${uniq}`)
    );
    expect(second.body.created).toHaveLength(1);
    const [[q2]] = await pool.query('SELECT customer_id FROM quotations WHERE quotation_no = ?', [second.body.created[0]]);

    expect(q2.customer_id).toBe(q1.customer_id);
  });

  test('LINE ส่งข้อความเดิมซ้ำ (retry, message id เดิม) → ไม่สร้างใบเสนอราคาซ้ำ', async () => {
    const uniq = Date.now().toString().slice(-7);
    const body = lineBody(`คิว 4\nคุณกันซ้ำ\n087${uniq}`, `msg-c-${uniq}`);

    const first = await postWebhook(body);
    expect(first.body.created).toHaveLength(1);
    const [[q]] = await pool.query('SELECT customer_id FROM quotations WHERE quotation_no = ?', [first.body.created[0]]);
    createdCustomerIds.push(q.customer_id);

    const retry = await postWebhook(body);
    expect(retry.status).toBe(200);
    expect(retry.body.created).toHaveLength(0);
  });

  test('แชตทั่วไปที่ไม่ใช่ข้อความคิว → 200 แต่ไม่สร้างอะไร', async () => {
    const res = await postWebhook(lineBody('พรุ่งนี้ร้านเปิดกี่โมงครับ', `msg-d-${Date.now()}`));
    expect(res.status).toBe(200);
    expect(res.body.created).toHaveLength(0);
  });

  test('ลายเซ็นไม่ถูกต้อง → 401 ไม่ประมวลผลอะไรเลย', async () => {
    const body = lineBody('คิว 5\nคุณปลอมลายเซ็น', `msg-e-${Date.now()}`);
    const res = await postWebhook(body, 'forged-signature');
    expect(res.status).toBe(401);
  });
});
