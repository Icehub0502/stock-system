const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// ── เปิดบิลรับสินค้า (office หรือช่าง — กรอกเลขบิลก่อนเริ่มสแกนจากหน้าสแกน) ──
router.post('/receipt-session', async (req, res) => {
  const { invoice_no } = req.body || {};
  if (!invoice_no) {
    return res.status(400).json({ error: 'กรุณากรอกรหัสบิล' });
  }
  try {
    const [result] = await pool.execute(
      'INSERT INTO receipt_sessions (invoice_no, user_id) VALUES (?, ?)',
      [invoice_no.trim(), req.user.id]
    );
    const [rows] = await pool.execute(
      `SELECT s.*, u.full_name FROM receipt_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'สร้างบิลไม่สำเร็จ' });
  }
});

// ── รายการบิลรายวัน ──
router.get('/receipt-sessions', requireRole('office'), async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT
        s.id, s.invoice_no, s.created_at,
        u.full_name,
        COUNT(t.id) AS item_count,
        COALESCE(SUM(t.qty), 0) AS total_qty
      FROM receipt_sessions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN transactions t ON t.receipt_session_id = s.id AND t.type = 'IN'
      GROUP BY s.id
      ORDER BY s.created_at DESC
      LIMIT 200
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดบิลไม่สำเร็จ' });
  }
});

// ── รายละเอียดบิล (สินค้าในบิลนั้น) ──
router.get('/receipt-sessions/:id', requireRole('office'), async (req, res) => {
  try {
    const [[session]] = await pool.execute(
      `SELECT s.*, u.full_name FROM receipt_sessions s
       JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
      [req.params.id]
    );
    if (!session) return res.status(404).json({ error: 'ไม่พบบิลนี้' });

    const [items] = await pool.execute(`
      SELECT t.id, t.qty, t.created_at,
             r.model_code, r.name AS rack_name
      FROM transactions t
      JOIN racks r ON r.id = t.rack_id
      WHERE t.receipt_session_id = ? AND t.type = 'IN'
      ORDER BY t.created_at ASC
    `, [req.params.id]);

    res.json({ session, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดรายละเอียดบิลไม่สำเร็จ' });
  }
});

// ── รับเข้าสต็อก ──
router.post('/in', async (req, res) => {
  const { model_code, qty = 1, note = '', receipt_session_id = null } = req.body || {};
  const quantity = Number(qty);
  if (!model_code || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  }

  // ถ้าส่ง receipt_session_id มา ให้ตรวจว่า session นั้นเป็นของ user นี้
  if (receipt_session_id) {
    const [sess] = await pool.execute(
      'SELECT id FROM receipt_sessions WHERE id = ? AND user_id = ?',
      [receipt_session_id, req.user.id]
    );
    if (!sess[0]) return res.status(403).json({ error: 'บิลนี้ไม่ใช่ของคุณ' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT * FROM racks WHERE model_code = ? FOR UPDATE', [model_code]);
    const rack = rows[0];
    if (!rack) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบรหัสรุ่นนี้ในระบบ' });
    }

    await conn.execute('UPDATE racks SET stock_qty = stock_qty + ? WHERE id = ?', [quantity, rack.id]);
    await conn.execute(
      'INSERT INTO transactions (rack_id, type, qty, user_id, note, receipt_session_id) VALUES (?, ?, ?, ?, ?, ?)',
      [rack.id, 'IN', quantity, req.user.id, note, receipt_session_id || null]
    );
    await conn.commit();

    const [updatedRows] = await pool.execute('SELECT * FROM racks WHERE id = ?', [rack.id]);
    res.json({ success: true, rack: updatedRows[0] });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'ทำรายการไม่สำเร็จ' });
  } finally {
    conn.release();
  }
});

// ── จ่ายออกจากสต็อก ──
router.post('/out', async (req, res) => {
  const { model_code, qty = 1, note = '' } = req.body || {};
  const quantity = Number(qty);
  if (!model_code || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT * FROM racks WHERE model_code = ? FOR UPDATE', [model_code]);
    const rack = rows[0];
    if (!rack) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบรหัสรุ่นนี้ในระบบ' });
    }
    if (rack.stock_qty < quantity) {
      await conn.rollback();
      return res.status(400).json({ error: `สต็อกเหลือไม่พอ (คงเหลือ ${rack.stock_qty})` });
    }

    await conn.execute('UPDATE racks SET stock_qty = stock_qty - ? WHERE id = ?', [quantity, rack.id]);
    await conn.execute(
      'INSERT INTO transactions (rack_id, type, qty, user_id, note) VALUES (?, ?, ?, ?, ?)',
      [rack.id, 'OUT', quantity, req.user.id, note]
    );
    await conn.commit();

    const [updatedRows] = await pool.execute('SELECT * FROM racks WHERE id = ?', [rack.id]);
    res.json({ success: true, rack: updatedRows[0] });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'ทำรายการไม่สำเร็จ' });
  } finally {
    conn.release();
  }
});

// ── ประวัติรายการทั้งหมด ──
router.get('/', requireRole('office'), async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT t.id, t.type, t.qty, t.note, t.created_at,
             r.model_code, r.name AS rack_name,
             u.username, u.full_name,
             s.invoice_no
      FROM transactions t
      JOIN racks r ON r.id = t.rack_id
      JOIN users u ON u.id = t.user_id
      LEFT JOIN receipt_sessions s ON s.id = t.receipt_session_id
      ORDER BY t.created_at DESC
      LIMIT 500
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดประวัติไม่สำเร็จ' });
  }
});

module.exports = router;