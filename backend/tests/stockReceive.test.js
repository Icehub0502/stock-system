const request = require('supertest');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { getOfficeToken, getTechnicianToken } = require('./helpers');

const app = createApp();

describe('/api/stock-receive — รับเข้าสต๊อกรวมตามบิล (เก็บรอยืนยัน → เสร็จสิ้นถึงบวกจริง) + QR', () => {
  let officeToken;
  let techToken;
  let categoryId;
  const suffix = Date.now().toString(36);
  const itemIds = [];
  const sessionIds = [];

  const asOffice = (req) => req.set('Authorization', `Bearer ${officeToken}`);
  const asTech = (req) => req.set('Authorization', `Bearer ${techToken}`);

  beforeAll(async () => {
    officeToken = await getOfficeToken();
    techToken = await getTechnicianToken();
    const cat = await asOffice(request(app).post('/api/stock-items/categories')).send({ name: `RCV-CAT-${suffix}` });
    categoryId = cat.body.id;
  });

  afterAll(async () => {
    if (sessionIds.length) await pool.query('DELETE FROM receipt_sessions WHERE id IN (?)', [sessionIds]);
    if (itemIds.length) {
      await pool.query('DELETE FROM stock_receive_lines WHERE item_id IN (?)', [itemIds]);
      await pool.query('DELETE FROM stock_item_movements WHERE item_id IN (?)', [itemIds]);
      await pool.query('DELETE FROM stock_items WHERE id IN (?)', [itemIds]);
    }
    await pool.execute('DELETE FROM stock_categories WHERE id = ?', [categoryId]);
  });

  async function createItem(extra) {
    const res = await asOffice(request(app).post('/api/stock-items')).send({
      category_id: categoryId, description: 'ทดสอบรับเข้า', ...extra,
    });
    if (res.body.id) itemIds.push(res.body.id);
    return res.body.id;
  }

  async function openSession(as = asOffice) {
    const res = await as(request(app).post('/api/transactions/receipt-session')).send({ invoice_no: `INV-${suffix}-${Math.random().toString(36).slice(2, 6)}` });
    sessionIds.push(res.body.id);
    return res.body.id;
  }

  const getItem = async (code) => (await asOffice(request(app).get('/api/stock-items')).query({ q: code })).body[0];
  const addLine = (as, body) => as(request(app).post('/api/stock-receive/lines')).send(body);
  const commit = (as, sessionId) => as(request(app).post(`/api/stock-receive/sessions/${sessionId}/commit`));

  test('lookup: รหัสของตำแหน่งและรหัสของธรรมดา เจอ / ไม่เจอคืนว่าง', async () => {
    const shock = await createItem({
      has_sides: true, has_axles: true,
      codes: { front_left: `FL-${suffix}`, front_right: `FR-${suffix}`, rear_left: `RL-${suffix}`, rear_right: `RR-${suffix}` },
      stocks: { front_left: 1, front_right: 1, rear_left: 1, rear_right: 1 },
    });
    const plain = await createItem({ oem_code: `PL-${suffix}`, stock_qty: 2 });

    const found = await asTech(request(app).get('/api/stock-receive/lookup')).query({ code: `RR-${suffix}` });
    expect(found.status).toBe(200);
    expect(found.body.matches).toHaveLength(1);
    expect(found.body.matches[0]).toMatchObject({ item_id: shock, position: 'rear_right', position_label: 'หลังขวา', qty: 1 });

    const plainRes = await asTech(request(app).get('/api/stock-receive/lookup')).query({ code: `PL-${suffix}` });
    expect(plainRes.body.matches[0]).toMatchObject({ item_id: plain, position: null, qty: 2 });

    const none = await asTech(request(app).get('/api/stock-receive/lookup')).query({ code: `NOPE-${suffix}` });
    expect(none.body.matches).toEqual([]);
    expect((await asTech(request(app).get('/api/stock-receive/lookup')).query({ code: '' })).status).toBe(400);
  });

  test('เพิ่มรายการ = ยังไม่บวกสต๊อก, แก้จำนวนได้, เสร็จสิ้นถึงบวกจริง และขึ้นในบิล', async () => {
    const itemId = await createItem({
      has_sides: true, codes: { left: `RL2-${suffix}`, right: `RR2-${suffix}` }, stocks: { left: 1, right: 1 },
    });
    const sessionId = await openSession(asTech);

    const added = await addLine(asTech, { item_id: itemId, position: 'right', qty: 3, receipt_session_id: sessionId });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ merged: false, qty: 3 });
    expect(added.body.line).toMatchObject({ position: 'right', position_label: 'ขวา', code: `RR2-${suffix}`, current_qty: 1 });
    const lineId = added.body.line.id;

    // ยังไม่บวก
    expect((await getItem(`RR2-${suffix}`)).positions.map((p) => p.qty)).toEqual([1, 1]);

    // แก้จำนวนผิด → ถูก
    expect((await asTech(request(app).patch(`/api/stock-receive/lines/${lineId}`)).send({ qty: 2 })).body.qty).toBe(2);
    expect((await asTech(request(app).patch(`/api/stock-receive/lines/${lineId}`)).send({ qty: 0 })).status).toBe(400);

    // เห็นในรายการบิลเป็น "รอยืนยัน" ยังไม่นับในยอดรวมบิล
    const detail = await asOffice(request(app).get(`/api/transactions/receipt-sessions/${sessionId}`));
    expect(detail.body.items).toHaveLength(1);
    expect(detail.body.items[0]).toMatchObject({ source: 'pending_line', pending: true, qty: 2 });
    const list = await asOffice(request(app).get('/api/transactions/receipt-sessions'));
    const row = list.body.find((s) => s.id === sessionId);
    expect(Number(row.pending_count)).toBe(1);
    expect(Number(row.item_count)).toBe(0);

    // เสร็จสิ้น → บวกจริง
    const done = await commit(asTech, sessionId);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ applied: 1, total_qty: 2 });
    const item = await getItem(`RR2-${suffix}`);
    expect(item.positions.map((p) => p.qty)).toEqual([1, 3]);
    expect(item.stock_qty).toBe(4);

    const after = await asOffice(request(app).get(`/api/transactions/receipt-sessions/${sessionId}`));
    expect(after.body.items).toHaveLength(1);
    expect(after.body.items[0]).toMatchObject({ source: 'stock_item', qty: 2 });
    expect(Number((await asOffice(request(app).get('/api/transactions/receipt-sessions'))).body.find((s) => s.id === sessionId).item_count)).toBe(1);

    // ยืนยันซ้ำไม่ได้ (ไม่มีรายการรอแล้ว)
    expect((await commit(asTech, sessionId)).status).toBe(400);
    // แก้/ลบรายการที่ยืนยันแล้วผ่าน endpoint รอยืนยันไม่ได้
    expect((await asTech(request(app).patch(`/api/stock-receive/lines/${lineId}`)).send({ qty: 9 })).status).toBe(404);
  });

  test('สแกนชิ้น/ตำแหน่งเดิมซ้ำในบิลเดียวกัน = รวมจำนวนในแถวเดิม และลบรายการรอยืนยันได้', async () => {
    const itemId = await createItem({ oem_code: `M-${suffix}`, stock_qty: 0 });
    const sessionId = await openSession();
    const first = await addLine(asOffice, { item_id: itemId, qty: 2, receipt_session_id: sessionId });
    const second = await addLine(asOffice, { item_id: itemId, qty: 3, receipt_session_id: sessionId });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ merged: true, qty: 5 });
    expect(second.body.line.id).toBe(first.body.line.id);

    const lines = await asOffice(request(app).get(`/api/stock-receive/sessions/${sessionId}/lines`));
    expect(lines.body.lines).toHaveLength(1);

    expect((await asOffice(request(app).delete(`/api/stock-receive/lines/${first.body.line.id}`))).status).toBe(200);
    expect((await asOffice(request(app).get(`/api/stock-receive/sessions/${sessionId}/lines`))).body.lines).toEqual([]);
    expect((await commit(asOffice, sessionId)).status).toBe(400);
    expect((await getItem(`M-${suffix}`)).stock_qty).toBe(0);
  });

  test('ตำแหน่งบน/ล่าง: ปีกนกบน-ล่าง × ซ้าย-ขวา รับเข้าตำแหน่งที่ถูกต้อง', async () => {
    const itemId = await createItem({
      has_sides: true, has_levels: true,
      codes: { upper_left: `UL-${suffix}`, upper_right: `UR-${suffix}`, lower_left: `LL-${suffix}`, lower_right: `LR-${suffix}` },
      stocks: { upper_left: 0, upper_right: 0, lower_left: 0, lower_right: 0 },
    });
    expect(itemId).toBeTruthy();
    const found = await asTech(request(app).get('/api/stock-receive/lookup')).query({ code: `LR-${suffix}` });
    expect(found.body.matches[0]).toMatchObject({ position: 'lower_right', position_label: 'ล่างขวา' });
    const sessionId = await openSession();
    expect((await addLine(asOffice, { item_id: itemId, position: 'lower_right', qty: 2, receipt_session_id: sessionId })).status).toBe(201);
    expect((await addLine(asOffice, { item_id: itemId, position: 'right', qty: 1, receipt_session_id: sessionId })).status).toBe(400);
    expect((await commit(asOffice, sessionId)).status).toBe(200);
    expect((await getItem(`LR-${suffix}`)).positions.map((p) => [p.position, p.qty])).toEqual([
      ['upper_left', 0], ['upper_right', 0], ['lower_left', 0], ['lower_right', 2],
    ]);
  });

  test('validation และบิลของคนอื่น', async () => {
    const shock = await createItem({ has_axles: true, codes: { front: `F-${suffix}`, rear: `R-${suffix}` }, stocks: { front: 0, rear: 0 } });
    const plain = await createItem({ oem_code: `V-${suffix}`, stock_qty: 0 });
    const sessionId = await openSession(asOffice);
    const body = (extra) => ({ receipt_session_id: sessionId, qty: 1, ...extra });
    expect((await addLine(asOffice, body({ item_id: shock }))).status).toBe(400);
    expect((await addLine(asOffice, body({ item_id: shock, position: 'left' }))).status).toBe(400);
    expect((await addLine(asOffice, body({ item_id: plain, position: 'left' }))).status).toBe(400);
    expect((await addLine(asOffice, body({ item_id: plain, qty: 0 }))).status).toBe(400);
    expect((await addLine(asOffice, body({ item_id: plain, qty: 1.5 }))).status).toBe(400);
    expect((await addLine(asOffice, { item_id: plain, qty: 1 })).status).toBe(400); // ไม่ระบุบิล
    expect((await addLine(asOffice, body({ item_id: 99999999 }))).status).toBe(404);
    expect((await addLine(asOffice, { item_id: plain, qty: 1, receipt_session_id: 99999999 })).status).toBe(404);

    // ช่างเพิ่ม/ยืนยัน/แก้/ลบในบิลของ office ไม่ได้
    expect((await addLine(asTech, body({ item_id: plain }))).status).toBe(403);
    const mine = await addLine(asOffice, body({ item_id: plain }));
    expect((await asTech(request(app).patch(`/api/stock-receive/lines/${mine.body.line.id}`)).send({ qty: 5 })).status).toBe(403);
    expect((await asTech(request(app).delete(`/api/stock-receive/lines/${mine.body.line.id}`))).status).toBe(403);
    expect((await commit(asTech, sessionId)).status).toBe(403);
    expect((await asTech(request(app).get(`/api/stock-receive/sessions/${sessionId}/lines`))).status).toBe(403);
  });

  test('ยกเลิกรายการที่บวกแล้ว: หักคืน ไม่ติดลบ เฉพาะ office และไม่เห็นในบิลอีก', async () => {
    const itemId = await createItem({ oem_code: `U-${suffix}`, stock_qty: 0 });
    const sessionId = await openSession();
    await addLine(asOffice, { item_id: itemId, qty: 2, receipt_session_id: sessionId });
    await commit(asOffice, sessionId);
    const detail = await asOffice(request(app).get(`/api/transactions/receipt-sessions/${sessionId}`));
    const movementId = detail.body.items[0].id;

    expect((await asTech(request(app).delete(`/api/stock-receive/movements/${movementId}`))).status).toBe(403);

    // ของถูกใช้ไปแล้ว (ตั้งยอดลงเหลือ 1) → ยกเลิกไม่ได้เพราะจะติดลบ
    await asOffice(request(app).patch(`/api/stock-items/${itemId}/qty`)).send({ set_to: 1 });
    expect((await asOffice(request(app).delete(`/api/stock-receive/movements/${movementId}`))).status).toBe(400);

    await asOffice(request(app).patch(`/api/stock-items/${itemId}/qty`)).send({ set_to: 2 });
    expect((await asOffice(request(app).delete(`/api/stock-receive/movements/${movementId}`))).status).toBe(200);
    expect((await getItem(`U-${suffix}`)).stock_qty).toBe(0);
    expect((await asOffice(request(app).get(`/api/transactions/receipt-sessions/${sessionId}`))).body.items).toHaveLength(0);
    expect((await asOffice(request(app).delete(`/api/stock-receive/movements/${movementId}`))).status).toBe(404);
  });

  test('ลบบิลทั้งใบ: คืนยอดที่บวกแล้ว และทิ้งรายการรอยืนยัน', async () => {
    const a = await createItem({ oem_code: `DA-${suffix}`, stock_qty: 1 });
    const b = await createItem({ has_sides: true, codes: { left: `DB-${suffix}`, right: '' }, stocks: { left: 0, right: 0 } });
    const sessionId = await openSession();
    await addLine(asOffice, { item_id: a, qty: 4, receipt_session_id: sessionId });
    await commit(asOffice, sessionId); // a บวกแล้ว
    await addLine(asOffice, { item_id: b, position: 'left', qty: 2, receipt_session_id: sessionId }); // b ยังรอยืนยัน
    expect((await getItem(`DA-${suffix}`)).stock_qty).toBe(5);

    const del = await asOffice(request(app).delete(`/api/transactions/receipt-sessions/${sessionId}`));
    expect(del.status).toBe(200);
    expect((await getItem(`DA-${suffix}`)).stock_qty).toBe(1);
    expect((await getItem(`DB-${suffix}`)).stock_qty).toBe(0);
    const [[left]] = await pool.query('SELECT COUNT(*) AS c FROM stock_receive_lines WHERE receipt_session_id = ?', [sessionId]);
    expect(left.c).toBe(0);
  });

  test('qrcodes: หนึ่งป้ายต่อรหัสของแต่ละตำแหน่ง (ข้ามตำแหน่งที่ไม่มีรหัส) เฉพาะ office', async () => {
    const itemId = await createItem({
      has_sides: true, has_axles: true,
      codes: { front_left: `QFL-${suffix}`, front_right: '', rear_left: `QRL-${suffix}`, rear_right: `QRR-${suffix}` },
      stocks: { front_left: 0, front_right: 0, rear_left: 0, rear_right: 0 },
    });
    const res = await asOffice(request(app).get('/api/stock-receive/qrcodes')).query({ ids: String(itemId) });
    expect(res.status).toBe(200);
    expect(res.body.labels.map((l) => l.code)).toEqual([`QFL-${suffix}`, `QRL-${suffix}`, `QRR-${suffix}`]);
    expect(res.body.labels[0].qrcode.startsWith('data:image/png;base64,')).toBe(true);
    expect(res.body.labels[0].name).toContain('(หน้าซ้าย)');
    expect((await asTech(request(app).get('/api/stock-receive/qrcodes')).query({ ids: String(itemId) })).status).toBe(403);
    expect((await asOffice(request(app).get('/api/stock-receive/qrcodes')).query({ ids: '' })).status).toBe(400);
  });
});
