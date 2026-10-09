const express = require('express');
const QRCode = require('qrcode');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { emitStockEvent, emitStockTxEvent } = require('../realtime');
const { positionsFor, positionLabel } = require('../utils/stockPositions');

// รับเข้าสต๊อกรวมตามบิล (หน้าสแกน /scan โหมดรับเข้า) + พิมพ์ QR ของสต๊อกรวม
//
// การรับเข้าเป็น 2 จังหวะ: สแกน/กรอกจำนวน = เก็บเป็น "รายการรอยืนยัน" (stock_receive_lines)
// แก้จำนวน/ลบได้ ยังไม่แตะสต๊อก → กด "เสร็จสิ้น" (commit) ถึงบวกยอดจริงทั้งบิลในทรานแซกชันเดียว
// และบันทึกเป็นประวัติ 'receive' ของแต่ละชิ้น
//
// สร้าง/แก้/ลบรายการรอยืนยัน + ยืนยัน เปิดให้เจ้าของบิลหรือ office (ช่างสแกนรับของได้เหมือนระบบเดิม)
// ส่วนยกเลิกรายการที่บวกสต๊อกไปแล้ว/ดึง QR เฉพาะ office
const router = express.Router();
router.use(authenticate);

const MAX_QTY = 1000000;

function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// หนึ่งแถวผลลัพธ์ = หนึ่งตำแหน่งที่สแกน/ค้นเจอ (ของธรรมดา position = null)
// ใช้ได้ทั้งตอนสแกน (ตรงรหัส) และค้นเอง (ตรงข้อความ)
const MATCH_SELECT = `
  SELECT i.id AS item_id, c.name AS category_name, i.description, i.min_stock,
         i.has_sides, i.has_axles, i.has_levels,
         p.position, p.oem_code AS position_code, i.oem_code AS item_code,
         COALESCE(p.qty, i.stock_qty) AS qty
  FROM stock_items i
  JOIN stock_categories c ON c.id = i.category_id
  LEFT JOIN stock_item_positions p ON p.item_id = i.id
`;

function shapeMatch(row) {
  const code = row.position ? row.position_code : row.item_code;
  return {
    item_id: row.item_id,
    position: row.position || null,
    position_label: positionLabel(row.position),
    code: code || null,
    category_name: row.category_name,
    description: row.description,
    qty: Number(row.qty),
    min_stock: row.min_stock,
  };
}

// ค้นหาด้วยรหัสที่สแกนได้ (ตรงทั้งสตริง ไม่สนตัวพิมพ์เล็กใหญ่ตาม collation) — QR เดิมที่ติดของ
// ไปแล้วเป็นรหัสล้วน ๆ จึงสแกนเจอเหมือนเดิม ถ้ารหัสซ้ำกันหลายรายการคืนทุกตัวให้ผู้ใช้เลือก
router.get('/lookup', async (req, res) => {
  const code = String(req.query.code ?? '').trim();
  if (!code || code.length > 100) return res.status(400).json({ error: 'รหัสไม่ถูกต้อง' });
  try {
    const [rows] = await pool.execute(
      `${MATCH_SELECT}
       WHERE i.is_active = 1
         AND ((p.item_id IS NOT NULL AND p.oem_code = ?) OR (p.item_id IS NULL AND i.oem_code = ?))
       ORDER BY i.id, p.position
       LIMIT 20`,
      [code, code]
    );
    res.json({ matches: rows.map(shapeMatch) });
  } catch (err) {
    console.error('Error looking up stock code:', err);
    res.status(500).json({ error: 'ค้นหารหัสไม่สำเร็จ' });
  }
});

// ค้นเองเมื่อ QR เสีย: รหัส/รายละเอียด/รุ่นรถ (จำกัด 40 แถว)
router.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 100);
  if (q.length < 2) return res.json({ matches: [] });
  const like = `%${q}%`;
  try {
    const [rows] = await pool.execute(
      `${MATCH_SELECT}
       WHERE i.is_active = 1
         AND (i.oem_code LIKE ? OR i.description LIKE ? OR p.oem_code LIKE ?
              OR EXISTS (SELECT 1 FROM stock_item_fitments f WHERE f.item_id = i.id
                         AND CONCAT(f.brand, ' ', f.model) LIKE ?))
       ORDER BY c.sort_order, i.oem_code, p.position
       LIMIT 40`,
      [like, like, like, like]
    );
    res.json({ matches: rows.map(shapeMatch) });
  } catch (err) {
    console.error('Error searching stock for receive:', err);
    res.status(500).json({ error: 'ค้นหาไม่สำเร็จ' });
  }
});

// บิลต้องเป็นของผู้ใช้คนนี้ (หรือผู้ใช้เป็น office) — คืนแถวบิล หรือ null
async function loadOwnedSession(conn, sessionId, user, { lock = false } = {}) {
  const [[session]] = await conn.execute(
    `SELECT id, user_id, invoice_no FROM receipt_sessions WHERE id = ?${lock ? ' FOR UPDATE' : ''}`,
    [sessionId]
  );
  if (!session) return { status: 404, error: 'ไม่พบบิลนี้' };
  if (user.role !== 'office' && session.user_id !== user.id) return { status: 403, error: 'บิลนี้ไม่ใช่ของคุณ' };
  return { session };
}

function lineSelect(where) {
  return `SELECT l.id, l.receipt_session_id, l.item_id, l.position, l.qty, l.created_at,
                 i.description, i.stock_qty, c.name AS category_name,
                 COALESCE(p.oem_code, i.oem_code) AS code,
                 COALESCE(p.qty, i.stock_qty) AS current_qty
          FROM stock_receive_lines l
          JOIN stock_items i ON i.id = l.item_id
          JOIN stock_categories c ON c.id = i.category_id
          LEFT JOIN stock_item_positions p ON p.item_id = l.item_id AND p.position = l.position
          WHERE ${where}`;
}

function shapeLine(row) {
  return {
    id: row.id,
    item_id: row.item_id,
    position: row.position,
    position_label: positionLabel(row.position),
    qty: row.qty,
    code: row.code,
    description: row.description,
    category_name: row.category_name,
    current_qty: Number(row.current_qty),
    created_at: row.created_at,
  };
}

// เพิ่มรายการรอยืนยันเข้าบิล (ยังไม่บวกสต๊อก) — สแกนชิ้น/ตำแหน่งเดิมซ้ำในบิลเดียวกัน = รวมจำนวนใน
// แถวเดิม (แก้ได้ทีหลัง) แทนที่จะเกิดแถวซ้ำ
router.post('/lines', async (req, res) => {
  const itemId = parseId(req.body?.item_id);
  const position = req.body?.position ?? null;
  const qty = Number(req.body?.qty);
  const sessionId = parseId(req.body?.receipt_session_id);
  if (!itemId || !sessionId || !Number.isInteger(qty) || qty <= 0 || qty > MAX_QTY
      || (position !== null && typeof position !== 'string')) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const owned = await loadOwnedSession(conn, sessionId, req.user, { lock: true });
    if (owned.error) {
      await conn.rollback();
      return res.status(owned.status).json({ error: owned.error });
    }

    const [[item]] = await conn.execute(
      'SELECT id, has_sides, has_axles, has_levels FROM stock_items WHERE id = ? AND is_active = 1',
      [itemId]
    );
    if (!item) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบรายการนี้ในสต๊อกรวม' });
    }
    const validPositions = positionsFor(item.has_sides, item.has_axles, item.has_levels);
    if (validPositions.length > 0 ? !validPositions.includes(position) : position !== null) {
      await conn.rollback();
      return res.status(400).json({
        error: validPositions.length > 0 ? 'รายการนี้แยกตำแหน่ง ต้องระบุตำแหน่งให้ถูกต้อง' : 'รายการนี้ไม่แยกตำแหน่ง',
      });
    }

    const [[existing]] = await conn.execute(
      `SELECT id, qty FROM stock_receive_lines
       WHERE receipt_session_id = ? AND item_id = ? AND position <=> ? AND applied_at IS NULL FOR UPDATE`,
      [sessionId, itemId, position]
    );
    let lineId;
    let lineQty;
    let merged = false;
    if (existing) {
      lineQty = existing.qty + qty;
      if (lineQty > MAX_QTY) {
        await conn.rollback();
        return res.status(400).json({ error: 'จำนวนรวมสูงเกินไป' });
      }
      await conn.execute('UPDATE stock_receive_lines SET qty = ? WHERE id = ?', [lineQty, existing.id]);
      lineId = existing.id;
      merged = true;
    } else {
      const [ins] = await conn.execute(
        'INSERT INTO stock_receive_lines (receipt_session_id, item_id, position, qty, user_id) VALUES (?, ?, ?, ?, ?)',
        [sessionId, itemId, position, qty, req.user.id]
      );
      lineId = ins.insertId;
      lineQty = qty;
    }
    const [[line]] = await conn.execute(lineSelect('l.id = ?'), [lineId]);
    await conn.commit();
    res.status(merged ? 200 : 201).json({ success: true, merged, line: shapeLine(line), qty: lineQty });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('Error adding stock receive line:', err);
    res.status(500).json({ error: 'เพิ่มรายการไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// รายการรอยืนยันของบิล (ใช้ตอนเปิดบิลเดิมต่อ)
router.get('/sessions/:id/lines', async (req, res) => {
  const sessionId = parseId(req.params.id);
  if (!sessionId) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  try {
    const owned = await loadOwnedSession(pool, sessionId, req.user);
    if (owned.error) return res.status(owned.status).json({ error: owned.error });
    const [rows] = await pool.execute(
      `${lineSelect('l.receipt_session_id = ? AND l.applied_at IS NULL')} ORDER BY l.id`,
      [sessionId]
    );
    res.json({ lines: rows.map(shapeLine) });
  } catch (err) {
    console.error('Error loading pending receive lines:', err);
    res.status(500).json({ error: 'โหลดรายการไม่สำเร็จ' });
  }
});

async function loadOwnedPendingLine(conn, lineId, user) {
  const [[line]] = await conn.execute(
    `SELECT l.id, l.receipt_session_id, l.item_id, l.position, l.qty, s.user_id AS session_user_id
     FROM stock_receive_lines l JOIN receipt_sessions s ON s.id = l.receipt_session_id
     WHERE l.id = ? AND l.applied_at IS NULL FOR UPDATE`,
    [lineId]
  );
  if (!line) return { status: 404, error: 'ไม่พบรายการนี้ (อาจถูกยืนยันหรือลบไปแล้ว)' };
  if (user.role !== 'office' && line.session_user_id !== user.id) return { status: 403, error: 'บิลนี้ไม่ใช่ของคุณ' };
  return { line };
}

// แก้จำนวนของรายการรอยืนยัน (พนักงานกรอกผิด)
router.patch('/lines/:id', async (req, res) => {
  const lineId = parseId(req.params.id);
  const qty = Number(req.body?.qty);
  if (!lineId || !Number.isInteger(qty) || qty <= 0 || qty > MAX_QTY) {
    return res.status(400).json({ error: 'จำนวนต้องเป็นเลขจำนวนเต็มตั้งแต่ 1 ขึ้นไป' });
  }
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const found = await loadOwnedPendingLine(conn, lineId, req.user);
    if (found.error) {
      await conn.rollback();
      return res.status(found.status).json({ error: found.error });
    }
    await conn.execute('UPDATE stock_receive_lines SET qty = ? WHERE id = ?', [qty, lineId]);
    await conn.commit();
    res.json({ success: true, qty });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('Error updating stock receive line:', err);
    res.status(500).json({ error: 'แก้จำนวนไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// ลบรายการรอยืนยัน (ยังไม่เคยบวกสต๊อก จึงไม่มีอะไรต้องคืน)
router.delete('/lines/:id', async (req, res) => {
  const lineId = parseId(req.params.id);
  if (!lineId) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const found = await loadOwnedPendingLine(conn, lineId, req.user);
    if (found.error) {
      await conn.rollback();
      return res.status(found.status).json({ error: found.error });
    }
    await conn.execute('DELETE FROM stock_receive_lines WHERE id = ?', [lineId]);
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('Error deleting stock receive line:', err);
    res.status(500).json({ error: 'ลบรายการไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// บวกสต๊อกจริงของรายการรอยืนยันหนึ่งแถว (อยู่ในทรานแซกชันของผู้เรียก) — คืน { itemId } หรือ { status, error }
async function applyLine(conn, line, userId) {
  const [[item]] = await conn.execute(
    `SELECT id, description, has_sides, has_axles, has_levels, stock_qty
     FROM stock_items WHERE id = ? AND is_active = 1 FOR UPDATE`,
    [line.item_id]
  );
  if (!item) return { status: 400, error: 'มีรายการที่ถูกซ่อนหรือลบออกจากสต๊อกรวมไปแล้ว — ลบรายการนั้นออกจากบิลก่อนยืนยัน' };

  let before = item.stock_qty;
  let after;
  let total;
  if (line.position) {
    const [[row]] = await conn.execute(
      'SELECT qty FROM stock_item_positions WHERE item_id = ? AND position = ? FOR UPDATE',
      [line.item_id, line.position]
    );
    if (!row) return { status: 400, error: `"${item.description}" ไม่มีตำแหน่งนี้แล้ว — ลบรายการนี้ออกจากบิลก่อนยืนยัน` };
    before = row.qty;
    after = before + line.qty;
    await conn.execute(
      'UPDATE stock_item_positions SET qty = ? WHERE item_id = ? AND position = ?',
      [after, line.item_id, line.position]
    );
    const [[sum]] = await conn.execute(
      'SELECT COALESCE(SUM(qty), 0) AS total FROM stock_item_positions WHERE item_id = ?',
      [line.item_id]
    );
    total = Number(sum.total);
  } else {
    after = before + line.qty;
    total = after;
  }
  if (after > MAX_QTY) return { status: 400, error: `จำนวนรวมของ "${item.description}" สูงเกินไป` };

  await conn.execute('UPDATE stock_items SET stock_qty = ? WHERE id = ?', [total, line.item_id]);
  await conn.execute(
    `INSERT INTO stock_item_movements (item_id, qty_before, qty_after, reason, position, receipt_session_id, user_id)
     VALUES (?, ?, ?, 'receive', ?, ?, ?)`,
    [line.item_id, before, after, line.position, line.receipt_session_id, userId]
  );
  await conn.execute('UPDATE stock_receive_lines SET applied_at = NOW() WHERE id = ?', [line.id]);
  return { itemId: line.item_id };
}

// เสร็จสิ้น: บวกสต๊อกทุกรายการรอยืนยันของบิลในทรานแซกชันเดียว (พังตรงไหน = ไม่บวกเลยสักรายการ)
router.post('/sessions/:id/commit', async (req, res) => {
  const sessionId = parseId(req.params.id);
  if (!sessionId) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const owned = await loadOwnedSession(conn, sessionId, req.user, { lock: true });
    if (owned.error) {
      await conn.rollback();
      return res.status(owned.status).json({ error: owned.error });
    }
    const [lines] = await conn.execute(
      'SELECT id, receipt_session_id, item_id, position, qty FROM stock_receive_lines WHERE receipt_session_id = ? AND applied_at IS NULL ORDER BY id FOR UPDATE',
      [sessionId]
    );
    if (lines.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'ไม่มีรายการรอยืนยันในบิลนี้' });
    }
    const itemIds = new Set();
    let totalQty = 0;
    for (const line of lines) {
      const result = await applyLine(conn, line, req.user.id);
      if (result.error) {
        await conn.rollback();
        return res.status(result.status).json({ error: result.error });
      }
      itemIds.add(result.itemId);
      totalQty += line.qty;
    }
    await conn.commit();

    itemIds.forEach((itemId) => {
      emitStockEvent('stock:item-updated', { entityType: 'stock_item', entityId: itemId, actorId: req.user.id });
    });
    emitStockTxEvent('stock:tx-created', { txType: 'IN', entityType: 'stock_item', entityId: null, actorId: req.user.id });
    res.json({ success: true, applied: lines.length, total_qty: totalQty });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('Error committing stock receive session:', err);
    res.status(500).json({ error: 'บันทึกรับเข้าไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// ยกเลิกรายการรับเข้าที่ "บวกสต๊อกไปแล้ว" (สแกนผิดแล้วเพิ่งมารู้ทีหลัง) — หักยอดคืนถ้าไม่ทำให้ติดลบ
// แถวเดิมไม่ลบ แค่ตีตรา voided_at และเพิ่มแถวปรับยอดเพื่อให้ประวัติของชิ้นนั้นเดินต่อเนื่อง
router.delete('/movements/:id', requireRole('office'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const result = await voidReceiveMovement(conn, id, req.user.id);
    if (result.error) {
      await conn.rollback();
      return res.status(result.status).json({ error: result.error });
    }
    await conn.commit();
    emitStockEvent('stock:item-updated', { entityType: 'stock_item', entityId: result.itemId, actorId: req.user.id });
    emitStockTxEvent('stock:tx-deleted', { txType: 'IN', entityType: 'stock_item', entityId: result.itemId, actorId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('Error voiding receive movement:', err);
    res.status(500).json({ error: 'ลบรายการไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// ใช้ร่วมกับการลบบิลทั้งใบ (backend_transactions.routes.js) — ต้องอยู่ในทรานแซกชันของผู้เรียก
// คืน { itemId } เมื่อสำเร็จ หรือ { status, error }
async function voidReceiveMovement(conn, movementId, userId) {
  const [[mv]] = await conn.execute(
    `SELECT id, item_id, position, qty_before, qty_after, receipt_session_id
     FROM stock_item_movements WHERE id = ? AND reason = 'receive' AND voided_at IS NULL FOR UPDATE`,
    [movementId]
  );
  if (!mv) return { status: 404, error: 'ไม่พบรายการนี้' };
  const delta = mv.qty_after - mv.qty_before;

  const [[item]] = await conn.execute(
    'SELECT id, description, stock_qty FROM stock_items WHERE id = ? FOR UPDATE',
    [mv.item_id]
  );
  if (!item) return { status: 404, error: 'ไม่พบรายการในสต๊อกรวม' };

  let current = item.stock_qty;
  if (mv.position) {
    const [[row]] = await conn.execute(
      'SELECT qty FROM stock_item_positions WHERE item_id = ? AND position = ? FOR UPDATE',
      [mv.item_id, mv.position]
    );
    current = row ? row.qty : 0;
  }
  const next = current - delta;
  if (next < 0) {
    return {
      status: 400,
      error: `ลบไม่ได้ — "${item.description}" ถูกใช้ไปแล้ว ถ้าลบรายการนี้สต๊อกจะติดลบ (คงเหลือ ${current})`,
    };
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
  await conn.execute('UPDATE stock_items SET stock_qty = ? WHERE id = ?', [total, mv.item_id]);
  await conn.execute('UPDATE stock_item_movements SET voided_at = NOW() WHERE id = ?', [movementId]);
  await conn.execute(
    `INSERT INTO stock_item_movements (item_id, qty_before, qty_after, reason, position, note, user_id)
     VALUES (?, ?, ?, 'adjust', ?, 'ยกเลิกรายการรับเข้า', ?)`,
    [mv.item_id, current, next, mv.position, userId]
  );
  return { itemId: mv.item_id };
}

// ป้าย QR ของรายการที่เลือก: ของแยกตำแหน่ง = หนึ่งป้ายต่อหนึ่งรหัสของแต่ละตำแหน่ง (ข้ามตำแหน่ง
// ที่ยังไม่มีรหัส) ของธรรมดา = หนึ่งป้ายต่อรหัสหลัก QR เป็นรหัสล้วน ๆ เหมือนป้ายเดิมของระบบเก่า
router.get('/qrcodes', requireRole('office'), async (req, res) => {
  const ids = String(req.query.ids ?? '').split(',').map(parseId).filter(Boolean).slice(0, 300);
  if (ids.length === 0) return res.status(400).json({ error: 'กรุณาเลือกรายการ' });
  try {
    const [rows] = await pool.query(
      `${MATCH_SELECT} WHERE i.is_active = 1 AND i.id IN (?) ORDER BY i.id, p.position`,
      [ids]
    );
    const wanted = rows.map(shapeMatch).filter((m) => m.code);
    const labels = await Promise.all(wanted.map(async (m) => ({
      item_id: m.item_id,
      position: m.position,
      code: m.code,
      // ชื่อบนป้าย: รายละเอียด + ตำแหน่ง (ถ้ามี) ให้รู้ว่ารหัสนี้คือด้านไหนตอนแปะของ
      name: m.position_label ? `${m.description} (${m.position_label})` : m.description,
      qrcode: await QRCode.toDataURL(m.code, { width: 300, margin: 1 }),
    })));
    res.json({ labels });
  } catch (err) {
    console.error('Error building stock QR labels:', err);
    res.status(500).json({ error: 'สร้าง QR code ไม่สำเร็จ' });
  }
});

module.exports = router;
module.exports.voidReceiveMovement = voidReceiveMovement;
