const request = require('supertest');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { getOfficeToken, getManagerToken, getTechnicianToken } = require('./helpers');
const { addMonths, warrantyStatus, isRackText, isRegisterText, todayInThailand } = require('../src/utils/warrantyStatus');

const app = createApp();

describe('warranty status — ends at the time limit or the distance limit, whichever comes first', () => {
  const base = { warrantyYear: 1, warrantyMonth: 0, warrantyKm: 100000, startDate: '2026-01-15', startKm: 50000, currentKm: 60000 };

  test('counts down time and distance', () => {
    const s = warrantyStatus({ ...base, today: '2026-06-15' });
    expect(s).toMatchObject({ status: 'active', expires_on: '2027-01-15', days_left: 214, km_limit: 150000, km_left: 90000 });
  });
  test('close to either limit is soon, past either limit is expired', () => {
    expect(warrantyStatus({ ...base, today: '2026-12-20' }).status).toBe('soon');
    expect(warrantyStatus({ ...base, today: '2026-06-15', currentKm: 149000 }).status).toBe('soon');
    expect(warrantyStatus({ ...base, today: '2027-01-15' }).days_left).toBe(0);
    expect(warrantyStatus({ ...base, today: '2027-01-16' }).status).toBe('expired');
    expect(warrantyStatus({ ...base, today: '2026-06-15', currentKm: 150000 }).status).toBe('expired');
  });
  test('a limit that does not apply does not end it', () => {
    const noKm = warrantyStatus({ ...base, warrantyKm: 0, warrantyYear: 0, warrantyMonth: 6, today: '2026-02-15' });
    expect(noKm).toMatchObject({ status: 'active', expires_on: '2026-07-15', km_limit: null, km_left: null });
    const kmOnly = warrantyStatus({ ...base, warrantyYear: 0, today: '2040-01-01' });
    expect(kmOnly).toMatchObject({ status: 'active', expires_on: null, days_left: null });
    const noReading = warrantyStatus({ ...base, startKm: 0, today: '2026-06-15' });
    expect(noReading).toMatchObject({ status: 'active', km_limit: null });
    expect(warrantyStatus({ warrantyYear: 0, warrantyMonth: 0, warrantyKm: 0, startDate: '2026-01-15' }).status).toBe('none');
  });
  test('a car reading below the bill does not add distance', () => {
    expect(warrantyStatus({ ...base, currentKm: 1000, today: '2026-06-15' }).km_left).toBe(100000);
  });
  test('month ends and leap years', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-02-29', 12)).toBe('2029-02-28');
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
  });
  test('today is the Thai date', () => {
    expect(todayInThailand(new Date('2026-11-06T18:00:00Z'))).toBe('2026-11-07');
  });
  test('which items the register follows', () => {
    expect(isRackText('เปลี่ยนแร็คพวงมาลัย')).toBe(true);
    expect(isRackText('ลูกหมากปลายแร็ค')).toBe(true);
    expect(isRackText('ลูกหมากปีกนก')).toBe(false);
    expect(isRegisterText('ลูกหมากปีกนก')).toBe(true);
    expect(isRegisterText('ชุดโปรช่วงล่าง')).toBe(true);
    expect(isRegisterText('เปลี่ยนน้ำมันเครื่อง')).toBe(false);
    expect(isRegisterText(null)).toBe(false);
  });
});

describe('/api/warranty-register', () => {
  let officeToken;
  let managerToken;
  let techToken;
  let customerId;
  let vehicleId;
  const suffix = Date.now().toString(36).toUpperCase();
  const jobIds = [];
  const receiptIds = [];
  let savedStart;
  let startNo;

  const as = (token, req) => req.set('Authorization', `Bearer ${token}`);
  const assign = (token, body) => as(token, request(app).post('/api/warranty-register/assign')).send(body);
  const of = (token, query) => as(token, request(app).get('/api/warranty-register/of')).query(query);
  const list = (query = {}) => as(officeToken, request(app).get('/api/warranty-register')).query(query);

  async function makeReceipt(items, { date = todayInThailand(), mileage = 50000 } = {}) {
    const [r] = await pool.query(
      `INSERT INTO receipts (shop_id, receipt_no, receipt_date, customer_id, vehicle_id, mileage, total_amount, car_sequence_no)
       VALUES (1, ?, ?, ?, ?, ?, 100, ?)`,
      [`WR-${suffix}-${receiptIds.length}`, date, customerId, vehicleId, mileage, 900000000 + (Date.now() % 90000000) + receiptIds.length]
    );
    receiptIds.push(r.insertId);
    for (const item of items) {
      await pool.query(
        `INSERT INTO receipt_items (receipt_id, product_name_snapshot, qty, price, amount, warranty_name, warranty_year, warranty_month, warranty_km)
         VALUES (?, ?, 1, 100, 100, ?, ?, ?, ?)`,
        [r.insertId, item.name, item.warranty ?? null, item.year ?? 0, item.month ?? 0, item.km ?? 0]
      );
    }
    return r.insertId;
  }

  async function makeJob(draftItems) {
    const [j] = await pool.query(
      `INSERT INTO jobs (shop_id, job_no, queue_no, job_date, customer_id, vehicle_id, status, quote_draft)
       VALUES (1, ?, 1, CURDATE(), ?, ?, 'inspecting', ?)`,
      [`WJ-${suffix}-${jobIds.length}`, customerId, vehicleId, JSON.stringify({ items: draftItems })]
    );
    jobIds.push(j.insertId);
    return j.insertId;
  }

  beforeAll(async () => {
    officeToken = await getOfficeToken();
    managerToken = await getManagerToken();
    techToken = await getTechnicianToken();
    const [c] = await pool.query("INSERT INTO customers (shop_id, customer_code, customer_name, phone) VALUES (1, ?, 'ทดสอบประกัน', '0800000000')", [`WR${suffix}`]);
    customerId = c.insertId;
    const [v] = await pool.query("INSERT INTO vehicles (shop_id, customer_id, brand, model, license_plate, mileage) VALUES (1, ?, 'TOYOTA', 'VIGO', ?, 60000)", [customerId, `WR-${suffix}`]);
    vehicleId = v.insertId;
    const [[shop]] = await pool.query('SELECT warranty_start_no FROM shops WHERE id = 1');
    savedStart = shop.warranty_start_no;
    const [[used]] = await pool.query('SELECT MAX(warranty_no) AS m FROM warranty_numbers WHERE shop_id = 1');
    startNo = (used.m || 0) + 1000;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM warranty_numbers WHERE shop_id = 1 AND warranty_no >= ?', [startNo - 1000]);
    if (receiptIds.length) {
      await pool.query('DELETE FROM receipt_items WHERE receipt_id IN (?)', [receiptIds]);
      await pool.query('DELETE FROM receipts WHERE id IN (?)', [receiptIds]);
    }
    if (jobIds.length) await pool.query('DELETE FROM jobs WHERE id IN (?)', [jobIds]);
    await pool.query('DELETE FROM vehicles WHERE id = ?', [vehicleId]);
    await pool.query('DELETE FROM customers WHERE id = ?', [customerId]);
    await pool.query('UPDATE shops SET warranty_start_no = ? WHERE id = 1', [savedStart]);
  });

  test('no number can be given until a manager sets where the branch starts', async () => {
    await pool.query('UPDATE shops SET warranty_start_no = NULL WHERE id = 1');
    const job = await makeJob([{ product_name: 'เปลี่ยนแร็คพวงมาลัย' }]);
    const refused = await assign(officeToken, { job_id: job });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/เลขเริ่มต้น/);

    expect((await as(officeToken, request(app).put('/api/warranty-register/settings')).send({ start_no: startNo })).status).toBe(403);
    expect((await as(managerToken, request(app).put('/api/warranty-register/settings')).send({ start_no: 0 })).status).toBe(400);
    const saved = await as(managerToken, request(app).put('/api/warranty-register/settings')).send({ start_no: startNo });
    expect(saved.status).toBe(200);
    expect(saved.body.next_no).toBe(startNo);
  });

  test('a rack job gets the next number once, and it runs in order', async () => {
    const job = await makeJob([{ product_name: 'เปลี่ยนแร็คพวงมาลัย' }]);
    const first = await assign(officeToken, { job_id: job });
    expect(first.status).toBe(201);
    expect(first.body.warranty_no).toBe(startNo);
    expect(first.body.warranty_label).toMatch(new RegExp(`${startNo}$`));

    const again = await assign(officeToken, { job_id: job });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ warranty_no: startNo, already: true });

    const other = await makeJob([{ product_name: 'แร็ค OEM' }]);
    expect((await assign(officeToken, { job_id: other })).body.warranty_no).toBe(startNo + 1);

    const info = await of(officeToken, { job_id: job });
    expect(info.body.data).toMatchObject({ has_rack: true, warranty_no: startNo, next_no: startNo + 2 });
  });

  test('racks only', async () => {
    const job = await makeJob([{ product_name: 'ลูกหมากปีกนก' }]);
    const res = await assign(officeToken, { job_id: job });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/แร็ค/);
    expect((await of(officeToken, { job_id: job })).body.data.has_rack).toBe(false);
  });

  test('a number on a job shows on its receipt, and the receipt does not get a second one', async () => {
    const job = await makeJob([{ product_name: 'แร็ค OEM' }]);
    const given = await assign(officeToken, { job_id: job });
    const receiptId = await makeReceipt([{ name: 'แร็ค OEM', warranty: 'แร็ค 1 ปี 100000 Km', year: 1, km: 100000 }]);
    const [q] = await pool.query(
      `INSERT INTO quotations (shop_id, quotation_no, quotation_date, customer_id, vehicle_id, total_amount, status, converted_receipt_id)
       VALUES (1, ?, CURDATE(), ?, ?, 100, 'approved', ?)`,
      [`WQ-${suffix}`, customerId, vehicleId, receiptId]
    );
    await pool.query('UPDATE jobs SET quotation_id = ?, quote_draft = NULL WHERE id = ?', [q.insertId, job]);

    const receipt = await as(officeToken, request(app).get(`/api/receipts/${receiptId}`));
    expect(receipt.body.data.warranty_label).toBe(given.body.warranty_label);
    const second = await assign(officeToken, { receipt_id: receiptId });
    expect(second.body).toMatchObject({ already: true, warranty_no: given.body.warranty_no });

    const row = (await list({ q: given.body.warranty_label })).body.data.rows[0];
    expect(row).toMatchObject({ receipt_id: receiptId, warranty_no: given.body.warranty_no, status: 'active', needs_number: false });
    await pool.query('UPDATE jobs SET quotation_id = NULL WHERE id = ?', [job]);
    await pool.query('DELETE FROM quotations WHERE id = ?', [q.insertId]);
  });

  test('a receipt with no job can get a number too', async () => {
    const receiptId = await makeReceipt([{ name: 'เปลี่ยนแร็ค', warranty: 'แร็ค 1 ปี 100000 Km', year: 1, km: 100000 }]);
    const before = (await list({ q: `WR-${suffix}`, status: 'needs_number' })).body.data.rows;
    expect(before.some((row) => row.receipt_id === receiptId)).toBe(true);
    const res = await assign(officeToken, { receipt_id: receiptId });
    expect(res.status).toBe(201);
    const after = (await list({ q: `WR-${suffix}`, status: 'needs_number' })).body.data.rows;
    expect(after.some((row) => row.receipt_id === receiptId)).toBe(false);
    expect((await as(officeToken, request(app).get(`/api/receipts/${receiptId}`))).body.data.warranty_label).toBe(res.body.warranty_label);
  });

  test('the register lists racks, suspension sets and ball joints, one row per warranty per bill', async () => {
    const receiptId = await makeReceipt([
      { name: 'ชุดโปรช่วงล่าง', warranty: 'ลูกหมาก 1 ปี 100000 Km', year: 1, km: 100000 },
      { name: '- ประกอบติดตั้ง', warranty: 'ลูกหมาก 1 ปี 100000 Km', year: 1, km: 100000 },
      { name: 'ลูกหมากไม่มีประกัน' },
      { name: 'เปลี่ยนน้ำมันเครื่อง' },
    ]);
    const rows = (await list({ q: `WR-${suffix}` })).body.data.rows.filter((row) => row.receipt_id === receiptId);
    expect(rows).toHaveLength(2);
    const covered = rows.find((row) => row.warranty_name);
    expect(covered.item_names).toEqual(['ชุดโปรช่วงล่าง', '- ประกอบติดตั้ง']);
    expect(covered).toMatchObject({ status: 'active', km_limit: 150000, km_left: 90000, needs_number: false });
    expect(rows.find((row) => !row.warranty_name).status).toBe('none');
  });

  test('an expired warranty is counted and filtered, and the job card shows only running ones', async () => {
    const receiptId = await makeReceipt([{ name: 'แร็คเก่า', warranty: 'แร็ค 1 ปี 100000 Km', year: 1, km: 100000 }], { date: '2020-01-01' });
    const res = await list({ status: 'expired', q: `WR-${suffix}` });
    expect(res.body.data.rows.some((row) => row.receipt_id === receiptId)).toBe(true);
    expect(res.body.data.counts.expired).toBeGreaterThan(0);
    const job = await makeJob([{ product_name: 'แร็ค OEM' }]);
    const running = (await of(officeToken, { job_id: job })).body.data.vehicle_warranties;
    expect(running.length).toBeGreaterThan(0);
    expect(running.some((row) => row.receipt_id === receiptId)).toBe(false);
  });

  test('typing a number is for managers, and a used number is refused', async () => {
    const job = await makeJob([{ product_name: 'แร็ค OEM' }]);
    expect((await assign(officeToken, { job_id: job, warranty_no: startNo + 500 })).status).toBe(403);
    expect((await assign(managerToken, { job_id: job, warranty_no: -1 })).status).toBe(400);
    expect((await assign(managerToken, { job_id: job, warranty_no: startNo })).status).toBe(409);
    const typed = await assign(managerToken, { job_id: job, warranty_no: startNo + 500 });
    expect(typed.body.warranty_no).toBe(startNo + 500);
    expect((await of(officeToken, { job_id: job })).body.data.next_no).toBe(startNo + 501);
  });

  test('voiding keeps the number on record, unused, and the job can take a new one', async () => {
    const job = await makeJob([{ product_name: 'แร็ค OEM' }]);
    const given = await assign(officeToken, { job_id: job });
    const info = (await of(officeToken, { job_id: job })).body.data;
    expect((await as(officeToken, request(app).post(`/api/warranty-register/numbers/${info.number_id}/void`))).status).toBe(403);
    expect((await as(managerToken, request(app).post(`/api/warranty-register/numbers/${info.number_id}/void`))).status).toBe(200);
    expect((await as(managerToken, request(app).post(`/api/warranty-register/numbers/${info.number_id}/void`))).status).toBe(404);
    const next = await assign(officeToken, { job_id: job });
    expect(next.body.warranty_no).toBe(given.body.warranty_no + 1);
    const voided = (await list({ status: 'void' })).body.data.rows;
    const row = voided.find((r) => r.warranty_no === given.body.warranty_no);
    expect(row).toMatchObject({ status: 'void', job_id: job, license_plate: `WR-${suffix}`, voided_by: expect.anything() });
    expect(row.voided_at).toBeTruthy();

    // looking for a voided number finds it, and it cannot be typed again
    const found = (await list({ q: given.body.warranty_label })).body.data.rows;
    expect(found.some((r) => r.status === 'void' && r.warranty_no === given.body.warranty_no)).toBe(true);
    const otherJob = await makeJob([{ product_name: 'แร็ค OEM' }]);
    const typedAgain = await assign(managerToken, { job_id: otherJob, warranty_no: given.body.warranty_no });
    expect(typedAgain.status).toBe(409);
    expect(typedAgain.body.error).toMatch(/ยกเลิก/);
  });

  test('access: technicians are out, and another shop cannot reach this job', async () => {
    expect((await as(techToken, request(app).get('/api/warranty-register'))).status).toBe(403);
    expect((await of(officeToken, {})).status).toBe(400);
    expect((await of(officeToken, { job_id: 1, receipt_id: 1 })).status).toBe(400);
    expect((await of(officeToken, { job_id: 999999999 })).status).toBe(404);
    expect((await assign(officeToken, { job_id: 999999999 })).status).toBe(404);
  });
});
