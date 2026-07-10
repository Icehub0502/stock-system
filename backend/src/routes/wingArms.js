const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const QRCode  = require('qrcode');
const { authenticate, requireRole } = require('../middleware/auth');

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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// DELETE /wing-arms/:id
router.delete('/:id', requireRole('office'), async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM wing_arms WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'ไม่พบรายการ' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// PATCH /wing-arms/:id/stock
// เปิดให้ทุก role ที่ login แล้ว (technician ใช้ตอนยืนยันสแกน)
router.patch('/:id/stock', async (req, res) => {
  try {
    const { delta, note = '' } = req.body;
    if (!delta || delta === 0) {
      return res.status(400).json({ error: 'ระบุ delta ที่ไม่เป็น 0' });
    }

    const [rows] = await pool.query('SELECT * FROM wing_arms WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบรายการ' });

    const newQty = rows[0].stock_qty + delta;
    if (newQty < 0) return res.status(400).json({ error: 'สต็อกไม่พอ' });

    await pool.query('UPDATE wing_arms SET stock_qty = ? WHERE id = ?', [newQty, req.params.id]);

    const userId = req.user?.id || req.body.user_id || 1;
    // ใช้ wing_arm_id แยกจาก rack_id เพื่อไม่ให้ FK constraint fail
    // ถ้า column ยังไม่มีให้รัน migration SQL ด้านล่างก่อน
    try {
      await pool.query(
        'INSERT INTO transactions (wing_arm_id, type, qty, user_id, note) VALUES (?,?,?,?,?)',
        [req.params.id, delta > 0 ? 'IN' : 'OUT', Math.abs(delta), userId, note]
      );
    } catch (txErr) {
      // log แต่ไม่ fail — stock อัปเดตสำเร็จแล้ว
      console.warn('[wing-arm stock] tx log skipped:', txErr.message);
    }

    const [updated] = await pool.query('SELECT * FROM wing_arms WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;