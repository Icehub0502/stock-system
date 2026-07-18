const crypto = require('crypto');
const request = require('supertest');

// route อ่าน LINE_CHANNEL_SECRET จาก env ตอนรับ request — ต้องตั้งก่อนยิงเทสต์
// (.env.test ไม่มีค่านี้ และไม่มีเทสต์ไฟล์อื่นแตะ webhook จึงไม่รั่วไปกวนใคร)
const TEST_SECRET = 'test-line-channel-secret';
process.env.LINE_CHANNEL_SECRET = TEST_SECRET;

const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const lineWebhookRouter = require('../src/routes/lineWebhook.routes');

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
    const text = `คิว14\nคุณ ทดสอบสิบ\n${phone}\nToyota Altis 09\nทอง\n215170\nอาการ ขับมีเสียงดัง ก๊อกๆ`;

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
      eventsBody([messageEvent(`คิว14\nคุณ ทดสอบสิบ\n${phone}\nToyota Altis 09\nทอง\n215500\nอาการ ขับมีเสียงดัง ก๊อกๆ`, `msg-cm2-${uniq}`)])
    );
    expect(res2.status).toBe(200);

    const [vehicles] = await pool.query('SELECT id, mileage FROM vehicles WHERE customer_id = ?', [quotation.customer_id]);
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].mileage).toBe(215500);
  });

  test('รายการ "1700*2 3,400" → quantity 2 + unit_price 1700 ลงใบเสนอราคา ยอดรวมถูก', async () => {
    const uniq = Date.now().toString().slice(-7);
    const phone = `090${uniq}`;
    const text = `คิว15\nคุณ ทดสอบสิบสาม\n${phone}\nรายการ:\nลูกปืนล้อหน้า L+R 1700*2 3,400\nซ่อมคอ 2000`;

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
});
