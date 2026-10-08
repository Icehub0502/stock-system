const express = require('express');
const QRCode = require('qrcode');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { emitStockEvent, emitStockTxEvent } = require('../realtime');

// รับเข้าสต๊อกรวมตามบิล (หน้าสแกน /scan โหมดรับเข้า) + พิมพ์ QR ของสต๊อกรวม
// รับเข้า/ค้นหารหัสเปิดให้ทุก role ที่ล็อกอิน (ช่างสแกนรับของได้เหมือนระบบเดิม) ส่วน
// ยกเลิกรายการรับเข้า/ดึง QR เฉพาะ office
const router = express.Router();
router.use(authenticate);

const MAX_QTY = 1000000;

const POSITION_LABEL = {
  left: 'ซ้าย', right: 'ขวา', front: 'หน้า', rear: 'หลัง',
  front_left: 'หน้าซ้าย', front_right: 'หน้าขวา', rear_left: 'หลังซ้าย', rear_right: 'หลังขวา',
};

function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// หนึ่งแถวผลลัพธ์ = หนึ่งตำแหน่งที่สแกน/ค้นเจอ (ของธรรมดา position = null)
// ใช้ได้ทั้งตอนสแกน (ตรงรหัส) และค้นเอง (ตรงข้อความ)
const MATCH_SELECT = `
  SELECT i.id AS item_id, c.name AS category_name, i.description, i.min_stock,
         i.has_sides, i.has_axles,
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
    position_label: row.position ? POSITION_LABEL[row.position] || row.position : null,
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

// รับเข้า: เพิ่มยอดตำแหน่งที่ระบุ (ของธรรมดาไม่ต้องส่ง position) แล้วผูกกับบิล
// receipt_session_id ต้องเป็นบิลของผู้ใช้คนนี้ (เหมือนระบบเดิม)
router.post('/receive', async (req, res) => {
  const itemId = parseId(req.body?.item_id);
  const position = req.body?.position ?? null;
  const qty = Number(req.body?.qty);
  const sessionId = req.body?.receipt_session_id ? parseId(req.body.receipt_session_id) : null;
  if (!itemId || !Number.isInteger(qty) || qty <= 0 || qty > MAX_QTY || (position !== null && typeof position !== 'string')) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  }
  if (req.body?.receipt_session_id && !sessionId) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    if (sessionId) {
      const [[session]] = await conn.execute(
        'SELECT id FROM receipt_sessions WHERE id = ? AND user_id = ?',
        [sessionId, req.user.id]
      );
      if (!session) {
        await conn.rollback();
        return res.status(403).json({ error: 'บิลนี้ไม่ใช่ของคุณ' });
      }
    }

    const [[item]] = await conn.execute(
      'SELECT id, description, has_sides, has_axles, stock_qty FROM stock_items WHERE id = ? AND is_active = 1 FOR UPDATE',
      [itemId]
    );
    if (!item) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบรายการนี้ในสต๊อกรวม' });
    }

    let before = item.stock_qty;
    let after;
    let total;
    if (position) {
      const [[row]] = await conn.execute(
        'SELECT qty FROM stock_item_positions WHERE item_id = ? AND position = ? FOR UPDATE',
        [itemId, position]
      );
      if (!row) {
        await conn.rollback();
        return res.status(400).json({ error: 'ตำแหน่งนี้ไม่ตรงกับรายการ' });
      }
      before = row.qty;
      after = before + qty;
      await conn.execute('UPDATE stock_item_positions SET qty = ? WHERE item_id = ? AND position = ?', [after, itemId, position]);
      const [[sum]] = await conn.execute(
        'SELECT COALESCE(SUM(qty), 0) AS total FROM stock_item_positions WHERE item_id = ?',
        [itemId]
      );
      total = Number(sum.total);
    } else {
      if (item.has_sides || item.has_axles) {
        await conn.rollback();
        return res.status(400).json({ error: 'รายการนี้แยกตำแหน่ง ต้องระบุตำแหน่ง' });
      }
      after = before + qty;
      total = after;
    }
    if (after > MAX_QTY) {
      await conn.rollback();
      return res.status(400).json({ error: 'จำนวนรวมสูงเกินไป' });
    }
    await conn.execute('UPDATE stock_items SET stock_qty = ? WHERE id = ?', [total, itemId]);
    const [mv] = await conn.execute(
      `INSERT INTO stock_item_movements (item_id, qty_before, qty_after, reason, position, receipt_session_id, user_id)
       VALUES (?, ?, ?, 'receive', ?, ?, ?)`,
      [itemId, before, after, position, sessionId, req.user.id]
    );
    await conn.commit();

    emitStockEvent('stock:item-updated', { entityType: 'stock_item', entityId: itemId, actorId: req.user.id });
    emitStockTxEvent('stock:tx-created', { txType: 'IN', entityType: 'stock_item', entityId: itemId, actorId: req.user.id });
    res.json({ success: true, movement_id: mv.insertId, qty_after: after, stock_qty: total });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('Error receiving stock item:', err);
    res.status(500).json({ error: 'ทำรายการไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// ยกเลิกรายการรับเข้า (สแกนผิด) — หักยอดคืนถ้าไม่ทำให้ติดลบ แถวเดิมไม่ลบ แค่ตีตรา voided_at
// และเพิ่มแถวปรับยอดเพื่อให้ประวัติของชิ้นนั้นเดินต่อเนื่อง
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
