const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const QRCode  = require('qrcode');
const { authenticate, requireRole } = require('../middleware/auth');
const { vehicleModelFromWingArmName } = require('../utils/vehicleModelFromName');
const { resolveTransactionDate } = require('../utils/resolveTransactionDate');

// ปีกนกใช้ทีละคู่เสมอ (ซ้าย+ขวา) — ตรวจคู่ 2 ชั้น (mirror ของ
// frontend/src/pages/StockDeductionPage.jsx ทุกประการ ดูคอมเมนต์ละเอียดที่นั่น):
//   1) SKU ยาวเท่ากัน + ต่างกันตำแหน่งเดียว + ตำแหน่งนั้นเป็น L↔R — เชื่อถือได้สุด
//      เพราะทนต่อ typo ในชื่อ/คอลัมน์ side ที่พบว่ากรอกผิดได้จริงในข้อมูลจริง
//   2) ชั้นสำรอง (SKU ไม่ใช่รูปแบบ L/R เช่นรหัสอะไหล่ที่ต่างกันด้วยตัวเลข) — axle/
//      position ตรงกัน + side ตรงข้าม + ชื่อตัดคำ "ซ้าย"/"ขวา"/"LH"/"RH" แล้วเหมือนกัน
// ใช้ตรวจคู่ตอนตัดสต๊อกเป็นคู่ (PATCH /pair-stock — ไม่เชื่อ id ที่ client ส่งมาเฉย ๆ
// ต้องตรวจซ้ำฝั่งนี้ด้วย)
function isSkuSidePair(codeA, codeB) {
  const a = String(codeA || '').toUpperCase();
  const b = String(codeB || '').toUpperCase();
  if (a.length !== b.length || a === b) return false;
  let diffIndex = -1;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      if (diffIndex !== -1) return false; // ต่างกันมากกว่า 1 ตำแหน่ง ไม่ใช่คู่
      diffIndex = i;
    }
  }
  return diffIndex !== -1 && [a[diffIndex], b[diffIndex]].sort().join('') === 'LR';
}

function stripSideWord(name) {
  return String(name || '')
    .replace(/(ซ้าย|ขวา)/g, '')
    .replace(/\bLH\b|\bRH\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isValidWingArmPair(a, b) {
  if (isSkuSidePair(a.sku, b.sku)) return true;
  return (
    a.axle === b.axle &&
    a.position === b.position &&
    a.side !== b.side &&
    stripSideWord(a.name) === stripSideWord(b.name)
  );
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

// GET /wing-arms/search?q=... — ค้นหาปีกนกแบบย่อ สำหรับหน้าสแกนตอน QR เสีย/อ่านไม่ออก
// แล้วต้องกรอกหารายการเอง (ดู TechnicianScanPage.jsx) เปิดให้ทุก role ที่ login แล้ว
// เหมือน /lookup/:code ด้านบน เพราะช่างเป็นคนสแกนจ่ายออกเองอยู่แล้ว — ตั้งใจแยกจาก
// GET / (รายการเต็มสำหรับหน้าจัดการ ซึ่งจำกัดเฉพาะ office) ไม่ไปขยายสิทธิ์ route เดิม
// ต้องประกาศก่อน /:id เสมอ ไม่งั้น Express จะจับ "search" เป็น :id
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const like = `%${q}%`;
    const [rows] = await pool.query(
      `SELECT id, sku, name, stock_qty, min_stock, position, axle, side
       FROM wing_arms
       WHERE sku LIKE ? OR name LIKE ?
       ORDER BY sku ASC
       LIMIT 30`,
      [like, like]
    );
    res.json(rows);
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
// position/axle ไม่บังคับส่งมาแล้ว — หน้าแก้ไข (WingArmDashboard.jsx) ไม่ให้แก้ค่านี้
// อีกต่อไป (ตำแหน่ง/ด้านผูกกับ SKU ตายตัว) ถ้าไม่ส่งมาก็คงค่าเดิมในฐานข้อมูลไว้ —
// เดิม mysql2 จะ throw "Bind parameters must not contain undefined" ถ้า axle
// เป็น undefined ทำให้แก้ไขไม่ได้เลยแม้แต่ครั้งเดียว (client เก่าไม่เคยส่ง axle มา)
router.put('/:id', requireRole('office'), async (req, res) => {
  try {
    const { sku, name, position, axle, side, stock_qty, min_stock } = req.body;

    if (!sku || !name || !side) {
      return res.status(400).json({ error: 'sku, name และ side ต้องระบุ' });
    }

    const [existingRows] = await pool.query('SELECT position, axle FROM wing_arms WHERE id = ?', [req.params.id]);
    if (!existingRows.length) return res.status(404).json({ error: 'ไม่พบรายการ' });
    const existing = existingRows[0];

    await pool.query(
      'UPDATE wing_arms SET sku=?, name=?, position=?, axle=?, side=?, stock_qty=?, min_stock=? WHERE id=?',
      [
        sku.trim(), name.trim(),
        position ?? existing.position, axle ?? existing.axle,
        side, stock_qty, min_stock, req.params.id,
      ]
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
// vehicle_model: หน้าตัดสต๊อกเดาค่านี้จากชื่อปีกนกให้เองแล้วโชว์ให้พนักงานยืนยัน/แก้
// ก่อนส่ง (ดู StockDeductionPage.jsx) — ใช้ค่าที่ client ส่งมาตรง ๆ ถ้ามี ไม่มีค่อย
// fallback ไปเดาเอง เฉพาะตอนตัดออก (OUT) เท่านั้น (รับเข้า/IN ไม่ผูกกับรถคันไหน)
// receipt_session_id: ผูกรายการรับเข้ากับบิลรับสินค้า เหมือนที่ POST /transactions/in
// ทำให้กับแร็ค — เดิมฝั่งปีกนกไม่รับพารามิเตอร์นี้เลย ปีกนกที่สแกนเข้าบิลจึงหลุดออกจาก
// บิลทั้งหมด (ไม่โผล่ในหน้ารายละเอียดบิล และไม่ถูกนับใน item_count)
router.patch('/:id/stock', async (req, res) => {
  const { delta, note = '', vehicle_model, receipt_session_id = null, transaction_date } = req.body;
  if (!delta || delta === 0) {
    return res.status(400).json({ error: 'ระบุ delta ที่ไม่เป็น 0' });
  }
  const createdAt = resolveTransactionDate(transaction_date);

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
    const vehicleModel = delta < 0 ? (vehicle_model || vehicleModelFromWingArmName(rows[0].name)) : null;
    // ใช้ wing_arm_id แยกจาก rack_id เพื่อไม่ให้ FK constraint fail
    // ถ้า column ยังไม่มีให้รัน migration SQL ด้านล่างก่อน
    let transactionId = null;
    try {
      const [txResult] = createdAt
        ? await conn.query(
            'INSERT INTO transactions (wing_arm_id, type, qty, user_id, note, vehicle_model, receipt_session_id, created_at) VALUES (?,?,?,?,?,?,?,?)',
            [req.params.id, delta > 0 ? 'IN' : 'OUT', Math.abs(delta), userId, note, vehicleModel, receipt_session_id || null, createdAt]
          )
        : await conn.query(
            'INSERT INTO transactions (wing_arm_id, type, qty, user_id, note, vehicle_model, receipt_session_id) VALUES (?,?,?,?,?,?,?)',
            [req.params.id, delta > 0 ? 'IN' : 'OUT', Math.abs(delta), userId, note, vehicleModel, receipt_session_id || null]
          );
      transactionId = txResult.insertId;
    } catch (txErr) {
      // log แต่ไม่ fail — stock อัปเดตสำเร็จแล้ว
      console.warn('[wing-arm stock] tx log skipped:', txErr.message);
    }

    await conn.commit();

    const [updated] = await pool.query('SELECT * FROM wing_arms WHERE id = ?', [req.params.id]);
    // คืน transaction_id ให้หน้าสแกนเก็บไว้ เผื่อสแกนผิดแล้วกดลบทันที
    res.json({ ...updated[0], transaction_id: transactionId });
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
  const { left_id, right_id, qty, note = '', vehicle_model, transaction_date } = req.body || {};
  const quantity = Number(qty);
  if (!left_id || !right_id || left_id === right_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  }
  const createdAt = resolveTransactionDate(transaction_date);

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

    // ตรวจว่าสองรายการที่ส่งมาเป็นคู่ซ้าย-ขวาของกันจริง ๆ (ไม่เชื่อ id ที่ client
    // ส่งมาเฉย ๆ กันตัดผิดตัวถ้า logic จับคู่ฝั่ง frontend มีบั๊ก)
    const [a, b] = rows;
    if (!isValidWingArmPair(a, b)) {
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
      if (createdAt) {
        await conn.query(
          'INSERT INTO transactions (wing_arm_id, type, qty, user_id, note, vehicle_model, created_at) VALUES (?,?,?,?,?,?,?)',
          [item.id, 'OUT', quantity, userId, note, vehicle_model || vehicleModelFromWingArmName(item.name), createdAt]
        );
      } else {
        await conn.query(
          'INSERT INTO transactions (wing_arm_id, type, qty, user_id, note, vehicle_model) VALUES (?,?,?,?,?,?)',
          [item.id, 'OUT', quantity, userId, note, vehicle_model || vehicleModelFromWingArmName(item.name)]
        );
      }
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