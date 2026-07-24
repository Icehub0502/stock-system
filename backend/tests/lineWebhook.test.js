const crypto = require('crypto');
const request = require('supertest');

// route อ่าน LINE_CHANNEL_SECRET จาก env ตอนรับ request — ต้องตั้งก่อนยิงเทสต์
// (.env.test ไม่มีค่านี้ และไม่มีเทสต์ไฟล์อื่นแตะ webhook จึงไม่รั่วไปกวนใคร)
const TEST_SECRET = 'test-line-channel-secret';
process.env.LINE_CHANNEL_SECRET = TEST_SECRET;

const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const lineWebhookRouter = require('../src/routes/lineWebhook.routes');
const parseLineQueueMessage = require('../src/utils/parseLineQueueMessage');
const helpers = require('./helpers'); // require ไว้ก่อน jest.resetModules() ใน describe ด้านล่าง กันดึงโมดูลใหม่ (pool ใหม่) มาซ้ำโดยไม่ตั้งใจ

const app = createApp();

function sign(rawBody) {
  return crypto.createHmac('sha256', TEST_SECRET).update(rawBody).digest('base64');
}

function messageEvent(text, messageId) {
  return {
    type: 'message',
    mode: 'active',
    timestamp: Date.now(),
    replyToken: 'test-reply-token',
    source: { type: 'group', groupId: 'Gtest' },
    message: { type: 'text', id: messageId, text },
  };
}

function unsendEvent(messageId) {
  return {
    type: 'unsend',
    mode: 'active',
    timestamp: Date.now(),
    source: { type: 'group', groupId: 'Gtest' },
    unsend: { messageId },
  };
}

function eventsBody(events) {
  return JSON.stringify({ destination: 'Utest', events });
}

// สร้างข้อความเทมเพลตแบบเต็ม — ให้ทดสอบเติมเฉพาะฟิลด์ที่ต้องใช้ ที่เหลือว่างไว้
// payment.confirm: true ต่อวลี "ชำระเงินเรียบร้อย" ท้ายข้อความ — สัญญาณปิดบิลจริง
// ในเทมเพลตใหม่ (กรอก "ลูกค้าชำระเงิน:" เฉย ๆ ไม่ปิดบิลเองอีกต่อไป) — อยู่นอก describe
// เพราะหลาย describe บล็อกในไฟล์นี้ใช้ร่วมกัน (ไม่ใช่แค่บล็อก "เทมเพลตใหม่" เดิม)
function templateText({ queueNo, name, phone, plate, items = [], payment = {} }) {
  const itemLines = items.map((it) => `${it.name} ${it.price}`);
  const lines = [
    `คิว ${queueNo}`,
    '18/07/69',
    `ชื่อ:${name}`,
    `เบอโทรศัพท์:${phone || ''}`,
    'ยี่ห้อรถ:',
    'รุ่นรถ:',
    `ทะเบียนรถ:${plate || ''}`,
    'สีรถ:',
    'เลขไมค์:',
    'อาการ:',
    'รายการ:',
    ...itemLines,
    '',
    '<--สิ้นสุดรายการ-->',
    `ยอดรวม:${payment.statedTotal ?? ''}`,
    `มัดจำ:${payment.deposit ?? ''}`,
    `หมายเหตุ:${payment.remark ?? ''}`,
    `ยอดที่ต้องชำระ:${payment.remainingBalance ?? ''}`,
    '',
    '<--ลูกค้าชำระเงิน-->',
    `ช่องทางการชำระ:${payment.method ?? ''}`,
    `ลูกค้าชำระเงิน:${payment.paidAmount ?? ''}`,
  ];
  if (payment.confirm) lines.push('ลูกค้าชำระเงินเรียบร้อย');
  return lines.join('\n');
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
      'INSERT INTO service_items (category, product_name, warranty_id, is_set) VALUES (?, ?, ?, 1)',
      ['ช่วงล่าง', 'ชุดโปรช่วงล่างเก๋ง', warranty.insertId]
    );
    setItemId = set.insertId;
    // ตรงกับโครงสร้างจริง: แถวแรก sort_order 0 เป็น "หัวข้อชุด" ราคาจะไปลงตรงนี้
    // แถวถัดไปเป็นรายการย่อย (อุปกรณ์ในชุด) ราคา 0 เสมอ
    await pool.execute(
      `INSERT INTO service_item_components (service_item_id, component_name, default_qty, sort_order) VALUES
       (?, 'ชุดโปรช่วงล่าง', 1, 0),
       (?, '- ปีกนกล่าง L+R', 1, 1),
       (?, '- ลูกหมากปีกนกล่าง L+R', 1, 2)`,
      [setItemId, setItemId, setItemId]
    );
  });

  afterAll(async () => {
    for (const customerId of createdCustomerIds) {
      await pool.execute('UPDATE repair_notices SET quotation_id = NULL WHERE customer_id = ?', [customerId]);
      const [quotations] = await pool.query('SELECT id FROM quotations WHERE customer_id = ?', [customerId]);
      for (const q of quotations) {
        await pool.execute('DELETE FROM quotation_items WHERE quotation_id = ?', [q.id]);
        await pool.execute('DELETE FROM quotations WHERE id = ?', [q.id]);
      }
      // ใบเสร็จที่ approve-sync ทดสอบสร้างไว้ (receipts.vehicle_id เป็น RESTRICT
      // ต้องลบก่อนลบ vehicles ด้านล่าง)
      const [receipts] = await pool.query('SELECT id FROM receipts WHERE customer_id = ?', [customerId]);
      for (const r of receipts) {
        await pool.execute('DELETE FROM receipt_items WHERE receipt_id = ?', [r.id]);
        await pool.execute('DELETE FROM receipts WHERE id = ?', [r.id]);
      }
      await pool.execute('DELETE FROM repair_notices WHERE customer_id = ?', [customerId]);
      await pool.execute('DELETE FROM vehicles WHERE customer_id = ?', [customerId]);
      await pool.execute('DELETE FROM customers WHERE id = ?', [customerId]);
    }
    await pool.execute('DELETE FROM service_item_components WHERE service_item_id = ?', [setItemId]);
    await pool.execute('DELETE FROM service_items WHERE id IN (?, ?)', [regularItemId, setItemId]);
    await pool.execute("DELETE FROM warranties WHERE warranty_name = 'ทดสอบ ลูกหมาก 1 ปี'");
    await pool.end();
  });

  test('Pattern 1 (รับรถ) → สร้างลูกค้า+รถ+ใบเสนอราคา(วันนี้ ไม่มีรายการ) แต่ยังไม่สร้างใบแจ้งซ่อม', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `089${uniq}`; // 10 หลัก ไม่ซ้ำกับข้อมูลเดิมในฐานทดสอบ
    const text = [
      'คิว:9',
      'วันที่:17/07/26', // ไม่ถูกใช้ — quotation_date ต้องเป็นวันนี้เสมอ
      'ชื่อลูกค้า:คุณเทสไลน์',
      `เบอร์โทร:${phone}`,
      'ยี่ห้อรถ:Toyota รุ่นรถ:Vios',
      'ทะเบียนรถ:5ทท4562',
      'อาการ:เช็คช่วงล่าง',
    ].join('\n');

    const res = await postWebhook(eventsBody([messageEvent(text, `msg-a-${uniq}`)]));
    expect(res.status).toBe(200);
    expect(res.body.created).toHaveLength(1);

    const [[quotation]] = await pool.query(
      'SELECT * FROM quotations WHERE quotation_no = ?',
      [res.body.created[0]]
    );
    expect(quotation).toBeTruthy();
    createdCustomerIds.push(quotation.customer_id);

    expect(quotation.queue_no).toBe('9');
    const today = new Date();
    const expectedDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(quotation.quotation_date).toBe(expectedDate); // pool ตั้ง dateStrings: true
    expect(quotation.symptom).toBe('เช็คช่วงล่าง');
    expect(quotation.status).toBe('pending');
    expect(Number(quotation.total_amount)).toBe(0);

    const [[customer]] = await pool.query('SELECT * FROM customers WHERE id = ?', [quotation.customer_id]);
    expect(customer.customer_name).toBe('คุณเทสไลน์');
    expect(customer.phone).toBe(`${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`);

    const [[vehicle]] = await pool.query('SELECT * FROM vehicles WHERE id = ?', [quotation.vehicle_id]);
    expect(vehicle.brand).toBe('Toyota');
    expect(vehicle.model).toBe('Vios');
    expect(vehicle.license_plate).toBe('5ทท4562');

    // ไม่สร้างใบแจ้งซ่อมทันที — รอถึงตอนกดอนุมัติในแอปก่อน
    const [notices] = await pool.query('SELECT id FROM repair_notices WHERE quotation_id = ?', [quotation.id]);
    expect(notices).toHaveLength(0);
  });

  test('pattern มีสี+เลขไมล์ (ไม่มีทะเบียน) → เก็บลงรถ+ใบเสนอราคา, ส่งซ้ำไม่สร้างรถซ้ำ', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `087${uniq}`;
    const text = `คิว14\nชื่อลูกค้า:คุณทดสอบสิบ\nเบอร์โทร:${phone}\nยี่ห้อรถ:Toyota รุ่นรถ:Altis 09\nสีรถ:ทอง\nเลขไมล์:215170\nอาการ:ขับมีเสียงดัง ก๊อกๆ`;

    const res = await postWebhook(eventsBody([messageEvent(text, `msg-cm1-${uniq}`)]));
    expect(res.status).toBe(200);
    expect(res.body.created).toHaveLength(1);

    const [[quotation]] = await pool.query('SELECT * FROM quotations WHERE quotation_no = ?', [res.body.created[0]]);
    createdCustomerIds.push(quotation.customer_id);
    expect(quotation.mileage).toBe(215170);
    expect(quotation.symptom).toBe('ขับมีเสียงดัง ก๊อกๆ');

    const [[vehicle]] = await pool.query('SELECT * FROM vehicles WHERE id = ?', [quotation.vehicle_id]);
    expect(vehicle.brand).toBe('Toyota');
    expect(vehicle.model).toBe('Altis 09');
    expect(vehicle.color).toBe('ทอง');
    expect(vehicle.mileage).toBe(215170);

    // ส่งซ้ำ (แก้เลขไมล์) — ต้องอัปเดตรถคันเดิม (เทียบยี่ห้อ+รุ่น เพราะไม่มีทะเบียน)
    // ไม่สร้างรถใหม่ และเลขไมล์ต้องเป็นค่าล่าสุด
    const res2 = await postWebhook(
      eventsBody([messageEvent(`คิว14\nชื่อลูกค้า:คุณทดสอบสิบ\nเบอร์โทร:${phone}\nยี่ห้อรถ:Toyota รุ่นรถ:Altis 09\nสีรถ:ทอง\nเลขไมล์:215500\nอาการ:ขับมีเสียงดัง ก๊อกๆ`, `msg-cm2-${uniq}`)])
    );
    expect(res2.status).toBe(200);

    const [vehicles] = await pool.query('SELECT id, mileage FROM vehicles WHERE customer_id = ?', [quotation.customer_id]);
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].mileage).toBe(215500);
  });

  test('รายการ "1700*2 3,400" → quantity 2 + unit_price 1700 ลงใบเสนอราคา ยอดรวมถูก', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `090${uniq}`;
    const text = `คิว15\nชื่อลูกค้า:คุณทดสอบสิบสาม\nเบอร์โทร:${phone}\nรายการ:\nลูกปืนล้อหน้า L+R 1700*2 3,400\nซ่อมคอ 2000`;

    const res = await postWebhook(eventsBody([messageEvent(text, `msg-qty1-${uniq}`)]));
    expect(res.status).toBe(200);
    expect(res.body.created).toHaveLength(1);

    const [[quotation]] = await pool.query('SELECT * FROM quotations WHERE quotation_no = ?', [res.body.created[0]]);
    createdCustomerIds.push(quotation.customer_id);
    expect(Number(quotation.total_amount)).toBe(5400);

    const [items] = await pool.query(
      'SELECT product_name, quantity, unit_price FROM quotation_items WHERE quotation_id = ? ORDER BY id ASC',
      [quotation.id]
    );
    expect(items).toEqual([
      { product_name: 'ลูกปืนล้อหน้า L+R', quantity: 2, unit_price: '1700.00' },
      { product_name: 'ซ่อมคอ', quantity: 1, unit_price: '2000.00' },
    ]);
  });

  test('Pattern 2 (เสนอราคา) — รายการขึ้นต้นด้วย "-" ผูกแคตาล็อกได้, ไม่ตรง → คงชื่อที่พิมพ์มา', async () => {
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
      ' - ค่าแรง 2000',
      ' - ซ่อมคอ 3000',
    ].join('\n');

    const res = await postWebhook(eventsBody([messageEvent(text, `msg-f-${uniq}`)]));
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

  test('รายการ "ชุด" มีราคาในข้อความ → ขยายเป็นหลายแถวตาม service_item_components เหมือนเลือกในแอปเอง', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `082${uniq}`;
    const text = [
      'คิว:10',
      'ชื่อลูกค้า:คุณชุดโปร',
      `เบอร์โทร:${phone}`,
      'ทะเบียนรถ:5กฒ64',
      'รายการ:',
      ' - แร็ค 5500',
      ' - ชุดโปรช่วงล่าง เก๋ง 7500',
    ].join('\n');

    const res = await postWebhook(eventsBody([messageEvent(text, `msg-g-${uniq}`)]));
    expect(res.body.created).toHaveLength(1);

    const [[quotation]] = await pool.query('SELECT * FROM quotations WHERE quotation_no = ?', [res.body.created[0]]);
    createdCustomerIds.push(quotation.customer_id);
    expect(Number(quotation.total_amount)).toBe(13000); // 5500 + 7500 (แถวย่อยของชุดราคา 0 ทุกแถว)

    const [items] = await pool.query(
      'SELECT product_name, unit_price, warranty_name FROM quotation_items WHERE quotation_id = ? ORDER BY id ASC',
      [quotation.id]
    );
    expect(items).toHaveLength(4); // แร็ค 1 แถว + ชุดขยายเป็น 3 แถว (หัวข้อ + อุปกรณ์ย่อย 2 ชิ้น)
    expect(items[0]).toEqual({ product_name: 'แร็ค', unit_price: '5500.00', warranty_name: null });
    // แถวแรกของชุด (หัวข้อ) ราคาที่พิมพ์มาอยู่ตรงนี้ ชื่อมาจาก service_item_components ตรง ๆ (ไม่มีคำเก๋ง/กระบะ)
    expect(items[1]).toEqual({ product_name: 'ชุดโปรช่วงล่าง', unit_price: '7500.00', warranty_name: 'ทดสอบ ลูกหมาก 1 ปี' });
    // แถวย่อย (อุปกรณ์ในชุด) ราคา 0 ทุกแถว แต่ได้ประกันเดียวกันทุกแถว
    expect(items[2]).toEqual({ product_name: '- ปีกนกล่าง L+R', unit_price: '0.00', warranty_name: 'ทดสอบ ลูกหมาก 1 ปี' });
    expect(items[3]).toEqual({ product_name: '- ลูกหมากปีกนกล่าง L+R', unit_price: '0.00', warranty_name: 'ทดสอบ ลูกหมาก 1 ปี' });
  });

  test('รายการ "ชุด" ไม่มีราคาในข้อความ → ทุกแถวราคา 0 เสมอ (ไม่ดึงราคาจากแคตาล็อกมาเดา)', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `092${uniq}`;
    const text = [
      'คิว:14',
      'ชื่อลูกค้า:คุณไม่ใส่ราคา',
      `เบอร์โทร:${phone}`,
      'รายการ:',
      ' - ชุดโปรช่วงล่าง เก๋ง',
    ].join('\n');

    const res = await postWebhook(eventsBody([messageEvent(text, `msg-noprice-${uniq}`)]));
    const [[quotation]] = await pool.query('SELECT * FROM quotations WHERE quotation_no = ?', [res.body.created[0]]);
    createdCustomerIds.push(quotation.customer_id);
    expect(Number(quotation.total_amount)).toBe(0);

    const [items] = await pool.query('SELECT unit_price FROM quotation_items WHERE quotation_id = ?', [quotation.id]);
    expect(items).toHaveLength(3);
    expect(items.every((it) => Number(it.unit_price) === 0)).toBe(true);
  });

  test('บรรทัด "-" ต่อจาก "ชุด" ที่ชื่อตรงกับรายการย่อยในชุด → แทนที่แถวนั้นแทนที่จะเพิ่มแถวใหม่ (วงเล็บ = ยี่ห้อ ราคาต่อท้ายนอกวงเล็บ)', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `087${uniq}`;
    const text = [
      'คิว:15',
      'ชื่อลูกค้า:คุณแทนที่ย่อย',
      `เบอร์โทร:${phone}`,
      'รายการ:',
      ' - ชุดโปรช่วงล่าง เก๋ง 7500',
      '- ลูกหมากปีกนกล่าง (555) 200',
    ].join('\n');

    const res = await postWebhook(eventsBody([messageEvent(text, `msg-subitem-${uniq}`)]));
    expect(res.body.created).toHaveLength(1);

    const [[quotation]] = await pool.query('SELECT * FROM quotations WHERE quotation_no = ?', [res.body.created[0]]);
    createdCustomerIds.push(quotation.customer_id);
    expect(Number(quotation.total_amount)).toBe(7700); // 7500 (ชุด) + 200 (บวกเข้ารายการย่อยที่จับคู่ได้) ไม่ใช่แถวใหม่แยก

    const [items] = await pool.query(
      'SELECT product_name, unit_price FROM quotation_items WHERE quotation_id = ? ORDER BY id ASC',
      [quotation.id]
    );
    expect(items).toHaveLength(3); // ยังคง 3 แถวเท่าเดิม (หัวข้อ + อุปกรณ์ย่อย 2 ชิ้น) ไม่เพิ่มเป็น 4
    expect(items[0]).toEqual({ product_name: 'ชุดโปรช่วงล่าง', unit_price: '7500.00' });
    expect(items[1]).toEqual({ product_name: '- ปีกนกล่าง L+R', unit_price: '0.00' }); // ไม่ตรงชื่อ ไม่ถูกแตะ
    expect(items[2]).toEqual({ product_name: 'ลูกหมากปีกนกล่าง (555)', unit_price: '200.00' }); // ถูกแทนที่ชื่อ (คงยี่ห้อในวงเล็บ) + ราคา
  });

  test('บรรทัด "-" ที่มีวงเล็บยี่ห้อแต่ไม่ใส่ราคา → นับเป็น 0', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `089${uniq}`;
    const text = [
      'คิว:17',
      'ชื่อลูกค้า:คุณไม่ใส่ราคาย่อย',
      `เบอร์โทร:${phone}`,
      'รายการ:',
      ' - ชุดโปรช่วงล่าง เก๋ง 7500',
      '- ลูกหมากปีกนกล่าง (555)',
    ].join('\n');

    const res = await postWebhook(eventsBody([messageEvent(text, `msg-subitem-noprice-${uniq}`)]));
    const [[quotation]] = await pool.query('SELECT * FROM quotations WHERE quotation_no = ?', [res.body.created[0]]);
    createdCustomerIds.push(quotation.customer_id);
    expect(Number(quotation.total_amount)).toBe(7500); // ไม่ใส่ราคาต่อท้ายวงเล็บ = 0

    const [items] = await pool.query(
      'SELECT product_name, unit_price FROM quotation_items WHERE quotation_id = ? ORDER BY id ASC',
      [quotation.id]
    );
    expect(items).toHaveLength(3);
    expect(items[2]).toEqual({ product_name: 'ลูกหมากปีกนกล่าง (555)', unit_price: '0.00' });
  });

  test('บรรทัด "-" ที่ไม่ตรงกับรายการย่อยในชุดไหนเลย → ตกไปเป็นรายการแยกตามปกติ', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `088${uniq}`;
    const text = [
      'คิว:16',
      'ชื่อลูกค้า:คุณไม่ตรงย่อย',
      `เบอร์โทร:${phone}`,
      'รายการ:',
      ' - ชุดโปรช่วงล่าง เก๋ง 7500',
      '- น็อตพิเศษ (ตราช้าง) 100',
    ].join('\n');

    const res = await postWebhook(eventsBody([messageEvent(text, `msg-subitem-nomatch-${uniq}`)]));
    const [[quotation]] = await pool.query('SELECT * FROM quotations WHERE quotation_no = ?', [res.body.created[0]]);
    createdCustomerIds.push(quotation.customer_id);
    expect(Number(quotation.total_amount)).toBe(7600); // 7500 + 100 แยกกันคนละแถว

    const [items] = await pool.query(
      'SELECT product_name, unit_price FROM quotation_items WHERE quotation_id = ? ORDER BY id ASC',
      [quotation.id]
    );
    expect(items).toHaveLength(4); // หัวข้อ + อุปกรณ์ย่อย 2 ชิ้น + แถวใหม่ที่ไม่ตรงกับใคร
    expect(items[3]).toEqual({ product_name: 'น็อตพิเศษ (ตราช้าง)', unit_price: '100.00' });
  });

  test('พิมพ์ข้อความคิว+ลูกค้าเดิมซ้ำ (วันเดียวกัน ยังไม่อนุมัติ) → แก้ไขใบเดิม ไม่เปิดใบใหม่', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `085${uniq}`;

    const first = await postWebhook(
      eventsBody([messageEvent(`คิว:20\nชื่อลูกค้า:คุณซ้ำ\nเบอร์โทร:${phone}\nทะเบียนรถ:5กฒ70`, `msg-dup1-${uniq}`)])
    );
    expect(first.body.created).toHaveLength(1);
    const firstNo = first.body.created[0];
    const [[q1]] = await pool.query('SELECT id, customer_id FROM quotations WHERE quotation_no=?', [firstNo]);
    createdCustomerIds.push(q1.customer_id);

    // ข้อความที่สอง — คิว/ลูกค้าเดิมเป๊ะ แต่คราวนี้เติมรายการเข้ามา (จำลองการคัดลอก
    // ข้อความเดิมมาต่อ "รายการ:" ทีหลัง)
    const second = await postWebhook(
      eventsBody([messageEvent(
        `คิว:20\nชื่อลูกค้า:คุณซ้ำ\nเบอร์โทร:${phone}\nทะเบียนรถ:5กฒ70\nรายการ:\nค่าแรง 2000`,
        `msg-dup2-${uniq}`
      )])
    );
    expect(second.body.created).toHaveLength(1);
    expect(second.body.created[0]).toBe(firstNo); // ใบเลขเดิม ไม่ใช่ใบใหม่

    const [quotations] = await pool.query('SELECT id FROM quotations WHERE customer_id = ?', [q1.customer_id]);
    expect(quotations).toHaveLength(1); // ยังมีใบเดียว ไม่ซ้อน

    const [items] = await pool.query('SELECT product_name FROM quotation_items WHERE quotation_id = ?', [q1.id]);
    expect(items).toEqual([{ product_name: 'ค่าแรง' }]);
  });

  test('พิมพ์ข้อความคิว+ลูกค้าเดิมซ้ำ หลังใบเสนอราคาอนุมัติไปแล้ว → แก้ไขใบเดิม (ไม่เปิดใบใหม่) และ sync ใบเสร็จที่ผูกอยู่ด้วย', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `085${uniq}`;

    const first = await postWebhook(
      eventsBody([messageEvent(`คิว:21\nชื่อลูกค้า:คุณอนุมัติแล้ว\nเบอร์โทร:${phone}\nทะเบียนรถ:5กฒ71\nรายการ:\nค่าแรง 2000`, `msg-appr1-${uniq}`)])
    );
    expect(first.body.created).toHaveLength(1);
    const firstNo = first.body.created[0];
    const [[q1]] = await pool.query('SELECT id, customer_id, vehicle_id, total_amount FROM quotations WHERE quotation_no=?', [firstNo]);
    createdCustomerIds.push(q1.customer_id);

    // จำลองการกด "อนุมัติ" บนเว็บ — สร้างใบเสร็จผูกไว้ แล้วตั้งสถานะเป็นอนุมัติแล้ว
    const [receiptResult] = await pool.query(
      `INSERT INTO receipts (receipt_no, receipt_date, customer_id, vehicle_id, mileage, remark, total_amount)
       VALUES (?, CURDATE(), ?, ?, 0, NULL, ?)`,
      [`RC-TEST-${uniq}`, q1.customer_id, q1.vehicle_id, q1.total_amount]
    );
    const receiptId = receiptResult.insertId;
    await pool.query(
      `INSERT INTO receipt_items (receipt_id, service_item_id, product_name_snapshot, qty, price, amount)
       VALUES (?, NULL, 'ค่าแรง', 1, 2000, 2000)`,
      [receiptId]
    );
    await pool.query("UPDATE quotations SET status = 'approved', converted_receipt_id = ? WHERE id = ?", [receiptId, q1.id]);

    // ข้อความที่สอง — คิว/ลูกค้าเดิมเป๊ะ แต่เปลี่ยนราคา (จำลองพนักงานพิมพ์แก้ไขรายการ
    // หลังอนุมัติไปแล้ว โดยไม่มีคำว่า "ชำระเงินเรียบร้อย/แล้ว")
    const second = await postWebhook(
      eventsBody([messageEvent(
        `คิว:21\nชื่อลูกค้า:คุณอนุมัติแล้ว\nเบอร์โทร:${phone}\nทะเบียนรถ:5กฒ71\nรายการ:\nค่าแรง 3500`,
        `msg-appr2-${uniq}`
      )])
    );
    expect(second.body.created).toHaveLength(1);
    expect(second.body.created[0]).toBe(firstNo); // ใบเลขเดิม ไม่ใช่ใบใหม่ แม้อนุมัติไปแล้ว

    const [quotations] = await pool.query('SELECT id, status, total_amount FROM quotations WHERE customer_id = ?', [q1.customer_id]);
    expect(quotations).toHaveLength(1); // ยังมีใบเดียว ไม่ซ้อน
    expect(quotations[0].status).toBe('approved'); // สถานะอนุมัติยังคงอยู่
    expect(Number(quotations[0].total_amount)).toBe(3500);

    const [[receiptAfter]] = await pool.query('SELECT total_amount FROM receipts WHERE id = ?', [receiptId]);
    expect(Number(receiptAfter.total_amount)).toBe(3500); // ใบเสร็จที่ผูกไว้ถูกแก้ตามด้วย

    const [receiptItemsAfter] = await pool.query('SELECT product_name_snapshot, price FROM receipt_items WHERE receipt_id = ?', [receiptId]);
    expect(receiptItemsAfter).toEqual([{ product_name_snapshot: 'ค่าแรง', price: '3500.00' }]);
  });

  test('เลขคิวไม่ชนกับใคร → ไม่มีการเปลี่ยนเลขคิว (requested_queue_no ว่าง) เหมือนเดิมทุกประการ', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `073${uniq}`;
    const queueNo = `6${uniq}`; // เลขคิวเฉพาะเทสต์นี้ ไม่ชนกับใคร

    const res = await postWebhook(
      eventsBody([messageEvent(`คิว:${queueNo}\nชื่อลูกค้า:คุณทดสอบห้า\nเบอร์โทร:${phone}`, `msg-noclash-${uniq}`)])
    );
    expect(res.body.created).toHaveLength(1);

    const [[q]] = await pool.query('SELECT customer_id, queue_no, requested_queue_no FROM quotations WHERE quotation_no=?', [res.body.created[0]]);
    createdCustomerIds.push(q.customer_id);
    expect(q.queue_no).toBe(queueNo); // ไม่ถูกเปลี่ยน
    expect(q.requested_queue_no).toBeNull();
  });

  test('เลขคิวชนกับของลูกค้าคนอื่นในวันเดียวกัน → เปลี่ยนอัตโนมัติเป็นเลขถัดไปที่ว่าง และลูกค้าคนเดิมพิมพ์เลขคิวเดิมซ้ำ → แก้ไขใบที่ถูกเปลี่ยนเลขแล้ว ไม่เปิดใบใหม่ซ้อน', async () => {
    const uniq = Date.now().toString().slice(-7);
    const sharedQueue = `7${uniq}`; // เลขคิวใหญ่พอที่จะเป็นค่ามากสุดของวันนี้เสมอ กันชนกับเทสต์อื่นที่ใช้เลขคิวหลักเดียว/สองหลัก
    const phoneA = `074${uniq}`;
    const phoneB = `075${uniq}`;

    // ลูกค้า A พิมพ์คิวนี้ก่อน — ได้เลขคิวตามที่พิมพ์มาปกติ (ยังไม่มีใครชน)
    const firstRes = await postWebhook(
      eventsBody([messageEvent(`คิว:${sharedQueue}\nชื่อลูกค้า:คุณทดสอบหก\nเบอร์โทร:${phoneA}`, `msg-clash1-${uniq}`)])
    );
    expect(firstRes.body.created).toHaveLength(1);
    const [[q1]] = await pool.query('SELECT id, customer_id, queue_no FROM quotations WHERE quotation_no=?', [firstRes.body.created[0]]);
    createdCustomerIds.push(q1.customer_id);
    expect(q1.queue_no).toBe(sharedQueue);

    // ลูกค้า B พิมพ์เลขคิวเดียวกัน (คนละเบอร์/ชื่อ) วันเดียวกัน → ต้องชนแล้วเปลี่ยนให้อัตโนมัติ
    const secondRes = await postWebhook(
      eventsBody([messageEvent(`คิว:${sharedQueue}\nชื่อลูกค้า:คุณทดสอบเจ็ด\nเบอร์โทร:${phoneB}`, `msg-clash2-${uniq}`)])
    );
    expect(secondRes.body.created).toHaveLength(1);
    const [[q2]] = await pool.query(
      'SELECT id, customer_id, queue_no, requested_queue_no FROM quotations WHERE quotation_no=?',
      [secondRes.body.created[0]]
    );
    createdCustomerIds.push(q2.customer_id);

    expect(q2.queue_no).not.toBe(sharedQueue); // เปลี่ยนไปแล้ว ไม่ใช่เลขที่พิมพ์มา
    expect(Number(q2.queue_no)).toBe(Number(sharedQueue) + 1); // เลขคิวถัดไปที่ว่าง (sharedQueue เป็นค่ามากสุดของวันนี้ก่อนหน้านี้)
    expect(q2.requested_queue_no).toBe(sharedQueue); // เก็บเลขที่พิมพ์มาจริงไว้ด้วย

    // ข้อความตอบต้องมีคำเตือนเรื่องเปลี่ยนคิวอัตโนมัติ
    const replyText = lineWebhookRouter.buildSuccessReplyText(
      { queue_no: sharedQueue, customer_name: 'คุณทดสอบเจ็ด', license_plate: null, stated_total: null },
      {
        quotation_no: secondRes.body.created[0],
        itemCount: 0,
        totalAmount: 0,
        hasNote: false,
        isUpdate: false,
        reassignedFrom: sharedQueue,
        reassignedTo: q2.queue_no,
      }
    );
    expect(replyText).toContain(`คิวที่ ${sharedQueue} มีแล้ววันนี้ เปลี่ยนเป็นคิว ${q2.queue_no} ให้อัตโนมัติ`);

    // ลูกค้า B พิมพ์เลขคิว "เดิมที่เคยพิมพ์" (sharedQueue) ซ้ำอีกครั้ง — ต้องหมายถึง
    // แก้ไขใบที่ถูกเปลี่ยนเลขไปแล้ว ไม่ใช่เปิดใบใหม่ซ้อน (แม้ queue_no จริงจะไม่ตรงกับ
    // ที่พิมพ์มาแล้วก็ตาม เพราะจับคู่ผ่าน requested_queue_no ได้)
    const thirdRes = await postWebhook(
      eventsBody([messageEvent(
        `คิว:${sharedQueue}\nชื่อลูกค้า:คุณทดสอบเจ็ด\nเบอร์โทร:${phoneB}\nรายการ:\nค่าแรง 2000`,
        `msg-clash3-${uniq}`
      )])
    );
    expect(thirdRes.body.created).toHaveLength(1);
    expect(thirdRes.body.created[0]).toBe(secondRes.body.created[0]); // ใบเลขเดิม (ที่ถูกเปลี่ยนคิวไปแล้ว) ไม่ใช่ใบใหม่

    const [quotationsForB] = await pool.query('SELECT id, queue_no FROM quotations WHERE customer_id = ?', [q2.customer_id]);
    expect(quotationsForB).toHaveLength(1); // ยังมีใบเดียว ไม่ซ้อน
    expect(quotationsForB[0].queue_no).toBe(q2.queue_no); // queue_no จริงยังเป็นเลขที่ถูกเปลี่ยนไว้ ไม่เปลี่ยนกลับ
  });

  test('งานค้างข้ามวัน: ลูกค้าเดิมพิมพ์เลขคิวเดิมซ้ำในวันถัดไป (ใบเดิมยัง pending) → แก้ไขใบเดิม ไม่เปิดใบใหม่/ไม่ชนคิว', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `076${uniq}`;
    const queueNo = `8${uniq}`; // เลขคิวเฉพาะเทสต์นี้ ไม่ชนกับเทสต์อื่น

    const first = await postWebhook(
      eventsBody([messageEvent(`คิว:${queueNo}\nชื่อลูกค้า:คุณข้ามวัน\nเบอร์โทร:${phone}\nทะเบียนรถ:5กฒ80`, `msg-crossday1-${uniq}`)])
    );
    expect(first.body.created).toHaveLength(1);
    const firstNo = first.body.created[0];
    const [[q1]] = await pool.query('SELECT id, customer_id FROM quotations WHERE quotation_no=?', [firstNo]);
    createdCustomerIds.push(q1.customer_id);

    // จำลองใบนี้ถูกสร้างไว้ตั้งแต่เมื่อวาน (งานซ่อมยังไม่เสร็จข้ามวัน) — เว็บ/แอปไม่มีทาง
    // แก้ quotation_date ได้ตรง ๆ ผ่าน webhook จึง UPDATE ตรงในฐานข้อมูลจำลองสถานการณ์นี้
    await pool.execute('UPDATE quotations SET quotation_date = DATE_SUB(CURDATE(), INTERVAL 1 DAY) WHERE id = ?', [q1.id]);

    // วันนี้ พนักงานพิมพ์เลขคิวเดิมซ้ำเพื่อเติมรายการเข้าใบเดิม
    const second = await postWebhook(
      eventsBody([messageEvent(
        `คิว:${queueNo}\nชื่อลูกค้า:คุณข้ามวัน\nเบอร์โทร:${phone}\nทะเบียนรถ:5กฒ80\nรายการ:\nค่าแรง 2000`,
        `msg-crossday2-${uniq}`
      )])
    );
    expect(second.body.created).toHaveLength(1);
    expect(second.body.created[0]).toBe(firstNo); // ใบเลขเดิม ไม่ใช่ใบใหม่

    const [quotations] = await pool.query('SELECT id, queue_no, requested_queue_no FROM quotations WHERE customer_id = ?', [q1.customer_id]);
    expect(quotations).toHaveLength(1); // ยังมีใบเดียว ไม่ซ้อน
    expect(quotations[0].queue_no).toBe(queueNo); // ไม่ถูกเปลี่ยนคิว (ไม่ใช่การชนคิว)
    expect(quotations[0].requested_queue_no).toBeNull(); // ไม่มีการ reassign เกิดขึ้น

    const [items] = await pool.query('SELECT product_name FROM quotation_items WHERE quotation_id = ?', [q1.id]);
    expect(items).toEqual([{ product_name: 'ค่าแรง' }]); // รายการถูกใส่ในใบเดิม
  });

  test('เลขคิวชนกับของลูกค้าคนอื่นในวันเดียวกัน (คนละลูกค้าโดยสิ้นเชิง คนละคิวของตัวเองไม่ค้าง) → ยังคงเปลี่ยนอัตโนมัติเป็นเลขถัดไปเหมือนเดิม ไม่ regress จากการแก้ query ด้านบน', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phoneA = `077${uniq}`;
    const phoneB = `078${uniq}`;
    const queueNo = `9${uniq}`;

    // ลูกค้า A เปิดใบวันนี้ ยังไม่เสร็จ (pending)
    const firstRes = await postWebhook(
      eventsBody([messageEvent(`คิว:${queueNo}\nชื่อลูกค้า:คุณเจ้าของคิว\nเบอร์โทร:${phoneA}`, `msg-crossclash1-${uniq}`)])
    );
    expect(firstRes.body.created).toHaveLength(1);
    const [[qA]] = await pool.query('SELECT id, customer_id, queue_no FROM quotations WHERE quotation_no=?', [firstRes.body.created[0]]);
    createdCustomerIds.push(qA.customer_id);

    // ลูกค้า B (คนละคนโดยสิ้นเชิง ไม่เคยมีใบเดิม) พิมพ์เลขคิวเดียวกันวันนี้ — การแก้ lookup
    // ให้มองย้อนหลัง 14 วันสำหรับ customer_id เดียวกัน ต้องไม่กระทบ path การชนคิวของ
    // ลูกค้าคนอื่นเลย ยังต้องเปลี่ยนอัตโนมัติเป็นเลขถัดไปเหมือนเดิมทุกประการ
    const secondRes = await postWebhook(
      eventsBody([messageEvent(`คิว:${queueNo}\nชื่อลูกค้า:คุณคนใหม่\nเบอร์โทร:${phoneB}`, `msg-crossclash2-${uniq}`)])
    );
    expect(secondRes.body.created).toHaveLength(1);
    const [[qB]] = await pool.query(
      'SELECT id, customer_id, queue_no, requested_queue_no FROM quotations WHERE quotation_no=?',
      [secondRes.body.created[0]]
    );
    createdCustomerIds.push(qB.customer_id);

    expect(qB.queue_no).not.toBe(queueNo); // เปลี่ยนไปแล้ว ไม่ใช่เลขที่พิมพ์มา
    expect(qB.requested_queue_no).toBe(queueNo); // เก็บเลขที่พิมพ์มาจริงไว้
  });

  test('ใบเดิมเลยกำหนด 14 วัน (pending ค้างนาน) → ไม่ถือว่าเป็นการแก้ไข เปิดใบใหม่แทน', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `079${uniq}`;
    const queueNo = `6${uniq}`;

    const first = await postWebhook(
      eventsBody([messageEvent(`คิว:${queueNo}\nชื่อลูกค้า:คุณลืมไปนาน\nเบอร์โทร:${phone}`, `msg-stale1-${uniq}`)])
    );
    expect(first.body.created).toHaveLength(1);
    const firstNo = first.body.created[0];
    const [[q1]] = await pool.query('SELECT id, customer_id FROM quotations WHERE quotation_no=?', [firstNo]);
    createdCustomerIds.push(q1.customer_id);

    // ใบนี้ถูกลืมไว้เกิน 14 วัน (ยัง pending ค้างอยู่จริง แต่เก่าเกินกว่าจะถือว่าเป็นงานเดิม)
    await pool.execute('UPDATE quotations SET quotation_date = DATE_SUB(CURDATE(), INTERVAL 15 DAY) WHERE id = ?', [q1.id]);

    const second = await postWebhook(
      eventsBody([messageEvent(`คิว:${queueNo}\nชื่อลูกค้า:คุณลืมไปนาน\nเบอร์โทร:${phone}`, `msg-stale2-${uniq}`)])
    );
    expect(second.body.created).toHaveLength(1);
    expect(second.body.created[0]).not.toBe(firstNo); // ใบใหม่ ไม่ใช่ใบเดิมที่ค้างเกิน 14 วัน

    const [quotations] = await pool.query('SELECT id FROM quotations WHERE customer_id = ?', [q1.customer_id]);
    expect(quotations).toHaveLength(2); // สองใบแยกกัน
  });

  test('ยอดที่ร้านแจ้งมาเอง ("รวม") ตรงกับผลรวมจริง → ข้อความตอบไม่มีคำเตือน', () => {
    const parsed = { queue_no: '1', customer_name: 'คุณเอ', license_plate: null, stated_total: 5000 };
    const info = { quotation_no: 'IV000001', itemCount: 1, totalAmount: 5000, hasNote: false, isUpdate: false };
    expect(lineWebhookRouter.buildSuccessReplyText(parsed, info)).not.toMatch(/ไม่ตรงกับผลรวม/);
  });

  test('ยอดที่ร้านแจ้งมาเอง ("รวม") ไม่ตรงกับผลรวมจริง → ข้อความตอบมีคำเตือน', () => {
    const parsed = { queue_no: '1', customer_name: 'คุณเอ', license_plate: null, stated_total: 34000 };
    const info = { quotation_no: 'IV000001', itemCount: 2, totalAmount: 33500, hasNote: false, isUpdate: false };
    const text = lineWebhookRouter.buildSuccessReplyText(parsed, info);
    expect(text).toMatch(/ไม่ตรงกับผลรวม/);
    expect(text).toContain('34,000');
    expect(text).toContain('33,500');
  });

  test('ไม่ได้แจ้งยอดรวมมาเลย → ข้อความตอบไม่มีคำเตือน (ใช้ผลรวมที่ระบบคำนวณ)', () => {
    const parsed = { queue_no: '1', customer_name: 'คุณเอ', license_plate: null, stated_total: null };
    const info = { quotation_no: 'IV000001', itemCount: 2, totalAmount: 33500, hasNote: false, isUpdate: false };
    expect(lineWebhookRouter.buildSuccessReplyText(parsed, info)).not.toMatch(/ไม่ตรงกับผลรวม/);
  });

  test('ข้อความที่แก้ไขใบเดิม (isUpdate) → ข้อความตอบใช้คำว่า "แก้ไข" ไม่ใช่ "สร้าง"', () => {
    const parsed = { queue_no: '1', customer_name: 'คุณเอ', license_plate: null, stated_total: null };
    const info = { quotation_no: 'IV000001', itemCount: 1, totalAmount: 2000, hasNote: false, isUpdate: true };
    const text = lineWebhookRouter.buildSuccessReplyText(parsed, info);
    expect(text).toContain('แก้ไขใบเสนอราคา');
    expect(text).not.toContain('สร้างใบเสนอราคา');
  });

  test('ปิดบิลสำเร็จ (paymentClosed) → ข้อความตอบมีบรรทัด "รับชำระแล้ว...ปิดบิล" พร้อมเลขใบเสร็จ', () => {
    const parsed = { queue_no: '1', customer_name: 'คุณเอ', license_plate: null, stated_total: null, payment_method: 'เงินสด' };
    const info = {
      quotation_no: 'IV000001', itemCount: 1, totalAmount: 2000, hasNote: false, isUpdate: false,
      paymentClosed: true, paymentReceiptNo: 'RC260718001', paymentAmount: 2000,
    };
    const text = lineWebhookRouter.buildSuccessReplyText(parsed, info);
    expect(text).toMatch(/รับชำระแล้ว/);
    expect(text).toMatch(/ปิดบิล/);
    expect(text).toContain('RC260718001');
    expect(text).toContain('เงินสด');
  });

  test('แจ้งชำระเงินมาแต่ไม่มีรายการสินค้า (paymentWarning: no_items) → ข้อความตอบเตือน ไม่บอกว่าปิดบิลแล้ว', () => {
    const parsed = { queue_no: '1', customer_name: 'คุณเอ', license_plate: null, stated_total: null };
    const info = {
      quotation_no: 'IV000001', itemCount: 0, totalAmount: 0, hasNote: false, isUpdate: false,
      paymentClosed: false, paymentWarning: 'no_items',
    };
    const text = lineWebhookRouter.buildSuccessReplyText(parsed, info);
    expect(text).toMatch(/ยังไม่มีรายการสินค้า/);
    expect(text).not.toMatch(/ปิดบิล/);
  });

  test('ยอดมัดจำ+ยอดค้างไม่ตรงกับยอดรวมที่แจ้งมา (depositMismatch) → ข้อความตอบมีคำเตือนเฉย ๆ ไม่บล็อกการปิดบิล', () => {
    const parsed = { queue_no: '1', customer_name: 'คุณเอ', license_plate: null, stated_total: null };
    const info = {
      quotation_no: 'IV000001', itemCount: 1, totalAmount: 10000, hasNote: false, isUpdate: false,
      paymentClosed: true, paymentReceiptNo: 'RC260718002', paymentAmount: 10000,
      depositMismatch: { depositAmount: 2000, actual: 6000, expected: 10000 },
    };
    const text = lineWebhookRouter.buildSuccessReplyText(parsed, info);
    expect(text).toMatch(/ไม่เท่ากับยอดรวม/);
    expect(text).toContain('2,000');
    expect(text).toContain('6,000');
    expect(text).toContain('10,000');
  });

  test('พิมพ์ผิดแล้วเรียกคืนข้อความ (unsend) → ลบใบเสนอราคา+ลูกค้า/รถที่เพิ่งสร้างใหม่', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `083${uniq}`;
    const messageId = `msg-h-${uniq}`;
    const text = `คิว:11\nชื่อลูกค้า:คุณพิมพ์ผิด\nเบอร์โทร:${phone}\nทะเบียนรถ:5กฒ65`;

    const createRes = await postWebhook(eventsBody([messageEvent(text, messageId)]));
    expect(createRes.body.created).toHaveLength(1);
    const quotationNo = createRes.body.created[0];

    const [[quotation]] = await pool.query('SELECT * FROM quotations WHERE quotation_no = ?', [quotationNo]);
    const { customer_id: customerId, vehicle_id: vehicleId } = quotation;

    const unsendRes = await postWebhook(eventsBody([unsendEvent(messageId)]));
    expect(unsendRes.status).toBe(200);
    expect(unsendRes.body.deleted).toEqual([quotationNo]);

    const [[gone]] = await pool.query('SELECT id FROM quotations WHERE quotation_no = ?', [quotationNo]);
    expect(gone).toBeUndefined();
    const [[vehicleGone]] = await pool.query('SELECT id FROM vehicles WHERE id = ?', [vehicleId]);
    expect(vehicleGone).toBeUndefined();
    const [[customerGone]] = await pool.query('SELECT id FROM customers WHERE id = ?', [customerId]);
    expect(customerGone).toBeUndefined();
  });

  test('unsend ข้อความที่ไป "แก้ไข" ใบเดิม (ไม่ใช่เปิดใบใหม่) → ไม่ลบอะไร กันข้อมูลจากข้อความก่อนหน้าหาย', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `086${uniq}`;

    const first = await postWebhook(
      eventsBody([messageEvent(`คิว:21\nชื่อลูกค้า:คุณอัปเดต\nเบอร์โทร:${phone}`, `msg-upd1-${uniq}`)])
    );
    const firstNo = first.body.created[0];
    const [[q1]] = await pool.query('SELECT customer_id FROM quotations WHERE quotation_no=?', [firstNo]);
    createdCustomerIds.push(q1.customer_id);

    const updateMessageId = `msg-upd2-${uniq}`;
    await postWebhook(
      eventsBody([messageEvent(`คิว:21\nชื่อลูกค้า:คุณอัปเดต\nเบอร์โทร:${phone}\nรายการ:\nค่าแรง 2000`, updateMessageId)])
    );

    const unsendRes = await postWebhook(eventsBody([unsendEvent(updateMessageId)]));
    expect(unsendRes.body.deleted).toHaveLength(0); // ข้อความอัปเดตไม่ถูกติดตาม ไม่มีอะไรให้ลบ

    const [[stillThere]] = await pool.query('SELECT id FROM quotations WHERE quotation_no = ?', [firstNo]);
    expect(stillThere).toBeTruthy(); // ใบเดิมยังอยู่ครบ
  });

  test('unsend ของลูกค้าที่มีอยู่แล้ว → ลบเฉพาะใบเสนอราคา ไม่แตะลูกค้าเดิม', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `084${uniq}`;
    const messageId1 = `msg-i1-${uniq}`;
    const messageId2 = `msg-i2-${uniq}`;

    const first = await postWebhook(
      eventsBody([messageEvent(`คิว:12\nชื่อลูกค้า:คุณลูกค้าเดิม\nเบอร์โทร:${phone}`, messageId1)])
    );
    createdCustomerIds.push((await pool.query('SELECT customer_id FROM quotations WHERE quotation_no=?', [first.body.created[0]]))[0][0].customer_id);
    const customerId = createdCustomerIds[createdCustomerIds.length - 1];

    const second = await postWebhook(
      eventsBody([messageEvent(`คิว:13\nชื่อลูกค้า:คุณลูกค้าเดิม\nเบอร์โทร:${phone}`, messageId2)])
    );
    const secondQuotationNo = second.body.created[0];

    // เรียกคืนข้อความที่สอง — ลูกค้าคนนี้ยังมีใบแรกอ้างอิงอยู่ ต้องไม่ถูกลบ
    const unsendRes = await postWebhook(eventsBody([unsendEvent(messageId2)]));
    expect(unsendRes.body.deleted).toEqual([secondQuotationNo]);

    const [[stillThere]] = await pool.query('SELECT id FROM customers WHERE id = ?', [customerId]);
    expect(stillThere).toBeTruthy();
    const [[secondGone]] = await pool.query('SELECT id FROM quotations WHERE quotation_no = ?', [secondQuotationNo]);
    expect(secondGone).toBeUndefined();
  });

  test('unsend ข้อความที่ไม่เคยสร้างใบเสนอราคา (แชตทั่วไป) → เงียบ ไม่มีอะไรเกิดขึ้น', async () => {
    const res = await postWebhook(eventsBody([unsendEvent(`msg-never-existed-${Date.now()}`)]));
    expect(res.status).toBe(200);
    expect(res.body.deleted).toHaveLength(0);
  });

  test('เบอร์โทรเดิมส่งคิวใหม่มาอีกครั้ง (คนละคิว) → ใช้ลูกค้าคนเดิม แต่เปิดใบใหม่ (ไม่ merge)', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `088${uniq}`;

    const first = await postWebhook(
      eventsBody([messageEvent(`คิว:1\nชื่อลูกค้า:คุณลูกค้าประจำ\nเบอร์โทร:${phone}\nอาการ:เช็คเบรก`, `msg-b1-${uniq}`)])
    );
    expect(first.body.created).toHaveLength(1);
    const [[q1]] = await pool.query('SELECT customer_id FROM quotations WHERE quotation_no = ?', [first.body.created[0]]);
    createdCustomerIds.push(q1.customer_id);

    const second = await postWebhook(
      eventsBody([messageEvent(`คิว:2\nชื่อลูกค้า:คุณลูกค้าประจำ\nเบอร์โทร:${phone}\nอาการ:เปลี่ยนโช้ค`, `msg-b2-${uniq}`)])
    );
    expect(second.body.created).toHaveLength(1);
    expect(second.body.created[0]).not.toBe(first.body.created[0]); // คิวไม่ตรงกัน = คนละใบ
    const [[q2]] = await pool.query('SELECT customer_id FROM quotations WHERE quotation_no = ?', [second.body.created[0]]);

    expect(q2.customer_id).toBe(q1.customer_id);
  });

  test('LINE ส่งข้อความเดิมซ้ำ (retry, message id เดิม) → ไม่สร้างใบเสนอราคาซ้ำ', async () => {
    const uniq = Date.now().toString().slice(-7);
    const body = eventsBody([messageEvent(`คิว:4\nชื่อลูกค้า:คุณกันซ้ำ\nเบอร์โทร:087${uniq}`, `msg-c-${uniq}`)]);

    const first = await postWebhook(body);
    expect(first.body.created).toHaveLength(1);
    const [[q]] = await pool.query('SELECT customer_id FROM quotations WHERE quotation_no = ?', [first.body.created[0]]);
    createdCustomerIds.push(q.customer_id);

    const retry = await postWebhook(body);
    expect(retry.status).toBe(200);
    expect(retry.body.created).toHaveLength(0);
  });

  test('แชตทั่วไปที่ไม่มี label "คิว" → 200 แต่ไม่สร้างอะไร', async () => {
    const res = await postWebhook(eventsBody([messageEvent('พรุ่งนี้ร้านเปิดกี่โมงครับ', `msg-d-${Date.now()}`)]));
    expect(res.status).toBe(200);
    expect(res.body.created).toHaveLength(0);
  });

  test('ลายเซ็นไม่ถูกต้อง → 401 ไม่ประมวลผลอะไรเลย', async () => {
    const body = eventsBody([messageEvent('คิว:5\nชื่อลูกค้า:คุณปลอมลายเซ็น', `msg-e-${Date.now()}`)]);
    const res = await postWebhook(body, 'forged-signature');
    expect(res.status).toBe(401);
  });

  // Fix 3: LINE dedup state ต้องรอดจาก "restart" — เดิมเก็บแค่ใน Set/Map หน่วยความจำ
  // ล้วน ๆ ตอนนี้เขียนลงตาราง processed_line_messages ด้วย (ดู markProcessed/
  // trackMessageQuotation/getTrackedQuotation ใน lineWebhook.routes.js) เทสต์นี้เช็ค
  // ตรงจากฐานข้อมูล ไม่ใช่ตัวแปรในหน่วยความจำของโมดูล เพื่อพิสูจน์ว่าความถูกต้องไม่ได้
  // พึ่งพา process เดิมที่ยังไม่ restart
  test('message id ที่ประมวลผลแล้วถูกบันทึกลงตาราง processed_line_messages จริง (รอดจาก restart)', async () => {
    const uniq = Date.now().toString().slice(-7);
    const messageId = `msg-persist-${uniq}`;
    const text = `คิว:16\nชื่อลูกค้า:คุณทนต่อรีสตาร์ท\nเบอร์โทร:091${uniq}`;

    const res = await postWebhook(eventsBody([messageEvent(text, messageId)]));
    expect(res.body.created).toHaveLength(1);
    const quotationNo = res.body.created[0];
    const [[quotation]] = await pool.query('SELECT customer_id FROM quotations WHERE quotation_no = ?', [quotationNo]);
    createdCustomerIds.push(quotation.customer_id);

    // เช็คตรงจากฐานข้อมูล (ไม่ใช่ Set ในหน่วยความจำ) — แถวต้องถูกสร้างไว้แล้ว พร้อม
    // ผูกกับใบเสนอราคาที่เพิ่งสร้าง (ข้อความนี้ "เปิดใบใหม่")
    const [[row]] = await pool.query(
      'SELECT message_id, quotation_no FROM processed_line_messages WHERE message_id = ?',
      [messageId]
    );
    expect(row).toBeTruthy();
    expect(row.quotation_no).toBe(quotationNo);

    // จำลอง "restart": require โมดูลเราท์เตอร์ใหม่แบบสด ๆ (ล้าง Set ในหน่วยความจำ
    // ของโมดูลเดิมทิ้งไปโดยสิ้นเชิง เพราะ isProcessed/markProcessed เป็น closure
    // ภายในโมดูลนั้น) แล้วยิง event เดิม (message id เดิม) ผ่าน route ใหม่นี้ตรง ๆ —
    // ต้องยังถูกจำได้ว่าประมวลผลไปแล้วจากแถวใน DB ไม่ใช่สร้างใบเสนอราคาซ้ำ
    jest.resetModules();
    const freshRouter = require('../src/routes/lineWebhook.routes');
    const freshPool = require('../src/db/pool'); // instance ใหม่ (module cache ถูกล้าง) — ต้อง end() เองแยกจาก pool เดิมที่ปิดใน afterAll
    const express = require('express');
    const freshApp = express();
    freshApp.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
    freshApp.use('/api/line', freshRouter);

    try {
      const retryBody = eventsBody([messageEvent(text, messageId)]);
      const retryRes = await request(freshApp)
        .post('/api/line/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Line-Signature', sign(retryBody))
        .send(retryBody);

      expect(retryRes.status).toBe(200);
      expect(retryRes.body.created).toHaveLength(0); // ยังจำได้ว่าประมวลผลไปแล้ว แม้ Set ในหน่วยความจำของ process ใหม่จะว่างเปล่า

      const [quotationsAfter] = await pool.query('SELECT id FROM quotations WHERE customer_id = ?', [quotation.customer_id]);
      expect(quotationsAfter).toHaveLength(1); // ยังมีใบเดียว ไม่ซ้อน
    } finally {
      await freshPool.end();
    }
  });

  // Fix 4: ลูกค้าที่สร้างผ่านหน้าเว็บ (POST /customers) ด้วยเบอร์แบบไม่มีขีด ต้องถูก
  // normalize เป็นรูปแบบเดียวกับที่บอทไลน์ใช้ (formatPhone) ก่อนบันทึก ไม่งั้น
  // WHERE phone = ? แบบตรง ๆ ใน createQuotationFromQueue จะหาไม่เจอ กลายเป็นสร้าง
  // ลูกค้าซ้ำซ้อนทุกครั้งที่ลูกค้าคนนี้พิมพ์คิวเข้ามาทางไลน์
  test('ลูกค้าที่สร้างผ่านเว็บด้วยเบอร์ไม่มีขีด → บอทไลน์ (เบอร์แบบมีขีด) จับคู่เจอ ไม่สร้างซ้ำ', async () => {
    const officeToken = await helpers.getOfficeToken();
    const uniq = Date.now().toString().slice(-7);
    const rawPhone = `095${uniq}`; // ไม่มีขีดเลย เหมือนพนักงานพิมพ์ในฟอร์มเว็บตรง ๆ

    const createRes = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${officeToken}`)
      .send({ customer_name: 'คุณเว็บไม่มีขีด', phone: rawPhone });
    expect(createRes.status).toBe(201);
    const webCustomerId = createRes.body.data.id;
    createdCustomerIds.push(webCustomerId);

    const [[storedCustomer]] = await pool.query('SELECT phone FROM customers WHERE id = ?', [webCustomerId]);
    expect(storedCustomer.phone).toBe(`${rawPhone.slice(0, 3)}-${rawPhone.slice(3, 6)}-${rawPhone.slice(6)}`); // เก็บแบบมีขีดแล้ว

    // บอทไลน์ได้รับเบอร์แบบมีขีดเสมอ (formatPhone ใน parseLineQueueMessage.js) —
    // ต้องจับคู่กับลูกค้าคนนี้ (customer_id เดิม) ไม่ใช่สร้างลูกค้าใหม่ซ้อน
    const uniqLine = Date.now().toString().slice(-7);
    const text = `คิว:${uniqLine}\nชื่อลูกค้า:คุณเว็บไม่มีขีด\nเบอร์โทร:${rawPhone}`;
    const res = await postWebhook(eventsBody([messageEvent(text, `msg-phonematch-${uniqLine}`)]));
    expect(res.body.created).toHaveLength(1);

    const [[quotation]] = await pool.query('SELECT customer_id FROM quotations WHERE quotation_no = ?', [res.body.created[0]]);
    expect(quotation.customer_id).toBe(webCustomerId); // ลูกค้าคนเดิม ไม่สร้างซ้ำ

    const [allCustomersWithPhone] = await pool.query(
      'SELECT id FROM customers WHERE phone = ?',
      [`${rawPhone.slice(0, 3)}-${rawPhone.slice(3, 6)}-${rawPhone.slice(6)}`]
    );
    expect(allCustomersWithPhone).toHaveLength(1); // มีแค่รายการเดียว ไม่ซ้ำซ้อน
  });

  describe('เทมเพลตใหม่: พิมพ์ "คิว" ขอเทมเพลต + ส่งเทมเพลตที่กรอกแล้วปิดบิลอัตโนมัติ', () => {
    // ผูก checkDepositMismatch/computeReceiptAmount (mirror กติกาปิดบิล) เข้ากับผลจาก
    // parseLineQueueMessage จริง ๆ (ไม่ใช่ mock object) — พิสูจน์ว่า field ที่ parser
    // คืนมา (remaining_balance/stated_total/deposit_amount) เดินผ่านกติกาในไฟล์นี้ได้
    // ถูกต้องจริง ๆ ไม่ใช่แค่ทดสอบแยกแต่ละฟังก์ชันด้วย object ที่เขียนมือ — deposit_amount
    // เป็นฟิลด์ first-class จาก label "มัดจำ:" แล้ว (ไม่ได้เดาจากข้อความในหมายเหตุอีกต่อไป)
    test('checkDepositMismatch/computeReceiptAmount ต่อกับผลจาก parser จริง: มัดจำ+ยอดที่จ่ายเพิ่ม ตรงกับยอดรวม → ไม่มี mismatch, ยอดใบเสร็จ = มัดจำ+ยอดที่จ่ายเพิ่ม', () => {
      const parsed = parseLineQueueMessage(
        templateText({
          queueNo: '1',
          name: 'คุณมัดจำตรง',
          items: [{ name: 'แร็ค OEM', price: 10000 }],
          // มัดจำ 6000 ไว้ก่อน เหลือ 4000 — ตอนปิดบิลจ่ายส่วนที่เหลือ 4000 พอดี
          payment: { statedTotal: 10000, remainingBalance: 4000, paidAmount: 4000, deposit: 6000 },
        })
      );
      expect(parsed.remaining_balance).toBe(4000);
      expect(parsed.stated_total).toBe(10000);
      expect(parsed.deposit_amount).toBe(6000);

      expect(lineWebhookRouter.checkDepositMismatch(parsed, parsed.deposit_amount)).toBeNull(); // 6000+4000=10000 ตรงกับยอดรวม
      // สูตรใหม่: มัดจำ (6000) + ยอดที่ลูกค้าชำระเงินครั้งนี้ (4000) = 10000
      expect(lineWebhookRouter.computeReceiptAmount(parsed.deposit_amount, parsed.paid_amount, 10000)).toBe(10000);
    });

    test('checkDepositMismatch ต่อกับผลจาก parser จริง: มัดจำ+ยอดค้าง ไม่ตรงกับยอดรวม → คืน mismatch พร้อมตัวเลขที่ถูกต้อง', () => {
      const parsed = parseLineQueueMessage(
        templateText({
          queueNo: '1',
          name: 'คุณมัดจำเพี้ยน',
          items: [{ name: 'แร็ค OEM', price: 10000 }],
          // พิมพ์ยอดรวมผิด (10000) แต่มัดจำ 2000 + ยอดค้าง 5000 = 7000 ไม่เท่ากัน
          payment: { statedTotal: 10000, remainingBalance: 5000, paidAmount: 2000, deposit: 2000 },
        })
      );
      expect(parsed.deposit_amount).toBe(2000);
      const mismatch = lineWebhookRouter.checkDepositMismatch(parsed, parsed.deposit_amount);
      expect(mismatch).toEqual({ depositAmount: 2000, actual: 7000, expected: 10000 });
    });

    test('computeReceiptAmount ต่อกับผลจาก parser จริง: ไม่มีมัดจำ (ยอดที่ต้องชำระ 0/ไม่กรอก) → ใช้ยอดที่ลูกค้าจ่ายจริง', () => {
      const parsed = parseLineQueueMessage(
        templateText({
          queueNo: '1',
          name: 'คุณจ่ายเต็มตรง',
          items: [{ name: 'ค่าแรง', price: 3000 }],
          payment: { paidAmount: 3000, method: 'เงินสด' },
        })
      );
      expect(parsed.remaining_balance).toBeNull();
      expect(lineWebhookRouter.computeReceiptAmount(parsed.deposit_amount, parsed.paid_amount, 3000)).toBe(3000);
    });

    test('พิมพ์ "คิว" เดี่ยว ๆ → ไม่สร้างใบเสนอราคา แค่จำว่าประมวลผลแล้ว (เนื้อหาเทมเพลตตรวจแยกผ่าน buildQueueTemplateText)', async () => {
      const messageId = `msg-tmpl-ask-${Date.now()}`;
      const res = await postWebhook(eventsBody([messageEvent('คิว', messageId)]));
      expect(res.status).toBe(200);
      expect(res.body.created).toHaveLength(0);

      const [[row]] = await pool.query(
        'SELECT message_id FROM processed_line_messages WHERE message_id = ?',
        [messageId]
      );
      expect(row).toBeTruthy(); // จำว่าประมวลผลแล้ว กัน LINE retry ตอบซ้ำ

      // เนื้อหาเทมเพลตตรงตามที่ตกลงกับเจ้าของร้าน (ทดสอบผ่านฟังก์ชันล้วนโดยตรง
      // เพราะ replyToLine ยิง LINE API จริง ไม่มี side effect อื่นให้ตรวจจากเทสต์)
      const text = lineWebhookRouter.buildQueueTemplateText('7');
      expect(text).toContain('คิว 7');
      expect(text).toContain('ชื่อ:');
      expect(text).toContain('เบอโทรศัพท์:');
      expect(text).toContain('<--สิ้นสุดรายการ-->');
      expect(text).toContain('ยอดที่ต้องชำระ:');
      expect(text).toContain('<--ลูกค้าชำระเงิน-->');
      expect(text).toContain('ช่องทางการชำระ (โอน/บัตรเครดิต/เงินสด/QRCode):');
      expect(text).toContain('ลูกค้าชำระเงิน (ยอดที่ได้รับจริง):');
      // ยอดที่ต้องชำระ ต้องอยู่ก่อนเส้นแบ่งที่สอง ซึ่งอยู่ก่อนช่องทางการชำระ (ลำดับตกลงกับเจ้าของร้าน)
      expect(text.indexOf('ยอดที่ต้องชำระ:')).toBeLessThan(text.indexOf('<--ลูกค้าชำระเงิน-->'));
      expect(text.indexOf('<--ลูกค้าชำระเงิน-->')).toBeLessThan(text.indexOf('ช่องทางการชำระ (โอน/บัตรเครดิต/เงินสด/QRCode):'));
    });

    test('พิมพ์ "คิว" ซ้ำ (message id เดิม) → ไม่ตอบซ้ำ/ไม่มีผลข้างเคียงเพิ่ม', async () => {
      const messageId = `msg-tmpl-ask2-${Date.now()}`;
      const body = eventsBody([messageEvent('คิว', messageId)]);
      const first = await postWebhook(body);
      expect(first.body.created).toHaveLength(0);
      const retry = await postWebhook(body);
      expect(retry.status).toBe(200);
      expect(retry.body.created).toHaveLength(0);
    });

    test('เทมเพลตกรอกครบไม่มีการชำระ (ส่วนชำระเงินว่างทั้งหมด) → ทำงานเหมือนสร้างใบเสนอราคาปกติทุกประการ ไม่มีใบเสร็จ ไม่ปิดบิล', async () => {
      const uniq = Date.now().toString().slice(-7);
      const phone = `061${uniq}`;
      const queueNo = `1${uniq}`;
      const text = templateText({
        queueNo,
        name: 'คุณเทมเพลตว่าง',
        phone,
        items: [{ name: 'ค่าแรง', price: 2000 }],
      });

      const res = await postWebhook(eventsBody([messageEvent(text, `msg-tmpl-empty-${uniq}`)]));
      expect(res.body.created).toHaveLength(1);

      const [[quotation]] = await pool.query('SELECT * FROM quotations WHERE quotation_no = ?', [res.body.created[0]]);
      createdCustomerIds.push(quotation.customer_id);
      expect(quotation.status).toBe('pending');
      expect(quotation.closed_at).toBeNull();
      expect(quotation.converted_receipt_id).toBeNull();

      const [receipts] = await pool.query('SELECT id FROM receipts WHERE customer_id = ?', [quotation.customer_id]);
      expect(receipts).toHaveLength(0);
    });

    test('"ลูกค้าชำระเงิน:" กรอกมามีค่าแต่ไม่มีวลีแจ้งจ่ายเงินแล้ว → ไม่ปิดบิล (แค่ข้อมูลยอดที่จ่าย ไม่ใช่สัญญาณปิดบิลอีกต่อไป)', async () => {
      const uniq = Date.now().toString().slice(-7);
      const phone = `060${uniq}`;
      const queueNo = `0${uniq}`;
      const text = templateText({
        queueNo,
        name: 'คุณยังไม่ยืนยัน',
        phone,
        plate: `9กฮ${uniq.slice(0, 4)}`,
        items: [{ name: 'ค่าแรง', price: 2000 }],
        payment: { statedTotal: 2000, method: 'เงินสด', paidAmount: 2000 }, // ไม่มี confirm: true
      });

      const res = await postWebhook(eventsBody([messageEvent(text, `msg-tmpl-noconfirm-${uniq}`)]));
      expect(res.body.created).toHaveLength(1);

      const [[quotation]] = await pool.query('SELECT * FROM quotations WHERE quotation_no = ?', [res.body.created[0]]);
      createdCustomerIds.push(quotation.customer_id);
      expect(quotation.status).toBe('pending'); // ยังไม่อนุมัติ/ปิดบิลเอง
      expect(quotation.closed_at).toBeNull();
      expect(quotation.converted_receipt_id).toBeNull();

      const [receipts] = await pool.query('SELECT id FROM receipts WHERE customer_id = ?', [quotation.customer_id]);
      expect(receipts).toHaveLength(0);
    });

    test('วลีแจ้งจ่ายเงินแล้ว (จ่ายเต็ม ไม่มีมัดจำ) บนใบที่ยัง pending → อนุมัติ+สร้างใบเสร็จอัตโนมัติ ยอด=ที่จ่ายจริง ปิดบิล', async () => {
      const uniq = Date.now().toString().slice(-7);
      const phone = `062${uniq}`;
      const queueNo = `2${uniq}`;
      const text = templateText({
        queueNo,
        name: 'คุณจ่ายเต็ม',
        phone,
        plate: `1กข${uniq.slice(0, 4)}`,
        items: [{ name: 'ค่าแรง', price: 2000 }, { name: 'แร็ค OEM', price: 3000 }],
        payment: { statedTotal: 5000, method: 'เงินสด', paidAmount: 5000, confirm: true },
      });

      const res = await postWebhook(eventsBody([messageEvent(text, `msg-tmpl-full-${uniq}`)]));
      expect(res.body.created).toHaveLength(1);

      const [[quotation]] = await pool.query('SELECT * FROM quotations WHERE quotation_no = ?', [res.body.created[0]]);
      createdCustomerIds.push(quotation.customer_id);
      expect(quotation.status).toBe('approved');
      expect(quotation.closed_at).toBeTruthy();
      expect(quotation.converted_receipt_id).toBeTruthy();

      const [[receipt]] = await pool.query('SELECT * FROM receipts WHERE id = ?', [quotation.converted_receipt_id]);
      expect(receipt.payment_method).toBe('เงินสด');
      expect(Number(receipt.total_amount)).toBe(5000);

      const [receiptItems] = await pool.query('SELECT product_name_snapshot FROM receipt_items WHERE receipt_id = ?', [receipt.id]);
      expect(receiptItems).toHaveLength(2);

      const [notices] = await pool.query('SELECT id FROM repair_notices WHERE quotation_id = ?', [quotation.id]);
      expect(notices).toHaveLength(1); // อนุมัติเองแล้วต้องได้ใบแจ้งซ่อมคู่กันเหมือนอนุมัติผ่านเว็บ
    });

    test('วลีแจ้งจ่ายเงินแล้ว พร้อมมัดจำ (ยอดที่ต้องชำระ > 0) → ยอดใบเสร็จ = มัดจำ + ยอดที่จ่ายปิดบิลจริง', async () => {
      const uniq = Date.now().toString().slice(-7);
      const phone = `063${uniq}`;
      const queueNo = `3${uniq}`;
      const text = templateText({
        queueNo,
        name: 'คุณมัดจำ',
        phone,
        plate: `2กค${uniq.slice(0, 4)}`,
        items: [{ name: 'ชุดโปรช่วงล่างเก๋ง', price: 10000 }],
        // มัดจำไว้ก่อน 6000 เหลือ 4000 — ตอนปิดบิลพิมพ์ยอดที่จ่ายจริง (ส่วนที่เหลือ) ลง "ลูกค้าชำระเงิน"
        payment: { statedTotal: 10000, method: 'โอน', remainingBalance: 4000, paidAmount: 4000, deposit: 6000, confirm: true },
      });

      const res = await postWebhook(eventsBody([messageEvent(text, `msg-tmpl-deposit-${uniq}`)]));
      expect(res.body.created).toHaveLength(1);

      const [[quotation]] = await pool.query('SELECT * FROM quotations WHERE quotation_no = ?', [res.body.created[0]]);
      createdCustomerIds.push(quotation.customer_id);
      expect(quotation.status).toBe('approved');
      expect(quotation.closed_at).toBeTruthy();

      const [[receipt]] = await pool.query('SELECT payment_method, total_amount FROM receipts WHERE id = ?', [quotation.converted_receipt_id]);
      expect(receipt.payment_method).toBe('โอน');
      expect(Number(receipt.total_amount)).toBe(10000); // มัดจำ 6000 + จ่ายปิดบิล 4000 = 10000
    });

    test('ช่องทางการชำระ "QRcode" (พิมพ์ผิดตัวใหญ่เล็ก) → normalize เป็น "QRCode" ลงใบเสร็จ ตรงกับ select ฝั่งหน้าเว็บ', async () => {
      const uniq = Date.now().toString().slice(-7);
      const phone = `064${uniq}`;
      const queueNo = `4${uniq}`;
      const text = templateText({
        queueNo,
        name: 'คุณคิวอาร์',
        phone,
        plate: `3กง${uniq.slice(0, 4)}`,
        items: [{ name: 'ค่าแรง', price: 1000 }],
        payment: { paidAmount: 1000, method: 'QRcode', confirm: true },
      });

      const res = await postWebhook(eventsBody([messageEvent(text, `msg-tmpl-qr-${uniq}`)]));
      expect(res.body.created).toHaveLength(1);

      const [[quotation]] = await pool.query('SELECT converted_receipt_id, customer_id FROM quotations WHERE quotation_no = ?', [res.body.created[0]]);
      createdCustomerIds.push(quotation.customer_id);
      const [[receipt]] = await pool.query('SELECT payment_method FROM receipts WHERE id = ?', [quotation.converted_receipt_id]);
      expect(receipt.payment_method).toBe('QRCode');
    });

    test('วลีแจ้งจ่ายเงินแล้วมาแต่ไม่มีรายการสินค้าเลย → ไม่สร้างใบเสร็จ ไม่ปิดบิล (ไม่มี closed_at)', async () => {
      const uniq = Date.now().toString().slice(-7);
      const phone = `065${uniq}`;
      const queueNo = `5${uniq}`;
      const text = templateText({
        queueNo,
        name: 'คุณไม่มีรายการ',
        phone,
        payment: { paidAmount: 1000, method: 'เงินสด', confirm: true },
      });

      const res = await postWebhook(eventsBody([messageEvent(text, `msg-tmpl-noitem-${uniq}`)]));
      expect(res.body.created).toHaveLength(1);

      const [[quotation]] = await pool.query('SELECT * FROM quotations WHERE quotation_no = ?', [res.body.created[0]]);
      createdCustomerIds.push(quotation.customer_id);
      expect(quotation.status).toBe('pending');
      expect(quotation.closed_at).toBeNull();
      expect(quotation.converted_receipt_id).toBeNull();
    });

    test('ปิดบิลแล้ว พิมพ์คิว+ลูกค้าเดิมซ้ำ (resend) → ไม่สร้างใบใหม่ ไม่แก้ไขใบเดิม แค่เตือนว่าบิลปิดแล้ว', async () => {
      const uniq = Date.now().toString().slice(-7);
      const phone = `066${uniq}`;
      const queueNo = `6${uniq}`;

      const first = await postWebhook(eventsBody([messageEvent(
        templateText({
          queueNo,
          name: 'คุณปิดแล้ว',
          phone,
          plate: `4กจ${uniq.slice(0, 4)}`,
          items: [{ name: 'ค่าแรง', price: 1500 }],
          payment: { paidAmount: 1500, method: 'เงินสด', confirm: true },
        }),
        `msg-tmpl-close1-${uniq}`
      )]));
      expect(first.body.created).toHaveLength(1);
      const firstNo = first.body.created[0];
      const [[q1]] = await pool.query('SELECT id, customer_id, total_amount FROM quotations WHERE quotation_no = ?', [firstNo]);
      createdCustomerIds.push(q1.customer_id);

      // ส่งข้อมูลคิว+ลูกค้าเดิมซ้ำอีกครั้ง (ไม่มีคำว่า "ชำระเงินเรียบร้อย/แล้ว" ที่
      // parser เดิมกรองทิ้งอยู่แล้ว — จำลองพนักงานคัดลอกเทมเพลตเดิมส่งซ้ำเฉย ๆ)
      const second = await postWebhook(eventsBody([messageEvent(
        `คิว:${queueNo}\nชื่อ:คุณปิดแล้ว\nเบอโทรศัพท์:${phone}\nทะเบียนรถ:4กจ${uniq.slice(0, 4)}\nรายการ:\nค่าแรง 2000`,
        `msg-tmpl-close2-${uniq}`
      )]));
      expect(second.body.created).toHaveLength(0); // ไม่สร้างใบใหม่/ไม่แก้ไขใบเดิม

      const [quotations] = await pool.query('SELECT id, total_amount FROM quotations WHERE customer_id = ?', [q1.customer_id]);
      expect(quotations).toHaveLength(1); // ยังมีใบเดียว (บิลที่ปิดไปแล้ว)
      expect(Number(quotations[0].total_amount)).toBe(Number(q1.total_amount)); // ไม่ถูกแก้ไข
    });

    test('บิลปิดแล้ว → เลขคิวถูกปล่อยว่างให้ลูกค้าใหม่ใช้ได้เลย ไม่ถูกเปลี่ยนอัตโนมัติเหมือนคิวชนปกติ', async () => {
      const uniq = Date.now().toString().slice(-7);
      const phoneA = `067${uniq}`;
      const phoneB = `068${uniq}`;
      const queueNo = `7${uniq}`;

      const first = await postWebhook(eventsBody([messageEvent(
        templateText({
          queueNo,
          name: 'คุณเจ้าของคิวเดิม',
          phone: phoneA,
          plate: `6กฉ${uniq.slice(0, 4)}`,
          items: [{ name: 'ค่าแรง', price: 1000 }],
          payment: { paidAmount: 1000, method: 'เงินสด', confirm: true },
        }),
        `msg-tmpl-free1-${uniq}`
      )]));
      expect(first.body.created).toHaveLength(1);
      const [[qA]] = await pool.query('SELECT customer_id FROM quotations WHERE quotation_no = ?', [first.body.created[0]]);
      createdCustomerIds.push(qA.customer_id);

      // ลูกค้าใหม่ (คนละคน) พิมพ์เลขคิวเดียวกันวันเดียวกัน — ต้องได้เลขคิวเดิมไปเลย
      // ไม่ใช่ถูกเปลี่ยนอัตโนมัติ เพราะเจ้าของเดิมปิดบิลไปแล้ว (เลขคิวว่างจริง)
      const second = await postWebhook(eventsBody([messageEvent(
        `คิว:${queueNo}\nชื่อลูกค้า:คุณคิวใหม่จริง\nเบอร์โทร:${phoneB}`,
        `msg-tmpl-free2-${uniq}`
      )]));
      expect(second.body.created).toHaveLength(1);
      const [[qB]] = await pool.query(
        'SELECT customer_id, queue_no, requested_queue_no FROM quotations WHERE quotation_no = ?',
        [second.body.created[0]]
      );
      createdCustomerIds.push(qB.customer_id);
      expect(qB.queue_no).toBe(queueNo); // ไม่ถูกเปลี่ยน
      expect(qB.requested_queue_no).toBeNull();
    });

    test('วลีแจ้งจ่ายเงินแล้วบนใบที่อนุมัติไปแล้ว (มีใบเสร็จผูกอยู่แล้วจากเว็บ) → ทับ payment_method+ยอดใบเสร็จเดิม แล้วปิดบิล', async () => {
      const uniq = Date.now().toString().slice(-7);
      const phone = `069${uniq}`;
      const queueNo = `8${uniq}`;

      const first = await postWebhook(eventsBody([messageEvent(
        `คิว:${queueNo}\nชื่อลูกค้า:คุณอนุมัติเว็บ\nเบอร์โทร:${phone}\nทะเบียนรถ:5กฒ${uniq.slice(0, 2)}\nรายการ:\nค่าแรง 2000`,
        `msg-tmpl-appr1-${uniq}`
      )]));
      expect(first.body.created).toHaveLength(1);
      const firstNo = first.body.created[0];
      const [[q1]] = await pool.query('SELECT id, customer_id, vehicle_id, total_amount FROM quotations WHERE quotation_no = ?', [firstNo]);
      createdCustomerIds.push(q1.customer_id);

      // จำลองกดอนุมัติผ่านเว็บไปแล้วก่อนหน้า (เหมือนเทสต์เดิมด้านบน)
      const [receiptResult] = await pool.query(
        `INSERT INTO receipts (receipt_no, receipt_date, customer_id, vehicle_id, mileage, remark, total_amount)
         VALUES (?, CURDATE(), ?, ?, 0, NULL, ?)`,
        [`RC-TMPL-${uniq}`, q1.customer_id, q1.vehicle_id, q1.total_amount]
      );
      const receiptId = receiptResult.insertId;
      await pool.query(
        `INSERT INTO receipt_items (receipt_id, service_item_id, product_name_snapshot, qty, price, amount)
         VALUES (?, NULL, 'ค่าแรง', 1, 2000, 2000)`,
        [receiptId]
      );
      await pool.query("UPDATE quotations SET status = 'approved', converted_receipt_id = ? WHERE id = ?", [receiptId, q1.id]);

      // พนักงานพิมพ์เทมเพลตเดิมซ้ำ พร้อมกรอกส่วนชำระเงินตอนลูกค้าจ่ายจริง
      const second = await postWebhook(eventsBody([messageEvent(
        templateText({
          queueNo,
          name: 'คุณอนุมัติเว็บ',
          phone,
          plate: `5กฒ${uniq.slice(0, 2)}`,
          items: [{ name: 'ค่าแรง', price: 2000 }],
          payment: { paidAmount: 2000, method: 'บัตรเครดิต', confirm: true },
        }),
        `msg-tmpl-appr2-${uniq}`
      )]));
      expect(second.body.created).toHaveLength(1);
      expect(second.body.created[0]).toBe(firstNo);

      const [[quotationAfter]] = await pool.query('SELECT status, closed_at FROM quotations WHERE id = ?', [q1.id]);
      expect(quotationAfter.status).toBe('approved');
      expect(quotationAfter.closed_at).toBeTruthy();

      const [[receiptAfter]] = await pool.query('SELECT payment_method, total_amount FROM receipts WHERE id = ?', [receiptId]);
      expect(receiptAfter.payment_method).toBe('บัตรเครดิต');
      expect(Number(receiptAfter.total_amount)).toBe(2000);
    });
  });

  describe('Fix: แก้ทะเบียนผ่าน Vehicle Management แล้ว resend ข้อความเดิม ต้องไม่ล้างการแก้ไข', () => {
    test('resend ข้อความเดิม (ทะเบียนเก่าที่ยังผิดอยู่) หลังออฟฟิศแก้ทะเบียนที่ถูกผ่านหน้า Vehicle Management → ยังผูกรถคันเดิม ทะเบียนที่แก้ไม่ถูกล้างทิ้ง ไม่มีรถใหม่ถูกสร้างซ้อน', async () => {
      const uniq = Date.now().toString().slice(-7);
      const phone = `074${uniq}`;
      const queueNo = `96${uniq}`;
      const wrongPlate = `1กก${uniq.slice(0, 4)}`;
      const correctPlate = `2ขข${uniq.slice(0, 4)}`;

      const first = await postWebhook(eventsBody([messageEvent(
        `คิว:${queueNo}\nชื่อลูกค้า:คุณแก้ทะเบียน\nเบอร์โทร:${phone}\nทะเบียนรถ:${wrongPlate}`,
        `msg-vehfix1-${uniq}`
      )]));
      expect(first.body.created).toHaveLength(1);
      const [[q1]] = await pool.query('SELECT id, customer_id, vehicle_id FROM quotations WHERE quotation_no = ?', [first.body.created[0]]);
      createdCustomerIds.push(q1.customer_id);
      const originalVehicleId = q1.vehicle_id;
      expect(originalVehicleId).toBeTruthy();

      // จำลองออฟฟิศแก้ทะเบียนที่พิมพ์ผิดผ่านหน้า Vehicle Management (PUT /vehicles/:id
      // — อัปเดตแถวเดิมในที่ ไม่สร้างแถวใหม่)
      await pool.query('UPDATE vehicles SET license_plate = ? WHERE id = ?', [correctPlate, originalVehicleId]);

      // พนักงานส่งข้อความเดิม (ทะเบียนเก่าที่ยังผิดอยู่ในข้อความ) ซ้ำมาเพิ่มรายการ —
      // บั๊กเดิม: vehicle resolution รันก่อน existing lookup ทำให้ค้นหาด้วยทะเบียนที่
      // พิมพ์มา (ผิด) ไม่เจอรถที่แก้แล้ว กลายเป็นสร้างรถใหม่/เปลี่ยนลิงก์ไปคันผิด
      const secondText = `คิว:${queueNo}\nชื่อลูกค้า:คุณแก้ทะเบียน\nเบอร์โทร:${phone}\nทะเบียนรถ:${wrongPlate}\nรายการ:\nค่าแรง 1500`;
      const second = await postWebhook(eventsBody([messageEvent(secondText, `msg-vehfix2-${uniq}`)]));
      expect(second.status).toBe(200);
      expect(second.body.created).toHaveLength(1);
      expect(second.body.created[0]).toBe(first.body.created[0]); // แก้ไขใบเดิม ไม่เปิดใบใหม่

      const [[q1After]] = await pool.query('SELECT vehicle_id FROM quotations WHERE id = ?', [q1.id]);
      expect(q1After.vehicle_id).toBe(originalVehicleId); // ยังเป็นรถคันเดิม ไม่ถูกเปลี่ยนลิงก์

      const [[vehicleAfter]] = await pool.query('SELECT license_plate FROM vehicles WHERE id = ?', [originalVehicleId]);
      expect(vehicleAfter.license_plate).toBe(correctPlate); // ทะเบียนที่แก้ไว้ยังอยู่ ไม่ถูกล้างทิ้ง

      const [allVehicles] = await pool.query('SELECT id FROM vehicles WHERE customer_id = ?', [q1.customer_id]);
      expect(allVehicles).toHaveLength(1); // ไม่มีรถใหม่ถูกสร้างซ้อน
    });
  });

  describe('close_only — ข้อความปิดบิลสั้น (อ้างอิงงานด้วยเลขคิวอย่างเดียว)', () => {
    test('ไม่พบบิลที่เปิดอยู่สำหรับเลขคิวนี้ → ตอบเตือน ไม่สร้าง/แก้ไขอะไร', async () => {
      const uniq = Date.now().toString().slice(-7);
      const queueNo = `90${uniq}`;
      const text = `คิว ${queueNo}\nช่องทางการชำระ: โอน\nลูกค้าชำระเงิน: 1000\nชำระเงินเรียบร้อย`;

      const res = await postWebhook(eventsBody([messageEvent(text, `msg-closeonly-none-${uniq}`)]));
      expect(res.status).toBe(200);
      expect(res.body.created).toHaveLength(0);
    });

    test('เจอใบเดียว (ยัง pending, มีมัดจำตั้งไว้ตอนเปิดบิล) → อนุมัติ+สร้างใบเสร็จ+ปิดบิล ยอดใบเสร็จ = ยอดรวมทั้งบิล มัดจำก็อปจากใบเสนอราคา (ไม่ใช่จากข้อความปิดบิลสั้นซึ่งไม่มีฟิลด์นี้)', async () => {
      const uniq = Date.now().toString().slice(-7);
      const phone = `071${uniq}`;
      const queueNo = `91${uniq}`;

      const first = await postWebhook(eventsBody([messageEvent(
        templateText({
          queueNo,
          name: 'คุณปิดบิลสั้น',
          phone,
          plate: `7กจ${uniq.slice(0, 4)}`,
          items: [{ name: 'ค่าแรง', price: 10000 }],
          payment: { statedTotal: 10000, deposit: 3000, remainingBalance: 7000 },
        }),
        `msg-closeonly1-${uniq}`
      )]));
      expect(first.body.created).toHaveLength(1);
      const [[q1]] = await pool.query(
        'SELECT id, customer_id, status, closed_at, deposit_amount FROM quotations WHERE quotation_no = ?',
        [first.body.created[0]]
      );
      createdCustomerIds.push(q1.customer_id);
      expect(Number(q1.deposit_amount)).toBe(3000);
      expect(q1.status).toBe('pending');

      const closeText = `คิว ${queueNo}\nช่องทางการชำระ: โอน\nลูกค้าชำระเงิน: 7000\nชำระเงินเรียบร้อย`;
      const second = await postWebhook(eventsBody([messageEvent(closeText, `msg-closeonly2-${uniq}`)]));
      expect(second.status).toBe(200);

      const [[q1After]] = await pool.query(
        'SELECT status, closed_at, converted_receipt_id, total_amount FROM quotations WHERE id = ?',
        [q1.id]
      );
      expect(q1After.status).toBe('approved');
      expect(q1After.closed_at).toBeTruthy();
      expect(q1After.converted_receipt_id).toBeTruthy();

      const [[receipt]] = await pool.query(
        'SELECT payment_method, total_amount, deposit_amount FROM receipts WHERE id = ?',
        [q1After.converted_receipt_id]
      );
      expect(receipt.payment_method).toBe('โอน');
      expect(Number(receipt.total_amount)).toBe(Number(q1After.total_amount)); // ยอดใบเสร็จ = ยอดรวมทั้งบิล ไม่ใช่แค่ 7000 ที่แจ้งจ่าย
      expect(Number(receipt.deposit_amount)).toBe(3000);
    });

    test('เจอมากกว่า 1 ใบ (เลขคิวชนกันข้ามลูกค้าคนละคน) → ไม่เดา ตอบให้ไปปิดในแอปแทน ไม่แก้ไขข้อมูลใด ๆ', async () => {
      const uniq = Date.now().toString().slice(-7);
      const queueNo = `95${uniq}`;
      const phoneA = `072${uniq}`;
      const phoneB = `073${uniq}`;

      // สร้าง 2 ใบตรง ๆ ผ่าน pool (จำลองเลขคิวชนกันข้ามลูกค้าที่หลุดผ่านกลไกกันชน
      // ปกติของ webhook มาได้ — เช่นข้อมูลเก่า/กรอกผ่านเว็บ) ไม่ผ่าน webhook เพราะ
      // webhook มีกลไกเปลี่ยนเลขคิวอัตโนมัติกันชนอยู่แล้วตามปกติ
      const [custA] = await pool.query(
        'INSERT INTO customers (customer_code, customer_name, phone) VALUES (?, ?, ?)',
        [`CMM-TEST${uniq}A`, 'คุณคิวชนเอ', phoneA]
      );
      const [custB] = await pool.query(
        'INSERT INTO customers (customer_code, customer_name, phone) VALUES (?, ?, ?)',
        [`CMM-TEST${uniq}B`, 'คุณคิวชนบี', phoneB]
      );
      createdCustomerIds.push(custA.insertId, custB.insertId);

      const [vehA] = await pool.query(
        "INSERT INTO vehicles (customer_id, brand, model, license_plate) VALUES (?, 'Toyota', 'Vios', ?)",
        [custA.insertId, `9กจ${uniq.slice(0, 4)}A`]
      );
      const [vehB] = await pool.query(
        "INSERT INTO vehicles (customer_id, brand, model, license_plate) VALUES (?, 'Toyota', 'Vios', ?)",
        [custB.insertId, `9กจ${uniq.slice(0, 4)}B`]
      );

      const [qA] = await pool.query(
        `INSERT INTO quotations (quotation_no, quotation_date, customer_id, vehicle_id, mileage, product_summary, total_amount, queue_no)
         VALUES (?, CURDATE(), ?, ?, 0, 'ค่าแรง', 1000, ?)`,
        [`IVTEST${uniq}A`, custA.insertId, vehA.insertId, queueNo]
      );
      const [qB] = await pool.query(
        `INSERT INTO quotations (quotation_no, quotation_date, customer_id, vehicle_id, mileage, product_summary, total_amount, queue_no)
         VALUES (?, CURDATE(), ?, ?, 0, 'ค่าแรง', 2000, ?)`,
        [`IVTEST${uniq}B`, custB.insertId, vehB.insertId, queueNo]
      );

      const closeText = `คิว ${queueNo}\nช่องทางการชำระ: เงินสด\nลูกค้าชำระเงิน: 1000\nชำระเงินเรียบร้อย`;
      const res = await postWebhook(eventsBody([messageEvent(closeText, `msg-closeonly-ambig-${uniq}`)]));
      expect(res.status).toBe(200);

      const [[qAAfter]] = await pool.query('SELECT status, closed_at FROM quotations WHERE id = ?', [qA.insertId]);
      const [[qBAfter]] = await pool.query('SELECT status, closed_at FROM quotations WHERE id = ?', [qB.insertId]);
      expect(qAAfter.status).toBe('pending');
      expect(qAAfter.closed_at).toBeNull();
      expect(qBAfter.status).toBe('pending');
      expect(qBAfter.closed_at).toBeNull();
    });
  });

  describe('มัดจำ (deposit_amount/deposit_date) ไหลผ่าน create → resend แก้ไข → ปิดบิล → ใบเสร็จ', () => {
    test('resend ที่ไม่ได้พิมพ์ "มัดจำ:" ซ้ำ ไม่ล้างมัดจำเดิมทิ้ง แล้วปิดบิลด้วยข้อความสั้น → ใบเสร็จมีมัดจำเดียวกัน', async () => {
      const uniq = Date.now().toString().slice(-7);
      const phone = `075${uniq}`;
      const queueNo = `97${uniq}`;
      const plate = `3คค${uniq.slice(0, 4)}`;

      const first = await postWebhook(eventsBody([messageEvent(
        templateText({
          queueNo,
          name: 'คุณมัดจำไหล',
          phone,
          plate,
          items: [{ name: 'ค่าแรง', price: 10000 }],
          payment: { statedTotal: 10000, deposit: 4000, remainingBalance: 6000 },
        }),
        `msg-depositflow1-${uniq}`
      )]));
      expect(first.body.created).toHaveLength(1);
      const firstNo = first.body.created[0];
      const [[q1]] = await pool.query(
        'SELECT id, customer_id, deposit_amount, deposit_date FROM quotations WHERE quotation_no = ?',
        [firstNo]
      );
      createdCustomerIds.push(q1.customer_id);
      expect(Number(q1.deposit_amount)).toBe(4000);

      // resend เพิ่มรายการ ไม่พิมพ์ "มัดจำ:" ซ้ำ — มัดจำเดิมต้องไม่หาย (COALESCE)
      const second = await postWebhook(eventsBody([messageEvent(
        `คิว:${queueNo}\nชื่อลูกค้า:คุณมัดจำไหล\nเบอร์โทร:${phone}\nทะเบียนรถ:${plate}\nรายการ:\nค่าแรง 10000\nอะไหล่ 500`,
        `msg-depositflow2-${uniq}`
      )]));
      expect(second.body.created).toHaveLength(1);
      expect(second.body.created[0]).toBe(firstNo);

      const [[q1After]] = await pool.query('SELECT deposit_amount, total_amount FROM quotations WHERE id = ?', [q1.id]);
      expect(Number(q1After.deposit_amount)).toBe(4000); // ยังอยู่ ไม่หาย
      expect(Number(q1After.total_amount)).toBe(10500);

      // ปิดบิลด้วยข้อความสั้น (close_only)
      const closeText = `คิว ${queueNo}\nช่องทางการชำระ: เงินสด\nลูกค้าชำระเงิน: 6500\nชำระเงินเรียบร้อย`;
      const third = await postWebhook(eventsBody([messageEvent(closeText, `msg-depositflow3-${uniq}`)]));
      expect(third.status).toBe(200);

      const [[q1Final]] = await pool.query(
        'SELECT converted_receipt_id, status, closed_at FROM quotations WHERE id = ?',
        [q1.id]
      );
      expect(q1Final.status).toBe('approved');
      expect(q1Final.closed_at).toBeTruthy();

      const [[receipt]] = await pool.query(
        'SELECT deposit_amount, deposit_date, total_amount FROM receipts WHERE id = ?',
        [q1Final.converted_receipt_id]
      );
      expect(Number(receipt.deposit_amount)).toBe(4000);
      expect(Number(receipt.total_amount)).toBe(10500); // ยอดรวมทั้งบิล ไม่ใช่ยอดที่จ่าย 6500
    });
  });
});
