// One bot 3 closes bills for every branch: the group decides the branch, a group must be bound with a manager's code,
// and a close only touches a bill of the date in the message.
const crypto = require('crypto');
const request = require('supertest');

const TEST_SECRET = 'test-line-bot3-secret';
process.env.LINE_BOT3_CHANNEL_SECRET = TEST_SECRET;
process.env.LINE_BOT3_CHANNEL_ACCESS_TOKEN = 'test-bot3-token';

const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { createShop, dropShop } = require('./helpers');

const app = createApp();
const as = (token) => ({ Authorization: `Bearer ${token}` });

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const thaiDate = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear() + 543).slice(-2)}`;
const today = new Date();
const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

let shopA;
let shopB;
let replies;
let nextMessageId = Date.now();
let nextGroup = 0;
const newGroup = () => { nextGroup += 1; return `Cgroup${nextMessageId}x${nextGroup}`; };

function postEvents(events) {
  const rawBody = JSON.stringify({ events });
  return request(app)
    .post('/api/line/bot3/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Line-Signature', crypto.createHmac('sha256', TEST_SECRET).update(rawBody).digest('base64'))
    .send(rawBody);
}

// Sends a text from a group; returns the bot's reply text (or undefined when it stays silent)
async function say(groupId, text, messageId) {
  replies.length = 0;
  nextMessageId += 1;
  const res = await postEvents([{
    type: 'message',
    replyToken: 'reply-token',
    source: groupId ? { type: 'group', groupId } : { type: 'user', userId: 'U1' },
    message: { type: 'text', id: String(messageId || nextMessageId), text },
  }]);
  expect(res.status).toBe(200);
  return replies[0];
}

const closeText = (queueNo, { date, method = 'โอน', paid = 1000 } = {}) => [
  `คิว ${queueNo}`,
  ...(date ? [thaiDate(date)] : []),
  ...(method ? [`ช่องทางการชำระ: ${method}`] : []),
  `ลูกค้าชำระเงิน: ${paid}`,
  'ชำระเงินเรียบร้อย',
].join('\n');

async function bindCode(shop) {
  const res = await request(app).post('/api/settings/line/bot3-bind-code').set(as(shop.managerToken));
  expect(res.status).toBe(200);
  return res.body.data.code;
}

async function bind(shop, groupId) {
  const reply = await say(groupId, `ผูกกลุ่มปิดบิล ${await bindCode(shop)}`);
  expect(reply).toContain('ผูกกลุ่มนี้กับสาขา');
  return reply;
}

async function seedBill(shop, { queueNo, date = today, plate = `T${crypto.randomUUID().slice(0, 7)}`, status = 'pending', jobQueueNo } = {}) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [customer] = await pool.query(
    "INSERT INTO customers (shop_id, customer_code, customer_name, phone, found_via) VALUES (?, ?, ?, '0811111111', 'returning')",
    [shop.shopId, `B3-${suffix}`, `Customer ${suffix}`]
  );
  const [vehicle] = await pool.query(
    "INSERT INTO vehicles (shop_id, customer_id, brand, model, color, license_plate, mileage) VALUES (?, ?, 'Toyota', 'Vios', 'Black', ?, 0)",
    [shop.shopId, customer.insertId, plate]
  );
  const [quotation] = await pool.query(
    `INSERT INTO quotations (shop_id, quotation_no, quotation_date, customer_id, vehicle_id, mileage, product_summary, total_amount, queue_no, status)
     VALUES (?, ?, ?, ?, ?, 0, 'Part', 1000, ?, ?)`,
    [shop.shopId, `IV-${suffix}`, isoDate(date), customer.insertId, vehicle.insertId, queueNo, status]
  );
  await pool.query(
    'INSERT INTO quotation_items (quotation_id, product_name, quantity, unit_price) VALUES (?, ?, 1, 1000)',
    [quotation.insertId, 'Part']
  );
  if (jobQueueNo) {
    await pool.query(
      "INSERT INTO jobs (shop_id, job_no, queue_no, job_date, customer_id, vehicle_id, quotation_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'received')",
      [shop.shopId, `JB-${suffix}`, jobQueueNo, isoDate(date), customer.insertId, vehicle.insertId, quotation.insertId]
    );
  }
  return { quotationId: quotation.insertId, customerId: customer.insertId, vehicleId: vehicle.insertId, plate };
}

async function billState(quotationId) {
  const [[row]] = await pool.query(
    `SELECT q.closed_at, q.converted_receipt_id, r.shop_id AS receipt_shop_id, r.payment_method, r.total_amount
     FROM quotations q LEFT JOIN receipts r ON r.id = q.converted_receipt_id WHERE q.id = ?`,
    [quotationId]
  );
  return row;
}

async function cleanShop(shop) {
  await pool.query('DELETE FROM jobs WHERE shop_id = ?', [shop.shopId]);
  await pool.query('UPDATE quotations SET converted_receipt_id = NULL WHERE shop_id = ?', [shop.shopId]);
  await pool.query('DELETE ri FROM receipt_items ri JOIN receipts r ON r.id = ri.receipt_id WHERE r.shop_id = ?', [shop.shopId]);
  await pool.query('DELETE qi FROM quotation_items qi JOIN quotations q ON q.id = qi.quotation_id WHERE q.shop_id = ?', [shop.shopId]);
  await dropShop(shop.shopId);
}

beforeAll(async () => {
  shopA = await createShop();
  shopB = await createShop();
  await pool.query('UPDATE shops SET name = ? WHERE id = ?', ['แชมป์พาวเวอร์ PKS', shopB.shopId]);
});

beforeEach(() => {
  replies = [];
  jest.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
    if (String(url).includes('api.line.me')) replies.push(JSON.parse(options.body).messages[0].text);
    return { ok: true, text: async () => '' };
  });
});

afterEach(() => { jest.restoreAllMocks(); });

afterAll(async () => {
  await cleanShop(shopA);
  await cleanShop(shopB);
  await pool.end();
});

describe('bot 3 webhook', () => {
  test('a wrong signature is refused', async () => {
    const res = await request(app).post('/api/line/bot3/webhook').set('X-Line-Signature', 'nope').send({ events: [] });
    expect(res.status).toBe(401);
  });

  describe('binding a group to a branch', () => {
    test('only a manager and above can create a code', async () => {
      expect((await request(app).post('/api/settings/line/bot3-bind-code').set(as(shopA.token))).status).toBe(403);
      expect((await request(app).delete('/api/settings/line/bot3-group').set(as(shopA.token))).status).toBe(403);
      expect((await request(app).get('/api/settings/line/bot3-group').set(as(shopA.token))).status).toBe(403);
    });

    test('a wrong code and an expired code bind nothing', async () => {
      const group = newGroup();
      expect(await say(group, 'ผูกกลุ่มปิดบิล 000000')).toContain('หมดอายุ');
      const code = await bindCode(shopA);
      await pool.query("UPDATE app_settings SET value = ? WHERE shop_id = ? AND `key` = 'line_bot3_bind_code'", [`${code}|${Date.now() - 1000}`, shopA.shopId]);
      expect(await say(group, `ผูกกลุ่มปิดบิล ${code}`)).toContain('หมดอายุ');
      expect((await request(app).get('/api/settings/line/bot3-group').set(as(shopA.managerToken))).body.data.bound).toBe(false);
    });

    test('a code binds the group to the branch that made it, and works once', async () => {
      const group = newGroup();
      const code = await bindCode(shopB);
      expect(await say(group, `ผูกกลุ่มปิดบิล ${code}`)).toContain('แชมป์พาวเวอร์ PKS');
      const status = (await request(app).get('/api/settings/line/bot3-group').set(as(shopB.managerToken))).body.data;
      expect(status).toEqual({ bound: true, group_tail: group.slice(-6) });
      expect((await request(app).get('/api/settings/line/bot3-group').set(as(shopA.managerToken))).body.data.bound).toBe(false);
      expect(await say(newGroup(), `ผูกกลุ่มปิดบิล ${code}`)).toContain('หมดอายุ');
    });

    test('a group moved to another branch stops closing for the old one', async () => {
      const group = newGroup();
      await bind(shopA, group);
      await bind(shopB, group);
      expect((await request(app).get('/api/settings/line/bot3-group').set(as(shopA.managerToken))).body.data.bound).toBe(false);
      expect((await request(app).get('/api/settings/line/bot3-group').set(as(shopB.managerToken))).body.data.group_tail).toBe(group.slice(-6));
    });

    test('the settings form cannot set the group by hand', async () => {
      const group = newGroup();
      await bind(shopA, group);
      const res = await request(app).put('/api/settings/line').set(as(shopA.managerToken)).send({ group_ids: { line_group_id_bot3: 'Cstolen' } });
      expect(res.status).toBe(200);
      expect((await request(app).get('/api/settings/line/bot3-group').set(as(shopA.managerToken))).body.data.group_tail).toBe(group.slice(-6));
    });

    test('unbinding stops the group closing bills', async () => {
      const group = newGroup();
      await bind(shopA, group);
      const waitingCode = await bindCode(shopA);
      expect((await request(app).delete('/api/settings/line/bot3-group').set(as(shopA.managerToken))).status).toBe(200);
      expect(await say(newGroup(), `ผูกกลุ่มปิดบิล ${waitingCode}`)).toContain('หมดอายุ');
      const bill = await seedBill(shopA, { queueNo: '90' });
      expect(await say(group, closeText('90'))).toContain('ยังไม่ได้ผูก');
      expect((await billState(bill.quotationId)).closed_at).toBeNull();
    });

    test('the settings page reports which bots belong to the branch', async () => {
      const res = await request(app).get('/api/settings/line').set(as(shopB.managerToken));
      expect(res.body.data.is_main_shop).toBe(false);
      expect(res.body.data.bot3_group).toHaveProperty('bound');
      expect(res.body.data.group_ids).not.toHaveProperty('line_group_id_bot3');
    });
  });

  describe('closing a bill', () => {
    let groupA;
    let groupB;

    beforeEach(async () => {
      groupA = newGroup();
      groupB = newGroup();
      await bind(shopA, groupA);
      await bind(shopB, groupB);
    });

    test('a group never bound, or a private chat, closes nothing and says so', async () => {
      const bill = await seedBill(shopA, { queueNo: '11' });
      expect(await say(newGroup(), closeText('11'))).toContain('ยังไม่ได้ผูก');
      expect(await say(null, closeText('11'))).toContain('ยังไม่ได้ผูก');
      expect((await billState(bill.quotationId)).closed_at).toBeNull();
    });

    test('ordinary chat in an unbound group stays silent', async () => {
      expect(await say(newGroup(), 'สวัสดีครับ')).toBeUndefined();
    });

    test('each group closes the bill of its own branch, with the same queue number in both', async () => {
      const billA = await seedBill(shopA, { queueNo: '12' });
      const billB = await seedBill(shopB, { queueNo: '12' });

      const reply = await say(groupB, closeText('12', { method: 'เงินสด', paid: 1500 }));
      expect(reply).toContain('ปิดบิล');
      expect(reply).toContain(billB.plate);

      const closedB = await billState(billB.quotationId);
      expect(closedB.closed_at).not.toBeNull();
      expect(closedB.receipt_shop_id).toBe(shopB.shopId);
      expect(closedB.payment_method).toBe('เงินสด');
      expect(Number(closedB.total_amount)).toBe(1500);
      expect((await billState(billA.quotationId)).closed_at).toBeNull();

      await say(groupA, closeText('12'));
      expect((await billState(billA.quotationId)).receipt_shop_id).toBe(shopA.shopId);
    });

    test('a bill approved on the web keeps its receipt and gets the payment', async () => {
      const bill = await seedBill(shopB, { queueNo: '13', status: 'approved' });
      const [receipt] = await pool.query(
        "INSERT INTO receipts (shop_id, receipt_no, receipt_date, customer_id, vehicle_id, total_amount, car_sequence_no) SELECT shop_id, ?, CURDATE(), customer_id, vehicle_id, 1000, 999 FROM quotations WHERE id = ?",
        [`RC-${bill.quotationId}`, bill.quotationId]
      );
      await pool.query('UPDATE quotations SET converted_receipt_id = ? WHERE id = ?', [receipt.insertId, bill.quotationId]);
      expect(await say(groupB, closeText('13'))).toContain(`RC-${bill.quotationId}`);
      const state = await billState(bill.quotationId);
      expect(state.converted_receipt_id).toBe(receipt.insertId);
      expect(state.payment_method).toBe('โอน');
      expect(state.closed_at).not.toBeNull();
    });

    test('without a date only today counts: an older open bill with that number is left alone', async () => {
      const old = await seedBill(shopB, { queueNo: '14', date: yesterday });
      const reply = await say(groupB, closeText('14'));
      expect(reply).toContain('ไม่พบบิล');
      expect(reply).toContain(thaiDate(today));
      expect((await billState(old.quotationId)).closed_at).toBeNull();

      expect(await say(groupB, closeText('14', { date: yesterday }))).toContain('ปิดบิล');
      expect((await billState(old.quotationId)).closed_at).not.toBeNull();
    });

    test('a typed date only matches that date', async () => {
      const bill = await seedBill(shopB, { queueNo: '15' });
      expect(await say(groupB, closeText('15', { date: yesterday }))).toContain('ไม่พบบิล');
      expect((await billState(bill.quotationId)).closed_at).toBeNull();
    });

    test('sending the close again never reaches another customer', async () => {
      const old = await seedBill(shopB, { queueNo: '16', date: yesterday });
      const todays = await seedBill(shopB, { queueNo: '16' });
      expect(await say(groupB, closeText('16'))).toContain('ปิดบิล');
      expect(await say(groupB, closeText('16'))).toContain('ไม่พบบิล');
      expect((await billState(todays.quotationId)).closed_at).not.toBeNull();
      expect((await billState(old.quotationId)).closed_at).toBeNull();
    });

    // ลูกค้านัดหมาย: the bill was made on an earlier day, then the queue is created from the appointment page
    describe('a bill from an appointment', () => {
      const queueFromAppointment = async (shop, bill, queueNo) => {
        const res = await request(app).post('/api/jobs').set(as(shop.managerToken)).send({
          vehicle_id: bill.vehicleId, customer_id: bill.customerId, queue_no: queueNo, quotation_id: bill.quotationId, symptom: 'นัดมาทำ',
        });
        expect(res.status).toBe(201);
        return res.body;
      };

      test.each(['scheduled', 'no_date', 'parts_ready', 'pending'])('made yesterday as %s, queued today: closes by the number on the card', async (status) => {
        const queueNo = String(30 + ['scheduled', 'no_date', 'parts_ready', 'pending'].indexOf(status));
        const bill = await seedBill(shopB, { queueNo: '777', date: yesterday, status });
        const job = await queueFromAppointment(shopB, bill, queueNo);
        const reply = await say(groupB, closeText(job.queue_no));
        expect(reply).toContain('ปิดบิล');
        const state = await billState(bill.quotationId);
        expect(state.closed_at).not.toBeNull();
        expect(state.receipt_shop_id).toBe(shopB.shopId);
      });

      test('made and queued on the same day as parts_ready: closes too', async () => {
        const bill = await seedBill(shopB, { queueNo: '778', status: 'parts_ready' });
        const job = await queueFromAppointment(shopB, bill, '41');
        expect(await say(groupB, closeText(job.queue_no))).toContain('ปิดบิล');
        expect((await billState(bill.quotationId)).closed_at).not.toBeNull();
      });

      test('the card number closes it even if the old number on the bill belongs to someone else today', async () => {
        const bill = await seedBill(shopB, { queueNo: '42', date: yesterday, status: 'scheduled' });
        const other = await seedBill(shopB, { queueNo: '42' });
        const job = await queueFromAppointment(shopB, bill, '43');
        expect(await say(groupB, closeText(job.queue_no))).toContain('ปิดบิล');
        expect((await billState(bill.quotationId)).closed_at).not.toBeNull();
        expect((await billState(other.quotationId)).closed_at).toBeNull();
      });

      test('a car moved to another day closes on the day on its card, not the day on the bill', async () => {
        const bill = await seedBill(shopB, { queueNo: '44', date: yesterday, jobQueueNo: '44', status: 'approved' });
        const [[row]] = await pool.query('SELECT id FROM jobs WHERE quotation_id = ?', [bill.quotationId]);
        const [receipt] = await pool.query(
          "INSERT INTO receipts (shop_id, receipt_no, receipt_date, customer_id, vehicle_id, mileage, total_amount, car_sequence_no) VALUES (?, ?, ?, ?, ?, 0, 1000, ?)",
          [shopB.shopId, `RC-M-${bill.quotationId}`, isoDate(yesterday), bill.customerId, bill.vehicleId, 7000 + bill.quotationId]
        );
        await pool.query('UPDATE quotations SET converted_receipt_id = ? WHERE id = ?', [receipt.insertId, bill.quotationId]);
        await pool.query("UPDATE jobs SET status = 'repairing' WHERE id = ?", [row.id]);
        const moved = await request(app).patch('/api/jobs/move-date').set(as(shopB.managerToken)).send({ ids: [row.id], job_date: isoDate(today) });
        expect(moved.status).toBe(200);
        const [[after]] = await pool.query('SELECT queue_no FROM jobs WHERE id = ?', [row.id]);
        expect(await say(groupB, closeText(after.queue_no))).toContain('ปิดบิล');
        expect((await billState(bill.quotationId)).closed_at).not.toBeNull();
      });

      test('a car that went home to wait for its appointment and came back on the same job closes too', async () => {
        const bill = await seedBill(shopB, { queueNo: '45', jobQueueNo: '45', status: 'scheduled' });
        await pool.query("UPDATE jobs SET status = 'received' WHERE quotation_id = ?", [bill.quotationId]);
        expect(await say(groupB, closeText('45'))).toContain('ปิดบิล');
        expect((await billState(bill.quotationId)).closed_at).not.toBeNull();
      });

      test('the job page lists its bill even when the dates differ', async () => {
        const bill = await seedBill(shopB, { queueNo: '46', date: yesterday, jobQueueNo: '46' });
        const [[row]] = await pool.query('SELECT id FROM jobs WHERE quotation_id = ?', [bill.quotationId]);
        await pool.query('UPDATE jobs SET job_date = ? WHERE id = ?', [isoDate(today), row.id]);
        const list = await request(app).get(`/api/jobs/${row.id}/quotations`).set(as(shopB.managerToken));
        expect(list.body.data.map((q) => q.id)).toContain(bill.quotationId);
      });
    });

    test('LINE delivering the same message twice closes and replies once', async () => {
      const first = await seedBill(shopB, { queueNo: '17' });
      const second = await seedBill(shopB, { queueNo: '18' });
      const messageId = `dup-${Date.now()}`;
      expect(await say(groupB, closeText('17'), messageId)).toContain('ปิดบิล');
      expect(await say(groupB, closeText('18'), messageId)).toBeUndefined();
      expect((await billState(first.quotationId)).closed_at).not.toBeNull();
      expect((await billState(second.quotationId)).closed_at).toBeNull();
    });

    test('no payment method: nothing closes and the bot says what is missing', async () => {
      const bill = await seedBill(shopB, { queueNo: '19' });
      expect(await say(groupB, closeText('19', { method: null }))).toContain('ช่องทางชำระ');
      expect((await billState(bill.quotationId)).closed_at).toBeNull();
    });

    test('the number on the queue card wins over an out-of-date number in the bill', async () => {
      const bill = await seedBill(shopB, { queueNo: '3', jobQueueNo: '20' });
      expect(await say(groupB, closeText('3'))).toContain('ไม่พบบิล');
      expect((await billState(bill.quotationId)).closed_at).toBeNull();
      expect(await say(groupB, closeText('20'))).toContain('ปิดบิล');
      expect((await billState(bill.quotationId)).closed_at).not.toBeNull();
    });

    test('two bills with one number are not guessed', async () => {
      const a = await seedBill(shopB, { queueNo: '21' });
      const b = await seedBill(shopB, { queueNo: '21' });
      expect(await say(groupB, closeText('21'))).toContain('หลายบิล');
      expect((await billState(a.quotationId)).closed_at).toBeNull();
      expect((await billState(b.quotationId)).closed_at).toBeNull();
    });

    test('a bound group can still check a total, which changes nothing', async () => {
      const bill = await seedBill(shopB, { queueNo: '22' });
      const text = [
        'คิว: 22', 'ชื่อ: ลูกค้าทดสอบ', 'เบอโทรศัพท์: 081-111-1111', 'รายการ:', 'ลูกหมาก 400', 'โช๊ค 600', '<--สิ้นสุดรายการ-->', 'ยอดรวม: 1000',
      ].join('\n');
      expect(await say(groupB, text)).toContain('ยอดตรงกัน');
      expect((await billState(bill.quotationId)).closed_at).toBeNull();
    });

    test('replies use the messages the branch set for itself', async () => {
      await request(app).put('/api/settings/line').set(as(shopB.managerToken)).send({ messages: { bot3_close_no_payment: 'B custom {{queue_no}}' } });
      expect(await say(groupB, closeText('23', { method: null }))).toBe('B custom 23');
      expect(await say(groupA, closeText('23', { method: null }))).toContain('ยังไม่ได้ปิดบิล');
    });
  });
});

describe('branch code and links per branch', () => {
  test('the public queue screen names its own branch and shows its own cars', async () => {
    const [[shop]] = await pool.query('SELECT code FROM shops WHERE id = ?', [shopB.shopId]);
    const res = await request(app).get(`/api/board?shop=${shop.code}`);
    expect(res.status).toBe(200);
    expect(res.body.branch_code).toBe('PKS');
    expect((await request(app).get('/api/board')).body.branch_code).toBe('SPK');
  });

  test('a code set by a manager replaces the one from the name everywhere', async () => {
    const [[shop]] = await pool.query('SELECT code FROM shops WHERE id = ?', [shopB.shopId]);
    await request(app).put('/api/doc-settings/repair_notice').set(as(shopB.managerToken)).send({ branch_text: 'pk9' });
    expect((await request(app).get(`/api/board?shop=${shop.code}`)).body.branch_code).toBe('PK9');
    await request(app).put('/api/doc-settings/repair_notice').set(as(shopB.managerToken)).send({ branch_text: '' });
    expect((await request(app).get(`/api/board?shop=${shop.code}`)).body.branch_code).toBe('PKS');
  });

  test('the signed-in branch learns its shop code for public links', async () => {
    const [[shop]] = await pool.query('SELECT code FROM shops WHERE id = ?', [shopB.shopId]);
    const res = await request(app).get('/api/doc-settings').set(as(shopB.token));
    expect(res.body.data.shop.code).toBe(shop.code);
  });

  test('a tracking QR leads to its own branch, the main shop keeps its short link', async () => {
    const [[shop]] = await pool.query('SELECT code FROM shops WHERE id = ?', [shopB.shopId]);
    const res = await request(app).get('/api/jobs/qr/track').set(as(shopB.token));
    expect(res.status).toBe(200);
    expect(res.body.tracking_url).toMatch(new RegExp(`/track\\?shop=${shop.code}$`));
  });
});
