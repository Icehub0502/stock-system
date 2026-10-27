const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { emitStockEvent, emitStockTxEvent } = require('../realtime');
const { positionsFor, positionLabel } = require('../utils/stockPositions');
const { resolveTransactionDate } = require('../utils/resolveTransactionDate');

// ตัดสต๊อกของสต๊อกรวม (หน้า "ตัดสต๊อก" และโหมดจ่ายออกที่หน้าสแกน)
// ตัดได้หลายตำแหน่งของชิ้นเดียวกันในครั้งเดียว (เช่น ปีกนกซ้าย+ขวาเป็นคู่) — ทั้งหมดอยู่ใน
// ทรานแซกชันเดียว ตำแหน่งไหนสต๊อกไม่พอ = ไม่ตัดเลยสักตำแหน่ง ตัดเกินยอด/ติดลบไม่ได้
// สร้างรายการตัดเปิดให้ทุก role ที่ล็อกอิน (ช่างจ่ายของออกที่หน้าสแกนได้เหมือนระบบเดิม)
// ส่วนยกเลิกรายการที่ตัดไปแล้ว (คืนสต๊อก) เฉพาะ office
const router = express.Router();
router.use(authenticate);

const MAX_QTY = 1000000;
const MAX_LINES = 8;

function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// วันที่ปฏิทินที่มีอยู่จริง (ไม่รับ 2026-02-31 ที่ JS/MySQL ปัดเป็นเดือนถัดไปเงียบ ๆ)
function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// body: { item_id, lines: [{ position, qty }], vehicle_model?, deduction_date?, note? }
// ของธรรมดา (ไม่แยกตำแหน่ง) ส่ง lines เป็น [{ qty }] (position ว่าง)
router.post('/', async (req, res) => {
  const body = req.body || {};
  const itemId = parseId(body.item_id);
  const rawLines = Array.isArray(body.lines) ? body.lines : null;
  if (!itemId || !rawLines || rawLines.length === 0 || rawLines.length > MAX_LINES) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  }

  const lines = [];
  const seen = new Set();
  for (const raw of rawLines) {
    const qty = Number(raw?.qty);
    const position = raw?.position ?? null;
    if (!Number.isInteger(qty) || qty <= 0 || qty > MAX_QTY || (position !== null && typeof position !== 'string')) {
      return res.status(400).json({ error: 'จำนวนต้องเป็นเลขจำนวนเต็มตั้งแต่ 1 ขึ้นไป' });
    }
    if (seen.has(position)) return res.status(400).json({ error: 'ตำแหน่งซ้ำกันในรายการ' });
    seen.add(position);
    lines.push({ position, qty });
  }

  const vehicleModel = String(body.vehicle_model ?? '').trim().slice(0, 150) || null;
  const note = String(body.note ?? '').trim().slice(0, 255) || null;

  // วันที่ของออกจริง (ตัดย้อนหลังได้ เลือกวันในอนาคตไม่ได้) — ไม่ส่ง/เป็นวันนี้ = ใช้เวลาปัจจุบัน
  let movedAt = null;
  if (body.deduction_date !== undefined && body.deduction_date !== null && body.deduction_date !== '') {
    const date = String(body.deduction_date);
    movedAt = isRealDate(date) ? resolveTransactionDate(date) : null;
    if (!movedAt) return res.status(400).json({ error: 'รูปแบบวันที่ไม่ถูกต้อง' });
    if (date > todayLocal()) return res.status(400).json({ error: 'เลือกวันที่ในอนาคตไม่ได้' });
    if (date === todayLocal()) movedAt = null;
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[item]] = await conn.execute(
      `SELECT id, description, has_sides, has_axles, has_levels, stock_qty
       FROM stock_items WHERE id = ? AND shop_id = ? AND is_active = 1 FOR UPDATE`,
      [itemId, req.shopId]
    );
    if (!item) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบรายการนี้ในสต๊อกรวม' });
    }
    const validPositions = positionsFor(item.has_sides, item.has_axles, item.has_levels);
    const isPositioned = validPositions.length > 0;
    for (const line of lines) {
      if (isPositioned ? !validPositions.includes(line.position) : line.position !== null) {
        await conn.rollback();
        return res.status(400).json({
          error: isPositioned ? 'รายการนี้แยกตำแหน่ง ต้องระบุตำแหน่งให้ถูกต้อง' : 'รายการนี้ไม่แยกตำแหน่ง',
        });
      }
    }

    const results = [];
    const movementIds = [];
    let total = item.stock_qty;
    for (const line of lines) {
      let before = item.stock_qty;
      if (isPositioned) {
        const [[row]] = await conn.execute(
          'SELECT qty FROM stock_item_positions WHERE item_id = ? AND position = ? FOR UPDATE',
          [itemId, line.position]
        );
        before = row ? row.qty : 0;
      }
      if (before < line.qty) {
        await conn.rollback();
        const where = line.position ? ` (${positionLabel(line.position)})` : '';
        return res.status(400).json({ error: `สต๊อก "${item.description}"${where} เหลือไม่พอ (คงเหลือ ${before})` });
      }
      const after = before - line.qty;
      if (isPositioned) {
        await conn.execute('UPDATE stock_item_positions SET qty = ? WHERE item_id = ? AND position = ?', [after, itemId, line.position]);
      } else {
        total = after;
      }
      const [mv] = await conn.execute(
        `INSERT INTO stock_item_movements
           (item_id, qty_before, qty_after, reason, position, note, user_id, vehicle_model, moved_at)
         VALUES (?, ?, ?, 'deduct', ?, ?, ?, ?, ?)`,
        [itemId, before, after, line.position, note, req.user.id, vehicleModel, movedAt]
      );
      movementIds.push(mv.insertId);
      results.push({ position: line.position, qty_after: after });
    }
    if (isPositioned) {
      const [[sum]] = await conn.execute(
        'SELECT COALESCE(SUM(qty), 0) AS total FROM stock_item_positions WHERE item_id = ?',
        [itemId]
      );
      total = Number(sum.total);
    }
    await conn.execute('UPDATE stock_items SET stock_qty = ? WHERE id = ? AND shop_id = ?', [total, itemId, req.shopId]);
    await conn.commit();

    emitStockEvent('stock:item-updated', { shopId: req.shopId, entityType: 'stock_item', entityId: itemId, actorId: req.user.id });
    emitStockTxEvent('stock:tx-created', { shopId: req.shopId, txType: 'OUT', entityType: 'stock_item', entityId: itemId, actorId: req.user.id });
    res.status(201).json({ success: true, movement_ids: movementIds, items: results, stock_qty: total });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('Error deducting stock item:', err);
    res.status(500).json({ error: 'ตัดสต๊อกไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// ยกเลิกรายการตัดสต๊อก (ตัดผิด) — คืนยอดให้ตำแหน่งนั้น แถวเดิมไม่ลบ แค่ตีตรา voided_at และเพิ่มแถว
// ปรับยอดให้ประวัติของชิ้นนั้นเดินต่อเนื่อง ย้อนซ้ำไม่ได้
router.delete('/movements/:id', requireRole('office'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[mv]] = await conn.execute(
      `SELECT m.id, m.item_id, m.position, m.qty_before, m.qty_after
       FROM stock_item_movements m JOIN stock_items i ON i.id = m.item_id
       WHERE m.id = ? AND i.shop_id = ? AND m.reason = 'deduct' AND m.voided_at IS NULL FOR UPDATE`,
      [id, req.shopId]
    );
    if (!mv) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบรายการนี้ (อาจถูกยกเลิกไปแล้ว)' });
    }
    const [[item]] = await conn.execute('SELECT id, description, stock_qty FROM stock_items WHERE id = ? AND shop_id = ? FOR UPDATE', [mv.item_id, req.shopId]);
    if (!item) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบรายการในสต๊อกรวม' });
    }
    const restored = mv.qty_before - mv.qty_after;
    let current = item.stock_qty;
    if (mv.position) {
      const [[row]] = await conn.execute(
        'SELECT qty FROM stock_item_positions WHERE item_id = ? AND position = ? FOR UPDATE',
        [mv.item_id, mv.position]
      );
      if (!row) {
        await conn.rollback();
        return res.status(400).json({ error: 'ตำแหน่งนี้ไม่มีในรายการแล้ว คืนสต๊อกไม่ได้' });
      }
      current = row.qty;
    }
    const next = current + restored;
    if (next > MAX_QTY) {
      await conn.rollback();
      return res.status(400).json({ error: 'ยอดรวมสูงเกินไป คืนสต๊อกไม่ได้' });
    }
    let total = next;
    if (mv.position) {
      await conn.execute('UPDATE stock_item_positions SET qty = ? WHERE item_id = ? AND position = ?', [next, mv.item_id, mv.position]);
      const [[sum]] = await conn.execute(
        'SELECT COALESCE(SUM(qty), 0) AS total FROM stock_item_positions WHERE item_id = ?',
        [mv.item_id]
      );
      total = Number(sum.total);
    }
    await conn.execute('UPDATE stock_items SET stock_qty = ? WHERE id = ? AND shop_id = ?', [total, mv.item_id, req.shopId]);
    await conn.execute('UPDATE stock_item_movements SET voided_at = NOW() WHERE id = ?', [id]);
    await conn.execute(
      `INSERT INTO stock_item_movements (item_id, qty_before, qty_after, reason, position, note, user_id)
       VALUES (?, ?, ?, 'adjust', ?, 'ยกเลิกการตัดสต๊อก (คืนยอด)', ?)`,
      [mv.item_id, current, next, mv.position, req.user.id]
    );
    await conn.commit();
    emitStockEvent('stock:item-updated', { shopId: req.shopId, entityType: 'stock_item', entityId: mv.item_id, actorId: req.user.id });
    emitStockTxEvent('stock:tx-deleted', { shopId: req.shopId, txType: 'OUT', entityType: 'stock_item', entityId: mv.item_id, actorId: req.user.id });
    res.json({ success: true, stock_qty: total });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('Error voiding stock deduction:', err);
    res.status(500).json({ error: 'ยกเลิกรายการไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
