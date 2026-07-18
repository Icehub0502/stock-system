const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// รับเข้าสต็อก (สแกน QR) - office และ ช่าง ทำได้ทั้งคู่
router.post('/in', async (req, res) => {
  const { model_code, qty = 1, note = '' } = req.body || {};
  const quantity = Number(qty);
  if (!model_code || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT * FROM racks WHERE model_code = ? FOR UPDATE', [model_code]);
    const rack = rows[0];
    if (!rack) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบรหัสรุ่นนี้ในระบบ' });
    }

    await conn.execute('UPDATE racks SET stock_qty = stock_qty + ? WHERE id = ?', [quantity, rack.id]);
    await conn.execute(
      'INSERT INTO transactions (rack_id, type, qty, user_id, note) VALUES (?, ?, ?, ?, ?)',
      [rack.id, 'IN', quantity, req.user.id, note]
    );
    await conn.commit();

    const [updatedRows] = await pool.execute('SELECT * FROM racks WHERE id = ?', [rack.id]);
    res.json({ success: true, rack: updatedRows[0] });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'ทำรายการไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// จ่ายออกจากสต็อก (สแกน QR) - frontend ต้องให้ผู้ใช้กดยืนยันชื่อรุ่น/รหัสรุ่นก่อนเรียก endpoint นี้
router.post('/out', async (req, res) => {
  const { model_code, qty = 1, note = '' } = req.body || {};
  const quantity = Number(qty);
  if (!model_code || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
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
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'ทำรายการไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// ประวัติรายการ - เฉพาะ office
router.get('/', requireRole('office'), async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT t.id, t.type, t.qty, t.note, t.created_at,
             r.model_code, r.name AS rack_name,
             u.username, u.full_name
      FROM transactions t
      JOIN racks r ON r.id = t.rack_id
      JOIN users u ON u.id = t.user_id
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
