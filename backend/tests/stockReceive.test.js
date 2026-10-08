const request = require('supertest');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { getOfficeToken, getTechnicianToken } = require('./helpers');

const app = createApp();

describe('/api/stock-receive — รับเข้าสต๊อกรวมตามบิล + QR', () => {
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
    if (itemIds.length) {
      await pool.query('DELETE FROM stock_item_movements WHERE item_id IN (?)', [itemIds]);
      await pool.query('DELETE FROM stock_items WHERE id IN (?)', [itemIds]);
    }
    if (sessionIds.length) await pool.query('DELETE FROM receipt_sessions WHERE id IN (?)', [sessionIds]);
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

  test('receive: เพิ่มยอดตำแหน่งนั้นเท่านั้น ผูกกับบิล และเห็นในรายการบิล', async () => {
    const itemId = await createItem({
      has_sides: true, codes: { left: `RL2-${suffix}`, right: `RR2-${suffix}` }, stocks: { left: 1, right: 1 },
    });
    const sessionId = await openSession(asTech);
    const res = await asTech(request(app).post('/api/stock-receive/receive'))
      .send({ item_id: itemId, position: 'right', qty: 3, receipt_session_id: sessionId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ qty_after: 4, stock_qty: 5 });

    const item = await getItem(`RR2-${suffix}`);
    expect(item.positions.map((p) => p.qty)).toEqual([1, 4]);
    expect(item.stock_qty).toBe(5);

    const detail = await asOffice(request(app).get(`/api/transactions/receipt-sessions/${sessionId}`));
    expect(detail.body.items).toHaveLength(1);
    expect(detail.body.items[0]).toMatchObject({ source: 'stock_item', item_type: 'stock_item', qty: 3, model_code: `RR2-${suffix}` });
    expect(detail.body.items[0].rack_name).toContain('(ขวา)');

    const list = await asOffice(request(app).get('/api/transactions/receipt-sessions'));
    const row = list.body.find((s) => s.id === sessionId);
    expect(Number(row.item_count)).toBe(1);
    expect(Number(row.total_qty)).toBe(3);
  });

  test('receive: validation และบิลของคนอื่น', async () => {
    const shock = await createItem({ has_axles: true, codes: { front: `F-${suffix}`, rear: `R-${suffix}` }, stocks: { front: 0, rear: 0 } });
    const plain = await createItem({ oem_code: `V-${suffix}`, stock_qty: 0 });
    expect((await asOffice(request(app).post('/api/stock-receive/receive')).send({ item_id: shock, qty: 1 })).status).toBe(400);
    expect((await asOffice(request(app).post('/api/stock-receive/receive')).send({ item_id: shock, position: 'left', qty: 1 })).status).toBe(400);
    expect((await asOffice(request(app).post('/api/stock-receive/receive')).send({ item_id: plain, position: 'left', qty: 1 })).status).toBe(400);
    expect((await asOffice(request(app).post('/api/stock-receive/receive')).send({ item_id: plain, qty: 0 })).status).toBe(400);
    expect((await asOffice(request(app).post('/api/stock-receive/receive')).send({ item_id: plain, qty: 1.5 })).status).toBe(400);
    const othersSession = await openSession(asTech);
    const denied = await asOffice(request(app).post('/api/stock-receive/receive'))
      .send({ item_id: plain, qty: 1, receipt_session_id: othersSession });
    expect(denied.status).toBe(403);
    expect((await asOffice(request(app).post('/api/stock-receive/receive')).send({ item_id: 99999999, qty: 1 })).status).toBe(404);
  });

  test('ยกเลิกรายการรับเข้า: หักคืน ไม่ติดลบ เฉพาะ office และไม่เห็นในบิลอีก', async () => {
    const itemId = await createItem({ oem_code: `U-${suffix}`, stock_qty: 0 });
    const sessionId = await openSession();
    const rec = await asOffice(request(app).post('/api/stock-receive/receive'))
      .send({ item_id: itemId, qty: 2, receipt_session_id: sessionId });
    const movementId = rec.body.movement_id;

    expect((await asTech(request(app).delete(`/api/stock-receive/movements/${movementId}`))).status).toBe(403);

    // ของถูกใช้ไปแล้ว (ตั้งยอดลงเหลือ 1) → ยกเลิกไม่ได้เพราะจะติดลบ
    await asOffice(request(app).patch(`/api/stock-items/${itemId}/qty`)).send({ set_to: 1 });
    const blocked = await asOffice(request(app).delete(`/api/stock-receive/movements/${movementId}`));
    expect(blocked.status).toBe(400);

    await asOffice(request(app).patch(`/api/stock-items/${itemId}/qty`)).send({ set_to: 2 });
    const ok = await asOffice(request(app).delete(`/api/stock-receive/movements/${movementId}`));
    expect(ok.status).toBe(200);
    expect((await getItem(`U-${suffix}`)).stock_qty).toBe(0);
    const detail = await asOffice(request(app).get(`/api/transactions/receipt-sessions/${sessionId}`));
    expect(detail.body.items).toHaveLength(0);
    expect((await asOffice(request(app).delete(`/api/stock-receive/movements/${movementId}`))).status).toBe(404);
  });

  test('ลบบิลทั้งใบ: คืนยอดของสต๊อกรวมในบิลนั้น', async () => {
    const a = await createItem({ oem_code: `DA-${suffix}`, stock_qty: 1 });
    const b = await createItem({ has_sides: true, codes: { left: `DB-${suffix}`, right: '' }, stocks: { left: 0, right: 0 } });
    const sessionId = await openSession();
    await asOffice(request(app).post('/api/stock-receive/receive')).send({ item_id: a, qty: 4, receipt_session_id: sessionId });
    await asOffice(request(app).post('/api/stock-receive/receive')).send({ item_id: b, position: 'left', qty: 2, receipt_session_id: sessionId });
    expect((await getItem(`DA-${suffix}`)).stock_qty).toBe(5);

    const del = await asOffice(request(app).delete(`/api/transactions/receipt-sessions/${sessionId}`));
    expect(del.status).toBe(200);
    expect((await getItem(`DA-${suffix}`)).stock_qty).toBe(1);
    expect((await getItem(`DB-${suffix}`)).stock_qty).toBe(0);
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
