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
  // แคตาล็อกทดสอบของตัวเอง — ไม่พึ่งข้อมูลจริงที่ร้านกรอกไว้ (ฐานข้อมูลทดสอบ
  // แยกจากฐานข้อมูลจริง ไม่มี service_items ติดมาให้เลย) ตั้งชื่อ "ทดสอบ..." กัน
  // ชนกับของจริงและลบตัวเองออกได้สะอาดตอนจบ
  let regularItemId;
  let setItemId;

  beforeAll(async () => {
    const [warranty] = await pool.execute(
      'INSERT INTO warranties (warranty_name, warranty_year, warranty_month, warranty_km) VALUES (?, ?, ?, ?)',
      ['ทดสอบ ลูกหมาก 1 ปี', 1, 0, 100000]
    );
    const [regular] = await pool.execute(
      'INSERT INTO service_items (category, product_name, is_set) VALUES (?, ?, 0)',
      ['ค่าใช้จ่าย', 'ค่าแรง']
    );
    regularItemId = regular.insertId;
    const [set] = await pool.execute(
      'INSERT INTO service_items (category, product_name, warranty_id, is_set, set_price) VALUES (?, ?, ?, 1, ?)',
      ['ช่วงล่าง', 'ชุดโปรช่วงล่างเก๋ง', warranty.insertId, 6500]
    );
    setItemId = set.insertId;
  });

  afterAll(async () => {
    for (const customerId of createdCustomerIds) {
      await pool.execute('UPDATE repair_notices SET quotation_id = NULL WHERE customer_id = ?', [customerId]);
      const [quotations] = await pool.query('SELECT id FROM quotations WHERE customer_id = ?', [customerId]);
      for (const q of quotations) {
        await pool.execute('DELETE FROM quotation_items WHERE quotation_id = ?', [q.id]);
        await pool.execute('DELETE FROM quotations WHERE id = ?', [q.id]);
      }
      await pool.execute('DELETE FROM repair_notices WHERE customer_id = ?', [customerId]);
      await pool.execute('DELETE FROM vehicles WHERE customer_id = ?', [customerId]);
      await pool.execute('DELETE FROM customers WHERE id = ?', [customerId]);
    }
    await pool.execute('DELETE FROM service_items WHERE id IN (?, ?)', [regularItemId, setItemId]);
    await pool.execute("DELETE FROM warranties WHERE warranty_name = 'ทดสอบ ลูกหมาก 1 ปี'");
    await pool.end();
  });

  test('ข้อความ label:ค่า ครบทุกช่อง → สร้างลูกค้า+รถ+ใบเสนอราคา(วันที่ตามข้อความ)+ใบแจ้งซ่อม', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `089${uniq}`; // 10 หลัก ไม่ซ้ำกับข้อมูลเดิมในฐานทดสอบ
    const text = [
      'คิว:9',
      'วันที่:17/07/26',
      'ชื่อลูกค้า:คุณเทสไลน์',
      `เบอร์โทร:${phone}`,
      'ยี่ห้อรถ:Toyota รุ่นรถ:Vios',
      'ทะเบียนรถ:5ทท4562',
      'อาการ:เช็คช่วงล่าง',
    ].join('\n');

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
    expect(quotation.quotation_date).toBe('2026-07-17'); // pool ตั้ง dateStrings: true
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

  test('รายการที่พิมพ์มาตรงกับแคตาล็อกเป๊ะ → ผูกชื่อ/ประกันจากแคตาล็อก, ไม่ตรง → คงชื่อที่พิมพ์มา', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `081${uniq}`;
    // "ค่าแรง" ตรงกับ service_items ในหมวด "ค่าใช้จ่าย" แบบเป๊ะ (ไม่มีประกัน)
    // ส่วน "ซ่อมคอ" ไม่มีในแคตาล็อก ต้องคงชื่อเดิมไว้
    const text = [
      'คิว:9',
      'ชื่อลูกค้า:คุณรายการสินค้า',
      `เบอร์โทร:${phone}`,
      'ยี่ห้อรถ:Toyota รุ่นรถ:Vellfire',
      'ทะเบียนรถ:5กฒ63',
      'รายการ:',
      'ค่าแรง 2000',
      'ซ่อมคอ 3000',
    ].join('\n');

    const res = await postWebhook(lineBody(text, `msg-f-${uniq}`));
    expect(res.status).toBe(200);
    expect(res.body.created).toHaveLength(1);

    const [[quotation]] = await pool.query('SELECT * FROM quotations WHERE quotation_no = ?', [res.body.created[0]]);
    createdCustomerIds.push(quotation.customer_id);
    expect(Number(quotation.total_amount)).toBe(5000);
    expect(quotation.product_summary).toBe('ค่าแรง, ซ่อมคอ');

    const [items] = await pool.query(
      'SELECT product_name, quantity, unit_price, warranty_name FROM quotation_items WHERE quotation_id = ? ORDER BY id ASC',
      [quotation.id]
    );
    expect(items).toEqual([
      { product_name: 'ค่าแรง', quantity: 1, unit_price: '2000.00', warranty_name: null },
      { product_name: 'ซ่อมคอ', quantity: 1, unit_price: '3000.00', warranty_name: null },
    ]);
  });

  test('รายการ "ชุด" ไม่มีราคาในข้อความ → ดึง set_price จากแคตาล็อกมาใส่ให้ + ประกัน', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `082${uniq}`;
    const text = [
      'คิว:10',
      'ชื่อลูกค้า:คุณชุดโปร',
      `เบอร์โทร:${phone}`,
      'ทะเบียนรถ:5กฒ64',
      'รายการ:',
      'แร็ค 5500',
      'ชุดโปรช่วงล่าง เก๋ง',
      'หมายเหตุ:',
      'ลูกค้ามัดจำ 2000 บาท',
    ].join('\n');

    const res = await postWebhook(lineBody(text, `msg-g-${uniq}`));
    expect(res.body.created).toHaveLength(1);

    const [[quotation]] = await pool.query('SELECT * FROM quotations WHERE quotation_no = ?', [res.body.created[0]]);
    createdCustomerIds.push(quotation.customer_id);
    // 5500 (แร็ค) + 6500 (ชุดโปรช่วงล่างเก๋ง set_price ในแคตาล็อกทดสอบ)
    expect(Number(quotation.total_amount)).toBe(12000);
    expect(quotation.remark).toBe('ลูกค้ามัดจำ 2000 บาท');

    const [items] = await pool.query(
      'SELECT product_name, unit_price, warranty_name FROM quotation_items WHERE quotation_id = ? ORDER BY id ASC',
      [quotation.id]
    );
    expect(items[0]).toEqual({ product_name: 'แร็ค', unit_price: '5500.00', warranty_name: null });
    expect(items[1].product_name).toBe('ชุดโปรช่วงล่างเก๋ง');
    expect(Number(items[1].unit_price)).toBe(6500);
    expect(items[1].warranty_name).toBe('ทดสอบ ลูกหมาก 1 ปี');
  });

  test('เบอร์โทรเดิมส่งคิวมาอีกครั้ง → ใช้ลูกค้าคนเดิม ไม่สร้างซ้ำ', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `088${uniq}`;

    const first = await postWebhook(
      lineBody(`คิว:1\nชื่อลูกค้า:คุณลูกค้าประจำ\nเบอร์โทร:${phone}\nอาการ:เช็คเบรก`, `msg-b1-${uniq}`)
    );
    expect(first.body.created).toHaveLength(1);
    const [[q1]] = await pool.query('SELECT customer_id FROM quotations WHERE quotation_no = ?', [first.body.created[0]]);
    createdCustomerIds.push(q1.customer_id);

    const second = await postWebhook(
      lineBody(`คิว:2\nชื่อลูกค้า:คุณลูกค้าประจำ\nเบอร์โทร:${phone}\nอาการ:เปลี่ยนโช้ค`, `msg-b2-${uniq}`)
    );
    expect(second.body.created).toHaveLength(1);
    const [[q2]] = await pool.query('SELECT customer_id FROM quotations WHERE quotation_no = ?', [second.body.created[0]]);

    expect(q2.customer_id).toBe(q1.customer_id);
  });

  test('LINE ส่งข้อความเดิมซ้ำ (retry, message id เดิม) → ไม่สร้างใบเสนอราคาซ้ำ', async () => {
    const uniq = Date.now().toString().slice(-7);
    const body = lineBody(`คิว:4\nชื่อลูกค้า:คุณกันซ้ำ\nเบอร์โทร:087${uniq}`, `msg-c-${uniq}`);

    const first = await postWebhook(body);
    expect(first.body.created).toHaveLength(1);
    const [[q]] = await pool.query('SELECT customer_id FROM quotations WHERE quotation_no = ?', [first.body.created[0]]);
    createdCustomerIds.push(q.customer_id);

    const retry = await postWebhook(body);
    expect(retry.status).toBe(200);
    expect(retry.body.created).toHaveLength(0);
  });

  test('แชตทั่วไปที่ไม่มี label "คิว" → 200 แต่ไม่สร้างอะไร', async () => {
    const res = await postWebhook(lineBody('พรุ่งนี้ร้านเปิดกี่โมงครับ', `msg-d-${Date.now()}`));
    expect(res.status).toBe(200);
    expect(res.body.created).toHaveLength(0);
  });

  test('ลายเซ็นไม่ถูกต้อง → 401 ไม่ประมวลผลอะไรเลย', async () => {
    const body = lineBody('คิว:5\nชื่อลูกค้า:คุณปลอมลายเซ็น', `msg-e-${Date.now()}`);
    const res = await postWebhook(body, 'forged-signature');
    expect(res.status).toBe(401);
  });
});
