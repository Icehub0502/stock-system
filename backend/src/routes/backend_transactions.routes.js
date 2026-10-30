const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole, requireManager } = require('../middleware/auth');
const { vehicleModelFromRackName } = require('../utils/vehicleModelFromName');
const { resolveTransactionDate } = require('../utils/resolveTransactionDate');
const { emitStockEvent, emitStockTxEvent, emitReceiptSessionEvent } = require('../realtime');
const { voidReceiveMovement } = require('./stockReceive.routes');
const { findOrCreateSupplier } = require('./suppliers.routes');

const { positionLabel } = require('../utils/stockPositions');

const router = express.Router();
router.use(authenticate);

// ── เปิดบิลรับสินค้า (office หรือช่าง — กรอกเลขบิลก่อนเริ่มสแกนจากหน้าสแกน) ──
// bill_date ไม่บังคับ — ไม่ส่งมา = วันนี้ ส่งมา = คีย์บิลย้อนหลัง (ดู init.js)
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

router.post('/receipt-session', async (req, res) => {
  const { invoice_no, bill_date = null, supplier_name = null } = req.body || {};
  if (!invoice_no) {
    return res.status(400).json({ error: 'กรุณากรอกรหัสบิล' });
  }
  if (bill_date && !DATE_ONLY_RE.test(bill_date)) {
    return res.status(400).json({ error: 'รูปแบบวันที่ไม่ถูกต้อง' });
  }
  try {
    // the shop the parts came from (one bill = one supplier): picked from the list or typed, a new name is added to it
    let supplier = { id: null, name: null };
    if (supplier_name && String(supplier_name).trim()) {
      supplier = await findOrCreateSupplier(pool, req.shopId, supplier_name);
      if (supplier.error) return res.status(400).json({ error: supplier.error });
    }
    const [result] = await pool.execute(
      'INSERT INTO receipt_sessions (shop_id, invoice_no, user_id, bill_date, supplier_id, supplier_name) VALUES (?, ?, ?, COALESCE(?, CURDATE()), ?, ?)',
      [req.shopId, invoice_no.trim(), req.user.id, bill_date, supplier.id, supplier.name]
    );
    const [rows] = await pool.execute(
      `SELECT s.*, u.full_name FROM receipt_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.shop_id = ?`,
      [result.insertId, req.shopId]
    );

    emitReceiptSessionEvent('stock:receipt-session-created', { shopId: req.shopId,
      sessionId: result.insertId,
      actorId: req.user.id,
    });

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
        s.id, s.invoice_no, s.created_at, s.bill_date, s.supplier_name,
        u.full_name,
        (SELECT COUNT(*) FROM transactions t WHERE t.receipt_session_id = s.id AND t.type = 'IN')
          + (SELECT COUNT(*) FROM stock_item_movements m
             WHERE m.receipt_session_id = s.id AND m.reason = 'receive' AND m.voided_at IS NULL) AS item_count,
        (SELECT COUNT(*) FROM stock_receive_lines l WHERE l.receipt_session_id = s.id AND l.applied_at IS NULL) AS pending_count,
        (SELECT COALESCE(SUM(t.qty), 0) FROM transactions t WHERE t.receipt_session_id = s.id AND t.type = 'IN')
          + (SELECT COALESCE(SUM(m.qty_after - m.qty_before), 0) FROM stock_item_movements m
             WHERE m.receipt_session_id = s.id AND m.reason = 'receive' AND m.voided_at IS NULL) AS total_qty
      FROM receipt_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.shop_id = ?
      ORDER BY s.bill_date DESC, s.created_at DESC
      LIMIT 200
    `, [req.shopId]);
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
       JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.shop_id = ?`,
      [req.params.id, req.shopId]
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

    // ของที่รับเข้าสต๊อกรวม — source='stock_item' ให้หน้าเว็บรู้ว่าต้องลบผ่าน
    // /stock-receive/movements/:id (id ชนกับ transactions.id ได้ จึงต้องแยกด้วย source)
    const [stockItems] = await pool.execute(
      `SELECT m.id, (m.qty_after - m.qty_before) AS qty, m.created_at, m.position,
              COALESCE(p.oem_code, i.oem_code) AS model_code,
              i.description AS rack_name, c.name AS category_name
       FROM stock_item_movements m
       JOIN stock_items i ON i.id = m.item_id
       JOIN stock_categories c ON c.id = i.category_id
       LEFT JOIN stock_item_positions p ON p.item_id = m.item_id AND p.position = m.position
       WHERE i.shop_id = ? AND m.receipt_session_id = ? AND m.reason = 'receive' AND m.voided_at IS NULL
       ORDER BY m.created_at ASC`,
      [req.shopId, req.params.id]
    );

    // รายการที่สแกนไว้แล้วแต่ยังไม่กดเสร็จสิ้น (ยังไม่บวกสต๊อก) — source='pending_line' ให้หน้าเว็บ
    // แสดงป้าย "รอยืนยัน" และลบผ่าน /stock-receive/lines/:id
    const [pendingLines] = await pool.execute(
      `SELECT l.id, l.qty, l.created_at, l.position,
              COALESCE(p.oem_code, i.oem_code) AS model_code,
              i.description AS rack_name, c.name AS category_name
       FROM stock_receive_lines l
       JOIN stock_items i ON i.id = l.item_id
       JOIN stock_categories c ON c.id = i.category_id
       LEFT JOIN stock_item_positions p ON p.item_id = l.item_id AND p.position = l.position
       WHERE i.shop_id = ? AND l.receipt_session_id = ? AND l.applied_at IS NULL
       ORDER BY l.id ASC`,
      [req.shopId, req.params.id]
    );

    res.json({
      session,
      items: [
        ...items.map((it) => ({ ...it, source: 'legacy' })),
        ...pendingLines.map((it) => ({
          ...it,
          source: 'pending_line',
          item_type: 'stock_item',
          pending: true,
          rack_name: it.position ? `${it.rack_name} (${positionLabel(it.position)})` : it.rack_name,
        })),
        ...stockItems.map((it) => ({
          ...it,
          source: 'stock_item',
          item_type: 'stock_item',
          rack_name: it.position ? `${it.rack_name} (${positionLabel(it.position)})` : it.rack_name,
        })),
      ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    });
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
router.delete('/receipt-sessions/:id', requireManager, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[session]] = await conn.query('SELECT * FROM receipt_sessions WHERE id = ? AND shop_id = ? FOR UPDATE', [req.params.id, req.shopId]);
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

    // ของที่รับเข้าสต๊อกรวมในบิลนี้ — ยกเลิกทีละรายการ (หักยอดคืน) ถ้ารายการไหนทำให้ติดลบจะไม่ลบทั้งบิล
    const [stockMovements] = await conn.query(
      `SELECT m.id FROM stock_item_movements m JOIN stock_items i ON i.id = m.item_id
       WHERE i.shop_id = ? AND m.receipt_session_id = ? AND m.reason = 'receive' AND m.voided_at IS NULL`,
      [req.shopId, req.params.id]
    );
    for (const mv of stockMovements) {
      const result = await voidReceiveMovement(conn, mv.id, req.user.id, req.shopId);
      if (result.error) {
        await conn.rollback();
        return res.status(result.status).json({ error: result.error });
      }
    }
    // แถวประวัติของบิลนี้ยังอยู่ (เก็บไว้ตรวจย้อนหลัง) แค่ตัดการผูกกับบิลที่กำลังจะถูกลบ
    await conn.query('UPDATE stock_item_movements SET receipt_session_id = NULL WHERE receipt_session_id = ?', [req.params.id]);
    await conn.query(`DELETE FROM transactions WHERE receipt_session_id = ? AND type = 'IN'`, [req.params.id]);
    await conn.query('DELETE FROM receipt_sessions WHERE id = ? AND shop_id = ?', [req.params.id, req.shopId]);
    await conn.commit();

    emitStockEvent('stock:item-updated', { shopId: req.shopId, entityType: null, entityId: null, actorId: req.user.id });
    emitStockTxEvent('stock:tx-deleted', { shopId: req.shopId, txType: 'IN', entityType: null, entityId: null, actorId: req.user.id });

    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'ลบบิลไม่สำเร็จ' });
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
  // ประวัติรายการเก่าของสต๊อกแร็ค/ปีกนก (ตารางเลิกใช้แล้ว) เป็นของร้านที่ 1 เท่านั้น
  if (req.shopId !== 1) return res.json([]);
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
      LEFT JOIN receipt_sessions s ON s.id = t.receipt_session_id AND s.shop_id = ?
      WHERE u.shop_id = ?
      ORDER BY t.created_at DESC
      LIMIT 500
    `, [req.shopId, req.shopId]);
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
router.delete('/:id', requireManager, async (req, res) => {
  // รายการเก่าของสต๊อกแร็ค/ปีกนก เป็นของร้านที่ 1 เท่านั้น
  if (req.shopId !== 1) return res.status(404).json({ error: 'ไม่พบรายการนี้' });
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

    emitStockEvent('stock:item-updated', { shopId: req.shopId,
      entityType: tx.rack_id ? 'rack' : 'wing_arm',
      entityId: tx.rack_id || tx.wing_arm_id,
      actorId: req.user.id,
    });
    emitStockTxEvent('stock:tx-deleted', { shopId: req.shopId,
      txType: tx.type,
      entityType: tx.rack_id ? 'rack' : 'wing_arm',
      entityId: tx.rack_id || tx.wing_arm_id,
      actorId: req.user.id,
    });

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
// ไม่ group อีกต่อไป (เดิม SUM+GROUP BY รวมยอดต่อวัน) — เปลี่ยนเป็นคืนทีละ
// transaction จริง เพื่อให้หน้าเว็บมี id ต่อแถวสำหรับปุ่มลบ (เรียก DELETE /:id
// เดิมด้านบน ซึ่งคืนสต็อกให้ถูกต้องอยู่แล้ว) ยอดรวมต่อวันยังคำนวณได้เหมือนเดิม
// แค่ไปรวมฝั่งหน้าเว็บแทน (StockUsageReportPage.jsx)
router.get('/deduction-history', requireRole('office'), async (req, res) => {
  const { from, to } = req.query;
  const params = [];
  let dateFilter = '';
  if (from) { dateFilter += ' AND t.created_at >= ?'; params.push(`${from} 00:00:00`); }
  if (to) { dateFilter += ' AND t.created_at <= ?'; params.push(`${to} 23:59:59`); }

  try {
    // รายการเก่าของสต๊อกแร็ค/ปีกนก (ตารางเลิกใช้แล้ว) เป็นของร้านที่ 1 เท่านั้น
    const [rows] = req.shopId === 1 ? await pool.execute(`
      SELECT
        t.id,
        t.created_at,
        DATE(t.created_at) AS tx_date,
        t.vehicle_model,
        t.qty,
        COALESCE(r.model_code, w.sku) AS part_code,
        COALESCE(r.name, w.name) AS part_name,
        IF(t.rack_id IS NOT NULL, 'rack', 'wing_arm') AS item_type
      FROM transactions t
      LEFT JOIN racks r ON r.id = t.rack_id
      LEFT JOIN wing_arms w ON w.id = t.wing_arm_id
      WHERE t.type = 'OUT'${dateFilter}
      ORDER BY tx_date DESC, t.created_at DESC
    `, params) : [[]];

    // การตัดสต๊อกของสต๊อกรวม (หน้าตัดสต๊อกใหม่/จ่ายออกที่หน้าสแกน) — วันที่ใช้ moved_at (วันที่ของออกจริง
    // ตัดย้อนหลังได้) ถ้าไม่มีใช้ created_at; source ให้หน้าเว็บรู้ว่าลบผ่าน /stock-deductions
    const moveParams = [req.shopId];
    let moveFilter = '';
    if (from) { moveFilter += ' AND COALESCE(m.moved_at, m.created_at) >= ?'; moveParams.push(`${from} 00:00:00`); }
    if (to) { moveFilter += ' AND COALESCE(m.moved_at, m.created_at) <= ?'; moveParams.push(`${to} 23:59:59`); }
    const [moves] = await pool.execute(`
      SELECT m.id, COALESCE(m.moved_at, m.created_at) AS created_at, m.vehicle_model, m.position,
             (m.qty_before - m.qty_after) AS qty,
             COALESCE(p.oem_code, i.oem_code) AS part_code,
             i.description AS part_name, c.name AS category_name
      FROM stock_item_movements m
      JOIN stock_items i ON i.id = m.item_id
      JOIN stock_categories c ON c.id = i.category_id
      LEFT JOIN stock_item_positions p ON p.item_id = m.item_id AND p.position = m.position
      WHERE i.shop_id = ? AND m.reason = 'deduct' AND m.voided_at IS NULL${moveFilter}
    `, moveParams);

    const data = [
      ...rows.map((r) => ({ ...r, source: 'legacy' })),
      ...moves.map((m) => ({
        id: m.id,
        created_at: m.created_at,
        tx_date: String(m.created_at).slice(0, 10),
        vehicle_model: m.vehicle_model,
        qty: m.qty,
        part_code: m.part_code,
        part_name: m.position ? `${m.part_name} (${positionLabel(m.position)})` : m.part_name,
        item_type: 'stock_item',
        category_name: m.category_name,
        source: 'stock_item',
      })),
    ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดรายงานไม่สำเร็จ' });
  }
});

module.exports = router;