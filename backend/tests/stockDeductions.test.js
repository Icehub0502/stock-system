const request = require('supertest');
const { createApp } = require('../src/app');
const pool = require('../src/db/pool');
const { getManagerToken, getTechnicianToken } = require('./helpers');
const { syncLegacy, MIGRATION_NOTE } = require('../scripts/sync-legacy-deductions');

const app = createApp();

function localDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('/api/stock-deductions — ตัดสต๊อกของสต๊อกรวม', () => {
  let officeToken;
  let techToken;
  let categoryId;
  const suffix = Date.now().toString(36);
  const itemIds = [];

  const asOffice = (req) => req.set('Authorization', `Bearer ${officeToken}`);
  const asTech = (req) => req.set('Authorization', `Bearer ${techToken}`);

  beforeAll(async () => {
    officeToken = await getManagerToken();
    techToken = await getTechnicianToken();
    const cat = await asOffice(request(app).post('/api/stock-items/categories')).send({ name: `DED-CAT-${suffix}` });
    categoryId = cat.body.id;
  });

  afterAll(async () => {
    if (itemIds.length) {
      await pool.query('DELETE FROM stock_item_movements WHERE item_id IN (?)', [itemIds]);
      await pool.query('DELETE FROM stock_items WHERE id IN (?)', [itemIds]);
    }
    await pool.execute('DELETE FROM stock_categories WHERE id = ?', [categoryId]);
  });

  async function createItem(extra) {
    const res = await asOffice(request(app).post('/api/stock-items')).send({
      category_id: categoryId, description: 'ทดสอบตัดสต๊อก', ...extra,
    });
    if (res.body.id) itemIds.push(res.body.id);
    return res.body.id;
  }
  const getItem = async (code) => (await asOffice(request(app).get('/api/stock-items')).query({ q: code })).body[0];
  const deduct = (as, body) => as(request(app).post('/api/stock-deductions')).send(body);

  test('ของธรรมดา: ตัดแล้วยอดลด มีประวัติ และตัดเกินยอดไม่ได้', async () => {
    const id = await createItem({ oem_code: `D1-${suffix}`, stock_qty: 5 });
    const ok = await deduct(asOffice, { item_id: id, lines: [{ qty: 2 }], vehicle_model: 'TOYOTA VIGO', note: 'คิว 12' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ stock_qty: 3, items: [{ position: null, qty_after: 3 }] });
    expect((await getItem(`D1-${suffix}`)).stock_qty).toBe(3);

    const tooMany = await deduct(asOffice, { item_id: id, lines: [{ qty: 4 }] });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error).toContain('เหลือไม่พอ');
    expect((await getItem(`D1-${suffix}`)).stock_qty).toBe(3);

    const moves = await asOffice(request(app).get(`/api/stock-items/${id}/movements`));
    expect(moves.body[0]).toMatchObject({ reason: 'deduct', qty_before: 5, qty_after: 3, note: 'คิว 12' });
  });

  test('ปีกนกซ้าย+ขวาเป็นคู่: ตัดสองตำแหน่งพร้อมกัน และถ้าข้างใดข้างหนึ่งไม่พอ = ไม่ตัดเลย', async () => {
    const id = await createItem({
      has_sides: true, codes: { left: `DL-${suffix}`, right: `DR-${suffix}` }, stocks: { left: 3, right: 1 },
    });
    const pair = await deduct(asOffice, { item_id: id, lines: [{ position: 'left', qty: 1 }, { position: 'right', qty: 1 }] });
    expect(pair.status).toBe(201);
    expect((await getItem(`DL-${suffix}`)).positions.map((p) => p.qty)).toEqual([2, 0]);

    // ขวาหมดแล้ว → ตัดคู่อีกรอบไม่ได้ และซ้ายต้องไม่ถูกตัดไปก่อน
    const fail = await deduct(asOffice, { item_id: id, lines: [{ position: 'left', qty: 1 }, { position: 'right', qty: 1 }] });
    expect(fail.status).toBe(400);
    expect(fail.body.error).toContain('ขวา');
    expect((await getItem(`DL-${suffix}`)).positions.map((p) => p.qty)).toEqual([2, 0]);
    expect((await getItem(`DL-${suffix}`)).stock_qty).toBe(2);
  });

  test('validation: จำนวน/ตำแหน่ง/วันที่/รูปแบบ', async () => {
    const plain = await createItem({ oem_code: `DV-${suffix}`, stock_qty: 5 });
    const sided = await createItem({ has_sides: true, codes: { left: `DVL-${suffix}`, right: `DVR-${suffix}` }, stocks: { left: 5, right: 5 } });
    for (const lines of [[{ qty: 0 }], [{ qty: -1 }], [{ qty: 1.5 }], [{ qty: 'abc' }], [{ qty: null }], [], 'x', [{ qty: 1 }, { qty: 1 }]]) {
      expect((await deduct(asOffice, { item_id: plain, lines })).status).toBe(400);
    }
    expect((await deduct(asOffice, { item_id: plain, lines: [{ position: 'left', qty: 1 }] })).status).toBe(400); // ของธรรมดาห้ามมีตำแหน่ง
    expect((await deduct(asOffice, { item_id: sided, lines: [{ qty: 1 }] })).status).toBe(400); // แยกตำแหน่งต้องระบุ
    expect((await deduct(asOffice, { item_id: sided, lines: [{ position: 'front', qty: 1 }] })).status).toBe(400);
    expect((await deduct(asOffice, { item_id: sided, lines: [{ position: 'left', qty: 1 }, { position: 'left', qty: 1 }] })).status).toBe(400);
    expect((await deduct(asOffice, { item_id: 99999999, lines: [{ qty: 1 }] })).status).toBe(404);
    expect((await deduct(asOffice, { item_id: 'abc', lines: [{ qty: 1 }] })).status).toBe(400);
    expect((await deduct(asOffice, { item_id: plain, lines: [{ qty: 1 }], deduction_date: localDate(1) })).status).toBe(400); // อนาคต
    expect((await deduct(asOffice, { item_id: plain, lines: [{ qty: 1 }], deduction_date: '2026-02-31' })).status).toBe(400);
    expect((await deduct(asOffice, { item_id: plain, lines: [{ qty: 1 }], deduction_date: 'วันนี้' })).status).toBe(400);
    expect((await getItem(`DV-${suffix}`)).stock_qty).toBe(5);
    // ข้อความยาวเกินถูกตัด ไม่ล้ม
    const long = await deduct(asOffice, { item_id: plain, lines: [{ qty: 1 }], vehicle_model: 'x'.repeat(500), note: 'n'.repeat(2000) });
    expect(long.status).toBe(201);
  });

  test('ตัดพร้อมกัน 6 คำขอ เหลือ 1 ชิ้น → สำเร็จครั้งเดียว ยอดไม่ติดลบ', async () => {
    const id = await createItem({ oem_code: `DC-${suffix}`, stock_qty: 1 });
    const results = await Promise.all(Array.from({ length: 6 }, () => deduct(asOffice, { item_id: id, lines: [{ qty: 1 }] })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect((await getItem(`DC-${suffix}`)).stock_qty).toBe(0);
  });

  test('ตัดย้อนหลัง: ขึ้นประวัติในวันที่เลือก ยกเลิกแล้วคืนยอดและหายจากประวัติ (เฉพาะ office)', async () => {
    const id = await createItem({ oem_code: `DH-${suffix}`, stock_qty: 4 });
    const day = localDate(-3);
    const res = await deduct(asOffice, { item_id: id, lines: [{ qty: 2 }], vehicle_model: 'HONDA CITY', deduction_date: day });
    expect(res.status).toBe(201);
    const movementId = res.body.movement_ids[0];

    const hist = await asOffice(request(app).get('/api/transactions/deduction-history')).query({ from: day, to: day });
    const row = hist.body.data.find((r) => r.source === 'stock_item' && r.id === movementId);
    expect(row).toMatchObject({ tx_date: day, vehicle_model: 'HONDA CITY', qty: 2, part_code: `DH-${suffix}`, category_name: `DED-CAT-${suffix}` });
    // ช่างดูประวัติไม่ได้ / ยกเลิกไม่ได้ แต่ตัดได้
    expect((await asTech(request(app).get('/api/transactions/deduction-history'))).status).toBe(403);
    expect((await asTech(request(app).delete(`/api/stock-deductions/movements/${movementId}`))).status).toBe(403);
    expect((await deduct(asTech, { item_id: id, lines: [{ qty: 1 }] })).status).toBe(201);

    expect((await asOffice(request(app).delete(`/api/stock-deductions/movements/${movementId}`))).status).toBe(200);
    expect((await getItem(`DH-${suffix}`)).stock_qty).toBe(3); // 4 −2 −1 +2
    const after = await asOffice(request(app).get('/api/transactions/deduction-history')).query({ from: day, to: day });
    expect(after.body.data.some((r) => r.source === 'stock_item' && r.id === movementId)).toBe(false);
    expect((await asOffice(request(app).delete(`/api/stock-deductions/movements/${movementId}`))).status).toBe(404);
  });

  test('ช่างยกเลิกรายการที่ตัวเองจ่ายผิดได้ภายใน 30 นาที เกินนั้นต้องผู้จัดการ', async () => {
    const id = await createItem({ oem_code: `DU-${suffix}`, stock_qty: 5 });
    const own = (await deduct(asTech, { item_id: id, lines: [{ qty: 2 }] })).body.movement_ids[0];
    expect((await asTech(request(app).delete(`/api/stock-deductions/movements/${own}`))).status).toBe(200);
    expect((await getItem(`DU-${suffix}`)).stock_qty).toBe(5);

    const old = (await deduct(asTech, { item_id: id, lines: [{ qty: 1 }] })).body.movement_ids[0];
    await pool.query('UPDATE stock_item_movements SET created_at = NOW() - INTERVAL 31 MINUTE WHERE id = ?', [old]);
    const late = await asTech(request(app).delete(`/api/stock-deductions/movements/${old}`));
    expect(late.status).toBe(403);
    expect(late.body.error).toContain('30 นาที');
    expect((await asOffice(request(app).delete(`/api/stock-deductions/movements/${old}`))).status).toBe(200);
    expect((await getItem(`DU-${suffix}`)).stock_qty).toBe(5);
  });

  test('หลังรีเฟรช ช่างเห็นรายการที่ตัวเองจ่ายใน 30 นาทีล่าสุดเท่านั้น', async () => {
    const id = await createItem({ oem_code: `DR-${suffix}`, stock_qty: 6 });
    const mine = (await deduct(asTech, { item_id: id, lines: [{ qty: 1 }] })).body.movement_ids[0];
    const office = (await deduct(asOffice, { item_id: id, lines: [{ qty: 1 }] })).body.movement_ids[0];
    const old = (await deduct(asTech, { item_id: id, lines: [{ qty: 1 }] })).body.movement_ids[0];
    await pool.query('UPDATE stock_item_movements SET created_at = NOW() - INTERVAL 31 MINUTE WHERE id = ?', [old]);

    const res = await asTech(request(app).get('/api/stock-deductions/mine/recent'));
    expect(res.status).toBe(200);
    const ids = res.body.data.map((d) => d.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(office);
    expect(ids).not.toContain(old);
    expect(res.body.data.find((d) => d.id === mine)).toMatchObject({ qty: 1, code: `DR-${suffix}` });
  });
});

describe('scripts/sync-legacy-deductions — ซิงก์การตัดสต๊อกเก่าเข้าสต๊อกรวม', () => {
  const suffix = Date.now().toString(36);
  const fx = { rackId: null, wingId: null, rackItem: null, wingItem: null, baseId: 0 };
  let officeToken;
  const created = [];

  beforeAll(async () => {
    officeToken = await getManagerToken();
    const [[user]] = await pool.query("SELECT id FROM users WHERE shop_id = 1 AND role <> 'technician' LIMIT 1");
    fx.userId = user.id;
    const [[rackCat]] = await pool.query("SELECT id FROM stock_categories WHERE name='แร็ค' LIMIT 1");
    const [[wingCat]] = await pool.query("SELECT id FROM stock_categories WHERE name='ปีกนก' LIMIT 1");
    fx.rackCat = rackCat.id;
    fx.wingCat = wingCat.id;

    // ของเก่า (ตารางเดิม) + ของคู่กันในสต๊อกรวม (เหมือนผลจาก migrate-stock-all.js)
    const rackCode = `SYR-${suffix}`;
    const wingSku = `SYW-${suffix}`;
    const [r] = await pool.execute('INSERT INTO racks (model_code, name, stock_qty) VALUES (?, ?, 10)', [rackCode, 'sync rack']);
    fx.rackId = r.insertId;
    const [w] = await pool.execute(
      "INSERT INTO wing_arms (sku, name, position, axle, side, stock_qty) VALUES (?, ?, 'lower', 'front', 'left', 4)",
      [wingSku, 'sync wing']
    );
    fx.wingId = w.insertId;
    const mk = async (body) => {
      const res = await request(app).post('/api/stock-items').set('Authorization', `Bearer ${officeToken}`).send(body);
      created.push(res.body.id);
      return res.body.id;
    };
    fx.rackItem = await mk({ category_id: fx.rackCat, oem_code: rackCode, description: 'sync rack', stock_qty: 10 });
    fx.wingItem = await mk({ category_id: fx.wingCat, has_sides: true, description: 'sync wing', codes: { left: wingSku, right: `${wingSku}-R` }, stocks: { left: 4, right: 4 } });
    // ทำเครื่องหมาย "ย้ายแล้ว" ย้อนหลัง เหมือนที่ migrate-stock-all.js ทำ
    await pool.query(
      `UPDATE stock_item_movements SET note = ?, created_at = '2026-01-01 00:00:00' WHERE item_id IN (?, ?)`,
      [MIGRATION_NOTE, fx.rackItem, fx.wingItem]
    );
    fx.rackCode = rackCode;
    fx.wingSku = wingSku;
    const [[max]] = await pool.query('SELECT COALESCE(MAX(id), 0) AS m FROM transactions');
    fx.baseId = max.m;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM transactions WHERE id > ? AND (rack_id = ? OR wing_arm_id = ?)', [fx.baseId, fx.rackId, fx.wingId]);
    await pool.query('DELETE FROM stock_item_movements WHERE item_id IN (?)', [created]);
    await pool.query('DELETE FROM stock_items WHERE id IN (?)', [created]);
    await pool.query('DELETE FROM racks WHERE id = ?', [fx.rackId]);
    await pool.query('DELETE FROM wing_arms WHERE id = ?', [fx.wingId]);
  });

  test('ตัวอย่าง (dry-run) ไม่เปลี่ยนอะไร → apply ตัด/บวกถูกตำแหน่ง ลงประวัติตามวันเดิม และซิงก์ซ้ำไม่ได้', async () => {
    // รายการเก่า: ตัดแร็ค 3 (ย้อนหลัง 5 วันก่อน), ตัดปีกนกซ้าย 1, รับเข้าแร็ค 2, ตัดแร็คเกินยอด (ต้องถูกบีบเป็น 0 และเตือน)
    const day = `${localDate(-5)} 10:00:00`;
    const ins = async (rackOrWing, type, qty, createdAt = null) => {
      const col = rackOrWing === 'rack' ? 'rack_id' : 'wing_arm_id';
      const id = rackOrWing === 'rack' ? fx.rackId : fx.wingId;
      await pool.execute(
        `INSERT INTO transactions (${col}, type, qty, user_id, note, vehicle_model${createdAt ? ', created_at' : ''}) VALUES (?, ?, ?, ?, 'ทดสอบ', 'HONDA CITY'${createdAt ? ', ?' : ''})`,
        createdAt ? [id, type, qty, fx.userId, createdAt] : [id, type, qty, fx.userId]
      );
    };
    await ins('rack', 'OUT', 3, day);
    await ins('wing', 'OUT', 1);
    await ins('rack', 'IN', 2);

    const dry = await syncLegacy({ apply: false, sinceId: fx.baseId, migratedAt: '2026-01-01 00:00:00' });
    expect(dry.candidates.filter((c) => [fx.rackCode, fx.wingSku].includes(c.code))).toHaveLength(3);
    expect(dry.applied).toBe(false);
    const [[beforeApply]] = await pool.query('SELECT stock_qty FROM stock_items WHERE id = ?', [fx.rackItem]);
    expect(beforeApply.stock_qty).toBe(10); // dry-run ไม่บันทึก

    const done = await syncLegacy({ apply: true, sinceId: fx.baseId, migratedAt: '2026-01-01 00:00:00' });
    expect(done.applied).toBe(true);
    const [[rack]] = await pool.query('SELECT stock_qty FROM stock_items WHERE id = ?', [fx.rackItem]);
    expect(rack.stock_qty).toBe(9); // 10 −3 +2
    const [wingPos] = await pool.query('SELECT position, qty FROM stock_item_positions WHERE item_id = ? ORDER BY position', [fx.wingItem]);
    expect(wingPos).toEqual([{ position: 'left', qty: 3 }, { position: 'right', qty: 4 }]);

    // ขึ้นในประวัติการตัดสต๊อกตามวันที่เดิม พร้อมรุ่นรถ
    const hist = await request(app).get('/api/transactions/deduction-history').set('Authorization', `Bearer ${officeToken}`)
      .query({ from: day.slice(0, 10), to: day.slice(0, 10) });
    expect(hist.body.data.some((r) => r.source === 'stock_item' && r.part_code === fx.rackCode && r.qty === 3 && r.vehicle_model === 'HONDA CITY')).toBe(true);

    // รันซ้ำ = ไม่ซิงก์ซ้ำ
    const again = await syncLegacy({ apply: true, sinceId: fx.baseId, migratedAt: '2026-01-01 00:00:00' });
    expect(again.candidates.filter((c) => [fx.rackCode, fx.wingSku].includes(c.code))).toHaveLength(0);
    const [[rack2]] = await pool.query('SELECT stock_qty FROM stock_items WHERE id = ?', [fx.rackItem]);
    expect(rack2.stock_qty).toBe(9);
  });

  test('ตัดเกินยอดสต๊อกรวม → บีบเป็น 0 และเตือน (ไม่ติดลบ)', async () => {
    const [[base]] = await pool.query('SELECT COALESCE(MAX(id), 0) AS m FROM transactions');
    await pool.execute(
      "INSERT INTO transactions (wing_arm_id, type, qty, user_id, note) VALUES (?, 'OUT', 50, ?, 'เกินยอด')",
      [fx.wingId, fx.userId]
    );
    const done = await syncLegacy({ apply: true, sinceId: base.m, migratedAt: '2026-01-01 00:00:00' });
    expect(done.clamped.some((c) => c.code === fx.wingSku)).toBe(true);
    const [[pos]] = await pool.query("SELECT qty FROM stock_item_positions WHERE item_id = ? AND position = 'left'", [fx.wingItem]);
    expect(pos.qty).toBe(0);
  });
});
