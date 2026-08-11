const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const QRCode  = require('qrcode');
const { authenticate, requireRole } = require('../middleware/auth');
const { vehicleModelFromWingArmName } = require('../utils/vehicleModelFromName');

// ปีกนกใช้ทีละคู่เสมอ (ซ้าย+ขวา ตำแหน่ง/เพลาเดียวกัน) — จับคู่ด้วยชื่อที่ตัดคำ
// "ซ้าย"/"ขวา" ออกแล้วตรงกัน (ดู vehicleModelFromWingArmName) ใช้ทั้งหา "อีกข้าง"
// ตอนตัดสต๊อกเป็นคู่ (PATCH /pair-stock) และตอนคำนวณ vehicle_model ของรายงาน
function stripSideWord(name) {
  return String(name || '').replace(/(ซ้าย|ขวา)\s*/, '').trim();
}

router.use(authenticate);

// ─────────────────────────────────────────────────────────────────
//  IMPORTANT: /lookup/:code ต้องอยู่ก่อน /:id
//  เพราะ Express จะ match "lookup" เป็น :id ถ้าลำดับผิด
// ─────────────────────────────────────────────────────────────────

// GET /wing-arms/lookup/:code
// ค้นหาด้วย SKU (รองรับทั้ง plain text และ JSON ที่ QRCode encode ไว้)
// เปิดให้ทุก role ที่ login แล้ว (technician ใช้ตอนสแกน QR)
router.get('/lookup/:code', async (req, res) => {
  try {
    let sku = decodeURIComponent(req.params.code);

    // QR ของระบบนี้ encode เป็น JSON → { id, sku, name }
    // ถ้า client ส่ง raw JSON string มา ให้ parse ก่อน
    try {
      const parsed = JSON.parse(sku);
      if (parsed.sku) sku = parsed.sku;
    } catch { /* plain text ปล่อยผ่าน */ }

    const [rows] = await pool.query(
      'SELECT * FROM wing_arms WHERE sku = ? LIMIT 1',
      [sku.trim()]
    );

    if (!rows.length) {
      return res.status(404).json({ error: `ไม่พบปีกนก SKU: ${sku}` });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ค้นหาปีกนกไม่สำเร็จ' });
  }
});

// ─────────────────────────────────────────────────────────────────

// GET /wing-arms
router.get('/', requireRole('office'), async (req, res) => {
  try {
    const { search, side, position, axle } = req.query;
    let sql    = 'SELECT * FROM wing_arms WHERE 1=1';
    let params = [];

    if (search)   { sql += ' AND (sku LIKE ? OR name LIKE ?)'; const t = `%${search}%`; params.push(t, t); }
    if (side)     { sql += ' AND side = ?';     params.push(side); }
    if (position) { sql += ' AND position = ?'; params.push(position); }
    if (axle)     { sql += ' AND axle = ?';     params.push(axle); }

    sql += ' ORDER BY created_at DESC';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดรายการปีกนกไม่สำเร็จ' });
  }
});

// POST /wing-arms
router.post('/', requireRole('office'), async (req, res) => {
  try {
    const {
      sku, name,
      position  = 'lower',
      axle      = 'front',
      side,
      stock_qty = 0,
      min_stock = 1,
    } = req.body;

    if (!sku || !name || !side) {
      return res.status(400).json({ error: 'sku, name และ side ต้องระบุ' });
    }

    const [result] = await pool.query(
      'INSERT INTO wing_arms (sku, name, position, axle, side, stock_qty, min_stock) VALUES (?,?,?,?,?,?,?)',
      [sku.trim(), name.trim(), position, axle, side, stock_qty, min_stock]
    );

    const [rows] = await pool.query('SELECT * FROM wing_arms WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'รหัส SKU นี้มีอยู่แล้ว' });
    }
    console.error(err);
    res.status(500).json({ error: 'เพิ่มรายการปีกนกไม่สำเร็จ' });
  }
});

// PUT /wing-arms/:id
router.put('/:id', requireRole('office'), async (req, res) => {
  try {
    const { sku, name, position, axle, side, stock_qty, min_stock } = req.body;

    if (!sku || !name || !side) {
      return res.status(400).json({ error: 'sku, name และ side ต้องระบุ' });
    }

    await pool.query(
      'UPDATE wing_arms SET sku=?, name=?, position=?, axle=?, side=?, stock_qty=?, min_stock=? WHERE id=?',
      [sku.trim(), name.trim(), position, axle, side, stock_qty, min_stock, req.params.id]
    );

    const [rows] = await pool.query('SELECT * FROM wing_arms WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบรายการ' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'รหัส SKU นี้มีอยู่แล้ว' });
    }
    console.error(err);
    res.status(500).json({ error: 'แก้ไขรายการปีกนกไม่สำเร็จ' });
  }
});

// DELETE /wing-arms/:id
router.delete('/:id', requireRole('office'), async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM wing_arms WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'ไม่พบรายการ' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ลบรายการปีกนกไม่สำเร็จ' });
  }
});

// GET /wing-arms/:id/qrcode
router.get('/:id/qrcode', requireRole('office'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM wing_arms WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบรายการ' });

    const item   = rows[0];
    // encode เฉพาะ sku ที่ frontend ต้องใช้ lookup
    const qrData = JSON.stringify({ id: item.id, sku: item.sku, name: item.name });
    const qrcode = await QRCode.toDataURL(qrData, { width: 300, margin: 2 });

    res.json({ id: item.id, sku: item.sku, name: item.name, qrcode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'สร้าง QR code ไม่สำเร็จ' });
  }
});

// PATCH /wing-arms/:id/stock
// เปิดให้ทุก role ที่ login แล้ว (technician ใช้ตอนยืนยันสแกน)
// vehicle_model ไม่รับจาก client แล้ว — ดึงจากชื่อปีกนกเอง เฉพาะตอนตัดออก (OUT) เท่านั้น
// (รับเข้า/IN ไม่ได้ผูกกับรถคันไหน ไม่บันทึก) ดู vehicleModelFromName.js
router.patch('/:id/stock', async (req, res) => {
  const { delta, note = '' } = req.body;
  if (!delta || delta === 0) {
    return res.status(400).json({ error: 'ระบุ delta ที่ไม่เป็น 0' });
  }

  // ใช้ transaction + FOR UPDATE ล็อคแถวกันเหตุการณ์ lost update
  // เมื่อมีการอัปเดตสต็อกชิ้นเดียวกันพร้อมกันหลาย request
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [rows] = await conn.query('SELECT * FROM wing_arms WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบรายการ' });
    }

    const newQty = rows[0].stock_qty + delta;
    if (newQty < 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'สต็อกไม่พอ' });
    }

    await conn.query('UPDATE wing_arms SET stock_qty = ? WHERE id = ?', [newQty, req.params.id]);

    const userId = req.user?.id || req.body.user_id || 1;
    const vehicleModel = delta < 0 ? vehicleModelFromWingArmName(rows[0].name) : null;
    // ใช้ wing_arm_id แยกจาก rack_id เพื่อไม่ให้ FK constraint fail
    // ถ้า column ยังไม่มีให้รัน migration SQL ด้านล่างก่อน
    try {
      await conn.query(
        'INSERT INTO transactions (wing_arm_id, type, qty, user_id, note, vehicle_model) VALUES (?,?,?,?,?,?)',
        [req.params.id, delta > 0 ? 'IN' : 'OUT', Math.abs(delta), userId, note, vehicleModel]
      );
    } catch (txErr) {
      // log แต่ไม่ fail — stock อัปเดตสำเร็จแล้ว
      console.warn('[wing-arm stock] tx log skipped:', txErr.message);
    }

    await conn.commit();

    const [updated] = await pool.query('SELECT * FROM wing_arms WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'อัปเดตสต็อกไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// PATCH /wing-arms/pair-stock — ตัดสต๊อกปีกนกพร้อมกันทั้งซ้าย-ขวาในทรานแซกชันเดียว
// (เจ้าของร้านสั่ง: ปีกนกใช้ทีละคู่เสมอ กันลืมตัดอีกข้าง) client ต้องหา id ของอีกข้าง
// มาเองก่อน (จับคู่ด้วย axle+position ตรงกัน+side ตรงข้าม+ชื่อไม่รวมคำว่าซ้าย/ขวา
// ตรงกัน — ดู StockDeductionPage.jsx) endpoint นี้แค่ตรวจสต๊อก+ตัดให้ทั้งคู่แบบอะตอมิก
// ไม่รับ id เดี่ยวมาเดาคู่เอง กันตัดผิดตัวถ้า client จับคู่มาไม่ตรง
router.patch('/pair-stock', requireRole('office'), async (req, res) => {
  const { left_id, right_id, qty, note = '' } = req.body || {};
  const quantity = Number(qty);
  if (!left_id || !right_id || left_id === right_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT * FROM wing_arms WHERE id IN (?, ?) FOR UPDATE',
      [left_id, right_id]
    );
    if (rows.length !== 2) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบรายการทั้งคู่' });
    }

    // ตรวจว่าสองรายการที่ส่งมาเป็นคู่ซ้าย-ขวาของกันจริง ๆ (axle/position ตรงกัน,
    // side ตรงข้ามกัน, ชื่อไม่รวมคำว่าซ้าย/ขวาตรงกัน) ไม่เชื่อ id ที่ client ส่งมาเฉย ๆ
    // กันตัดผิดตัวถ้า logic จับคู่ฝั่ง frontend มีบั๊ก
    const [a, b] = rows;
    const isValidPair =
      a.axle === b.axle &&
      a.position === b.position &&
      a.side !== b.side &&
      stripSideWord(a.name) === stripSideWord(b.name);
    if (!isValidPair) {
      await conn.rollback();
      return res.status(400).json({ error: 'สองรายการนี้ไม่ใช่คู่ซ้าย-ขวาของกัน' });
    }

    const short = rows.find((r) => r.stock_qty < quantity);
    if (short) {
      await conn.rollback();
      return res.status(400).json({ error: `สต็อกเหลือไม่พอ (${short.sku} คงเหลือ ${short.stock_qty})` });
    }

    const userId = req.user?.id || 1;
    for (const item of rows) {
      await conn.query('UPDATE wing_arms SET stock_qty = stock_qty - ? WHERE id = ?', [quantity, item.id]);
      await conn.query(
        'INSERT INTO transactions (wing_arm_id, type, qty, user_id, note, vehicle_model) VALUES (?,?,?,?,?,?)',
        [item.id, 'OUT', quantity, userId, note, vehicleModelFromWingArmName(item.name)]
      );
    }

    await conn.commit();

    const [updated] = await pool.query('SELECT * FROM wing_arms WHERE id IN (?, ?)', [left_id, right_id]);
    res.json({ success: true, items: updated });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'ตัดสต๊อกไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;