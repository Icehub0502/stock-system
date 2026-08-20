const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { vehicleModelFromRackName } = require('../utils/vehicleModelFromName');
const { resolveTransactionDate } = require('../utils/resolveTransactionDate');

const router = express.Router();
router.use(authenticate);

// ── เปิดบิลรับสินค้า (office หรือช่าง — กรอกเลขบิลก่อนเริ่มสแกนจากหน้าสแกน) ──
// bill_date ไม่บังคับ — ไม่ส่งมา = วันนี้ ส่งมา = คีย์บิลย้อนหลัง (ดู init.js)
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

router.post('/receipt-session', async (req, res) => {
  const { invoice_no, bill_date = null } = req.body || {};
  if (!invoice_no) {
    return res.status(400).json({ error: 'กรุณากรอกรหัสบิล' });
  }
  if (bill_date && !DATE_ONLY_RE.test(bill_date)) {
    return res.status(400).json({ error: 'รูปแบบวันที่ไม่ถูกต้อง' });
  }
  try {
    const [result] = await pool.execute(
      'INSERT INTO receipt_sessions (invoice_no, user_id, bill_date) VALUES (?, ?, COALESCE(?, CURDATE()))',
      [invoice_no.trim(), req.user.id, bill_date]
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
// เรียง/จัดกลุ่มตาม bill_date (วันของบิลที่พนักงานระบุ) ไม่ใช่ created_at (เวลาที่คีย์
// เข้าระบบ) — บิลที่คีย์ย้อนหลังจะได้ไปอยู่ในวันที่ถูกต้อง (ดู init.js)
router.get('/receipt-sessions', requireRole('office'), async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT
        s.id, s.invoice_no, s.created_at, s.bill_date,
        u.full_name,
        COUNT(t.id) AS item_count,
        COALESCE(SUM(t.qty), 0) AS total_qty
      FROM receipt_sessions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN transactions t ON t.receipt_session_id = s.id AND t.type = 'IN'
      GROUP BY s.id
      ORDER BY s.bill_date DESC, s.created_at DESC
      LIMIT 200
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดบิลไม่สำเร็จ' });
  }
});

// ── รายละเอียดบิล (สินค้าในบิลนั้น) ──
// เดิม JOIN racks แบบ INNER JOIN อย่างเดียว ทำให้ปีกนกที่สแกนเข้าบิลไม่โผล่เลย —
// เปลี่ยนเป็น LEFT JOIN ทั้งสองตารางแล้ว COALESCE เหมือน GET / (ประวัติรายการ)
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
             COALESCE(r.model_code, w.sku) AS model_code,
             COALESCE(r.name, w.name) AS rack_name,
             IF(t.rack_id IS NOT NULL, 'rack', 'wing_arm') AS item_type
      FROM transactions t
      LEFT JOIN racks r ON r.id = t.rack_id
      LEFT JOIN wing_arms w ON w.id = t.wing_arm_id
      WHERE t.receipt_session_id = ? AND t.type = 'IN'
      ORDER BY t.created_at ASC
    `, [req.params.id]);

    res.json({ session, items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดรายละเอียดบิลไม่สำเร็จ' });
  }
});

// ── ลบบิลทั้งใบ (เผื่อบิลผิด/ไม่ได้ใช้แล้ว) ──
// คืนสต็อกของทุกรายการในบิลก่อน (เหมือน DELETE /:id ทีละรายการ แต่ทำทั้งบิลในทรานแซกชัน
// เดียว) แล้วค่อยลบทั้งแถว transactions และ receipt_sessions — ถ้ารายการไหนถูกเบิกออก
// ไปแล้วหลังรับเข้า (คืนแล้วจะติดลบ) จะไม่ยอมลบทั้งบิลเลยและแจ้งเตือนว่าติดที่รายการไหน
// กันข้อมูลสต็อกเพี้ยนแบบเงียบ ๆ
router.delete('/receipt-sessions/:id', requireRole('office'), async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[session]] = await conn.query('SELECT * FROM receipt_sessions WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!session) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบบิลนี้' });
    }

    const [items] = await conn.query(
      `SELECT * FROM transactions WHERE receipt_session_id = ? AND type = 'IN' FOR UPDATE`,
      [req.params.id]
    );

    for (const tx of items) {
      const table = tx.rack_id ? 'racks' : 'wing_arms';
      const itemId = tx.rack_id || tx.wing_arm_id;
      if (!itemId) continue;
      const [rows] = await conn.query(`SELECT * FROM ${table} WHERE id = ? FOR UPDATE`, [itemId]);
      const item = rows[0];
      if (!item) continue;
      const newQty = Number(item.stock_qty) - Number(tx.qty); // IN เคยบวกสต็อก → ลบออก
      if (newQty < 0) {
        await conn.rollback();
        return res.status(400).json({
          error: `ลบไม่ได้ — "${item.name}" ถูกเบิกออกไปแล้ว ถ้าลบบิลนี้สต็อกจะติดลบ (คงเหลือ ${item.stock_qty})`,
        });
      }
      await conn.query(`UPDATE ${table} SET stock_qty = ? WHERE id = ?`, [newQty, itemId]);
    }

    await conn.query(`DELETE FROM transactions WHERE receipt_session_id = ? AND type = 'IN'`, [req.params.id]);
    await conn.query('DELETE FROM receipt_sessions WHERE id = ?', [req.params.id]);
    await conn.commit();

    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'ลบบิลไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
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
    // คืน transaction_id ให้หน้าสแกนเก็บไว้ เผื่อสแกนผิดแล้วกดลบทันที (DELETE /transactions/:id)
    const [txResult] = await conn.execute(
      'INSERT INTO transactions (rack_id, type, qty, user_id, note, receipt_session_id) VALUES (?, ?, ?, ?, ?, ?)',
      [rack.id, 'IN', quantity, req.user.id, note, receipt_session_id || null]
    );
    await conn.commit();

    const [updatedRows] = await pool.execute('SELECT * FROM racks WHERE id = ?', [rack.id]);
    res.json({ success: true, rack: updatedRows[0], transaction_id: txResult.insertId });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'ทำรายการไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// ── จ่ายออกจากสต็อก ──
// vehicle_model: หน้าตัดสต๊อก (StockDeductionPage.jsx) เดาค่านี้จากชื่อแร็คให้เอง
// แล้วโชว์เป็นช่องกรอกให้พนักงานยืนยัน/แก้ก่อนส่ง — ค่าที่ส่งมาจาก client ใช้ตรง ๆ
// ไม่มีส่ง/ว่างเปล่าค่อย fallback ไปเดาจากชื่อเองอีกที (กันเรียก endpoint นี้ตรง ๆ
// โดยไม่ผ่านหน้าตัดสต๊อก เช่นเรียกจาก API ภายนอก)
router.post('/out', async (req, res) => {
  const { model_code, qty = 1, note = '', vehicle_model, transaction_date } = req.body || {};
  const quantity = Number(qty);
  if (!model_code || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  }
  const createdAt = resolveTransactionDate(transaction_date);

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
    const [txResult] = createdAt
      ? await conn.execute(
          'INSERT INTO transactions (rack_id, type, qty, user_id, note, vehicle_model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [rack.id, 'OUT', quantity, req.user.id, note, vehicle_model || vehicleModelFromRackName(rack.name), createdAt]
        )
      : await conn.execute(
          'INSERT INTO transactions (rack_id, type, qty, user_id, note, vehicle_model) VALUES (?, ?, ?, ?, ?, ?)',
          [rack.id, 'OUT', quantity, req.user.id, note, vehicle_model || vehicleModelFromRackName(rack.name)]
        );
    await conn.commit();

    const [updatedRows] = await pool.execute('SELECT * FROM racks WHERE id = ?', [rack.id]);
    res.json({ success: true, rack: updatedRows[0], transaction_id: txResult.insertId });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'ทำรายการไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// ── ประวัติรายการทั้งหมด ──
// เดิม JOIN racks แบบ INNER JOIN เพียงอย่างเดียว ทำให้รายการของปีกนก (wing_arm_id
// ไม่ใช่ null แต่ rack_id เป็น null) หายไปจากประวัติทั้งหมดโดยไม่มีใครสังเกตเห็น —
// เปลี่ยนเป็น LEFT JOIN ทั้งสองตารางแล้ว COALESCE ชื่อ/รหัสแทน ให้เห็นครบทั้งสอง
// ระบบสต๊อกในตารางเดียว (ดู model_code/name ของ racks กับ sku/name ของ wing_arms)
router.get('/', requireRole('office'), async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT t.id, t.type, t.qty, t.note, t.created_at, t.vehicle_brand, t.vehicle_model,
             COALESCE(r.model_code, w.sku) AS model_code,
             COALESCE(r.name, w.name) AS rack_name,
             IF(t.rack_id IS NOT NULL, 'rack', 'wing_arm') AS item_type,
             u.username, u.full_name,
             s.invoice_no
      FROM transactions t
      LEFT JOIN racks r ON r.id = t.rack_id
      LEFT JOIN wing_arms w ON w.id = t.wing_arm_id
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

// ── ลบรายการที่สแกนผิด (คืนสต็อกให้กลับไปเท่าเดิม) ──
// ใช้ตอนสแกนผิดตัวแล้วอยากสแกนใหม่ (ดู TechnicianScanPage.jsx) และตอนแก้ไขบิลย้อนหลัง
// จากหน้าบิลรับเข้า (ReceiptSessionPage.jsx) — ลบแถวใน transactions พร้อมกลับรายการ
// สต็อกในทรานแซกชันเดียว: รายการ IN คืนโดยหักสต็อกออก, รายการ OUT คืนโดยบวกกลับ
// ถ้าหักแล้วสต็อกจะติดลบ (ของถูกเบิกไปใช้แล้วหลังรับเข้า) จะไม่ยอมลบและแจ้งเตือนแทน
// การปล่อยให้ตัวเลขติดลบเงียบ ๆ
router.delete('/:id', requireRole('office'), async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [txRows] = await conn.query('SELECT * FROM transactions WHERE id = ? FOR UPDATE', [req.params.id]);
    const tx = txRows[0];
    if (!tx) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบรายการนี้' });
    }

    const table = tx.rack_id ? 'racks' : 'wing_arms';
    const itemId = tx.rack_id || tx.wing_arm_id;
    if (!itemId) {
      await conn.rollback();
      return res.status(400).json({ error: 'รายการนี้ไม่ได้ผูกกับอะไหล่ ลบไม่ได้' });
    }

    const [itemRows] = await conn.query(`SELECT * FROM ${table} WHERE id = ? FOR UPDATE`, [itemId]);
    const item = itemRows[0];
    if (!item) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบอะไหล่ของรายการนี้' });
    }

    // กลับรายการ: IN เคยบวกสต็อก → ลบออก, OUT เคยหักสต็อก → บวกคืน
    const delta = tx.type === 'IN' ? -Number(tx.qty) : Number(tx.qty);
    const newQty = Number(item.stock_qty) + delta;
    if (newQty < 0) {
      await conn.rollback();
      return res.status(400).json({
        error: `ลบไม่ได้ — ของถูกเบิกออกไปแล้ว ถ้าลบรายการนี้สต็อกจะติดลบ (คงเหลือ ${item.stock_qty})`,
      });
    }

    await conn.query(`UPDATE ${table} SET stock_qty = ? WHERE id = ?`, [newQty, itemId]);
    await conn.query('DELETE FROM transactions WHERE id = ?', [req.params.id]);
    await conn.commit();

    res.json({ success: true, stock_qty: newQty });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'ลบรายการไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// ── ประวัติการตัดสต๊อก: กลุ่มตามวันที่ตัด ──
// เดิมเป็นรายงาน "อะไหล่ตามรุ่นรถ" (group by vehicle_model) เจ้าของร้านสั่งเปลี่ยน
// เป็นดูย้อนหลังว่าวันไหนตัดอะไรไปเท่าไหร่กี่ชิ้นแทน (group by วันที่) ใช้ tx_date
// จาก created_at ตรง ๆ — ตรงกับวันที่จริงที่ตัด แม้เป็นการตัดย้อนหลังผ่านช่อง
// "วันที่ตัดสต๊อก" ในหน้าตัดสต๊อกก็ตาม (ดู resolveTransactionDate.js) ไม่กรอง
// vehicle_model IS NOT NULL อีกต่อไป เพราะเป็นหน้าประวัติ ควรเห็นการตัดทุกรายการ
// จริง แม้รายการเก่าก่อนมีฟีเจอร์ vehicle_model จะไม่มีค่านี้ก็ตาม กรองช่วงวันที่ได้
// ด้วย from/to (YYYY-MM-DD ทั้งคู่ ไม่ระบุ = เอาทั้งหมด)
router.get('/deduction-history', requireRole('office'), async (req, res) => {
  const { from, to } = req.query;
  const params = [];
  let dateFilter = '';
  if (from) { dateFilter += ' AND t.created_at >= ?'; params.push(`${from} 00:00:00`); }
  if (to) { dateFilter += ' AND t.created_at <= ?'; params.push(`${to} 23:59:59`); }

  try {
    const [rows] = await pool.execute(`
      SELECT
        DATE(t.created_at) AS tx_date,
        t.vehicle_model,
        COALESCE(r.model_code, w.sku) AS part_code,
        COALESCE(r.name, w.name) AS part_name,
        IF(t.rack_id IS NOT NULL, 'rack', 'wing_arm') AS item_type,
        SUM(t.qty) AS total_qty,
        COUNT(*) AS movement_count
      FROM transactions t
      LEFT JOIN racks r ON r.id = t.rack_id
      LEFT JOIN wing_arms w ON w.id = t.wing_arm_id
      WHERE t.type = 'OUT'${dateFilter}
      GROUP BY tx_date, t.vehicle_model, part_code, part_name, item_type
      ORDER BY tx_date DESC, total_qty DESC
    `, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดรายงานไม่สำเร็จ' });
  }
});

module.exports = router;