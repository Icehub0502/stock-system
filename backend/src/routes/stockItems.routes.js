const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole, requireManager } = require('../middleware/auth');
const { emitStockEvent } = require('../realtime');
const { positionsFor } = require('../utils/stockPositions');
const {
  MAX_QTY, parseQty, cleanText, parseCodes, primaryCode, parseFitments, replaceFitments,
  parseNewStockItem, insertStockItem,
} = require('../utils/stockItemCreate');
const { suggestPairs, pairItems, unpairItem } = require('../utils/stockPair');

// สต๊อกรวม: หมวดหมู่ + รหัส OEM + รายละเอียด + จำนวน (ดู stock_items ใน db/init.js)
const router = express.Router();
router.use(authenticate, requireRole('office'));

function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// paired_from_id: the hidden item this one was joined with, which is what lets the join be undone
// tenant-ok: r is reached through i, and every query using this filters i by shop
const ITEM_COLUMNS = `i.id, i.category_id, c.name AS category_name, i.oem_code,
  i.description, i.has_sides, i.has_axles, i.has_levels, i.stock_qty, i.min_stock, i.updated_at,
  (SELECT MAX(r.id) FROM stock_items r WHERE r.merged_into_id = i.id) AS paired_from_id`;

// ---------- หมวดหมู่ ----------
router.get('/categories', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT c.id, c.name, c.sort_order,
              COUNT(i.id) AS item_count
       FROM stock_categories c
       LEFT JOIN stock_items i ON i.category_id = c.id AND i.is_active = 1
       WHERE c.shop_id = ? AND c.is_active = 1
       GROUP BY c.id, c.name, c.sort_order
       ORDER BY c.sort_order, c.id`,
      [req.shopId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error loading stock categories:', err);
    res.status(500).json({ error: 'โหลดหมวดหมู่ไม่สำเร็จ' });
  }
});

router.post('/categories', async (req, res) => {
  const name = cleanText(req.body?.name, 100);
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อหมวดหมู่' });
  try {
    const [[{ nextOrder }]] = await pool.execute(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrder FROM stock_categories WHERE shop_id = ?',
      [req.shopId]
    );
    const [result] = await pool.execute(
      'INSERT INTO stock_categories (shop_id, name, sort_order) VALUES (?, ?, ?)',
      [req.shopId, name, nextOrder]
    );
    emitStockEvent('stock:item-created', { shopId: req.shopId, entityType: 'stock_category', entityId: result.insertId, actorId: req.user.id });
    res.status(201).json({ id: result.insertId, name, sort_order: nextOrder, item_count: 0 });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'มีหมวดหมู่ชื่อนี้อยู่แล้ว' });
    }
    console.error('Error creating stock category:', err);
    res.status(500).json({ error: 'เพิ่มหมวดหมู่ไม่สำเร็จ' });
  }
});

router.put('/categories/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const name = cleanText(req.body?.name, 100);
  if (!id || !name) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  try {
    const [result] = await pool.execute(
      'UPDATE stock_categories SET name = ? WHERE id = ? AND shop_id = ? AND is_active = 1',
      [name, id, req.shopId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'ไม่พบหมวดหมู่' });
    emitStockEvent('stock:item-updated', { shopId: req.shopId, entityType: 'stock_category', entityId: id, actorId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'มีหมวดหมู่ชื่อนี้อยู่แล้ว' });
    }
    console.error('Error renaming stock category:', err);
    res.status(500).json({ error: 'แก้ไขหมวดหมู่ไม่สำเร็จ' });
  }
});

// ---------- รายการสินค้า ----------
// ?category_id=  กรองหมวด, ?q= ค้นรหัส OEM/รายละเอียด/ยี่ห้อ-รุ่นรถ (ข้ามหมวดถ้าไม่ส่ง category_id)
router.get('/', async (req, res) => {
  try {
    const where = ['i.shop_id = ?', 'i.is_active = 1'];
    const params = [req.shopId];
    const categoryId = parseId(req.query.category_id);
    if (categoryId) {
      where.push('i.category_id = ?');
      params.push(categoryId);
    }
    const q = cleanText(req.query.q, 100);
    if (q) {
      const like = `%${q}%`;
      where.push(`(i.oem_code LIKE ? OR i.description LIKE ?
        OR EXISTS (SELECT 1 FROM stock_item_positions p WHERE p.item_id = i.id AND p.oem_code LIKE ?)
        OR EXISTS (SELECT 1 FROM stock_item_fitments f WHERE f.item_id = i.id
                   AND CONCAT(f.brand, ' ', f.model) LIKE ?))`);
      params.push(like, like, like, like);
    }
    // tenant-ok: where[0] is "i.shop_id = ?"
    const [rows] = await pool.execute(
      `SELECT ${ITEM_COLUMNS}
       FROM stock_items i
       JOIN stock_categories c ON c.id = i.category_id
       WHERE ${where.join(' AND ')}
       ORDER BY c.sort_order, i.oem_code`,
      params
    );
    // รุ่นรถ + ยอดแต่ละตำแหน่งของทุกชิ้นที่ได้มา ดึงรอบเดียวแล้วแจกตาม item_id (ไม่ยิง query ต่อชิ้น)
    const fitmentsByItem = {};
    const positionsByItem = {};
    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      const [posRows] = await pool.query(
        'SELECT item_id, position, qty, oem_code FROM stock_item_positions WHERE item_id IN (?)',
        [ids]
      );
      posRows.forEach((p) => {
        (positionsByItem[p.item_id] = positionsByItem[p.item_id] || {})[p.position] = p;
      });
      const [fitRows] = await pool.query(
        `SELECT item_id, brand, model, year_from, year_to
         FROM stock_item_fitments WHERE item_id IN (?) ORDER BY brand, model, year_from`,
        [ids]
      );
      fitRows.forEach((f) => {
        (fitmentsByItem[f.item_id] = fitmentsByItem[f.item_id] || []).push({
          brand: f.brand, model: f.model, year_from: f.year_from, year_to: f.year_to,
        });
      });
    }
    res.json(rows.map((r) => ({
      ...r,
      // เรียงตามลำดับมาตรฐาน (หน้าซ้าย หน้าขวา หลังซ้าย หลังขวา) ตำแหน่งที่ยังไม่มีแถว = 0
      positions: positionsFor(r.has_sides, r.has_axles, r.has_levels).map((position) => {
        const row = (positionsByItem[r.id] || {})[position];
        return { position, qty: row ? row.qty : 0, oem_code: row ? row.oem_code : null };
      }),
      fitments: fitmentsByItem[r.id] || [],
    })));
  } catch (err) {
    console.error('Error loading stock items:', err);
    res.status(500).json({ error: 'โหลดรายการสต๊อกไม่สำเร็จ' });
  }
});

router.post('/', async (req, res) => {
  const parsed = parseNewStockItem(req.body || {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const created = await insertStockItem(conn, { shopId: req.shopId, userId: req.user.id, item: parsed.item });
    if (created.error) {
      await conn.rollback();
      return res.status(created.status).json({ error: created.error });
    }
    await conn.commit();
    emitStockEvent('stock:item-created', { shopId: req.shopId, entityType: 'stock_item', entityId: created.itemId, actorId: req.user.id });
    res.status(201).json({ success: true, id: created.itemId });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'รหัส OEM นี้มีอยู่ในหมวดนี้แล้ว' });
    }
    console.error('Error creating stock item:', err);
    res.status(500).json({ error: 'เพิ่มรายการไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// แก้ข้อมูลทั่วไป (หมวด/รหัส/รายละเอียด/ขั้นต่ำ/รุ่นรถ) — จำนวนแก้ผ่าน /:id/qty เท่านั้น
// เพื่อให้ทุกการเปลี่ยนยอดมีประวัติ ส่ง fitments มา = แทนที่รายการรุ่นรถทั้งชุด
router.put('/:id', async (req, res) => {
  const body = req.body || {};
  const id = parseId(req.params.id);
  const categoryId = parseId(body.category_id);
  const description = cleanText(body.description, 500);
  const minStock = parseQty(body.min_stock);
  if (!id || !categoryId || minStock === null) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  }
  const replaceFit = body.fitments !== undefined;
  const parsedFit = parseFitments(body.fitments);
  if (parsedFit.error) return res.status(400).json({ error: parsedFit.error });

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[cat]] = await conn.execute(
      'SELECT id FROM stock_categories WHERE id = ? AND shop_id = ? AND is_active = 1',
      [categoryId, req.shopId]
    );
    if (!cat) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบหมวดหมู่' });
    }
    const [[item]] = await conn.execute(
      'SELECT id, has_sides, has_axles, has_levels FROM stock_items WHERE id = ? AND shop_id = ? AND is_active = 1 FOR UPDATE',
      [id, req.shopId]
    );
    if (!item) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบรายการ' });
    }
    // ของแยกตำแหน่ง: รหัสอยู่ที่ตำแหน่งละรหัส (รหัสหลักคำนวณจากรหัสแรกที่มีค่า)
    // ของธรรมดา: ใช้ oem_code ตรง ๆ
    const itemPositions = positionsFor(item.has_sides, item.has_axles, item.has_levels);
    const codes = parseCodes(body.codes, itemPositions);
    const oemCode = primaryCode(itemPositions, codes, cleanText(body.oem_code, 100));
    if (!oemCode) {
      await conn.rollback();
      return res.status(400).json({ error: 'กรุณากรอกรหัส OEM (อย่างน้อยหนึ่งตำแหน่ง)' });
    }
    await conn.execute(
      `UPDATE stock_items SET category_id = ?, oem_code = ?, oem_code_right = NULL, description = ?, min_stock = ?
       WHERE id = ? AND shop_id = ?`,
      [categoryId, oemCode, description, minStock, id, req.shopId]
    );
    for (const position of itemPositions) {
      await conn.execute(
        `INSERT INTO stock_item_positions (item_id, position, qty, oem_code) VALUES (?, ?, 0, ?)
         ON DUPLICATE KEY UPDATE oem_code = VALUES(oem_code)`,
        [id, position, codes[position]]
      );
    }
    if (replaceFit) await replaceFitments(conn, id, parsedFit.fitments);
    await conn.commit();
    emitStockEvent('stock:item-updated', { shopId: req.shopId, entityType: 'stock_item', entityId: id, actorId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'รหัส OEM นี้มีอยู่ในหมวดนี้แล้ว' });
    }
    console.error('Error updating stock item:', err);
    res.status(500).json({ error: 'แก้ไขรายการไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// ปรับจำนวน: ส่ง { delta } (เพิ่ม/ลด) หรือ { set_to } (ตั้งยอดตรง ๆ) อย่างใดอย่างหนึ่ง
// ของแยกตำแหน่งต้องส่ง position (เช่น 'left', 'front_right') ที่ตรงกับชิ้นนั้น ของธรรมดาห้ามส่ง
// ล็อกแถวก่อนอ่านยอดเดิม กันสองเครื่องกดพร้อมกันแล้วยอดเพี้ยน ยอดติดลบไม่ได้
router.patch('/:id/qty', async (req, res) => {
  const id = parseId(req.params.id);
  const hasDelta = req.body?.delta !== undefined;
  const hasSetTo = req.body?.set_to !== undefined;
  const position = req.body?.position ?? null;
  if (!id || hasDelta === hasSetTo || (position !== null && typeof position !== 'string')) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  }
  const delta = hasDelta ? Number(req.body.delta) : null;
  const setTo = hasSetTo ? parseQty(req.body.set_to) : null;
  if (hasDelta && (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_QTY)) {
    return res.status(400).json({ error: 'จำนวนที่ปรับไม่ถูกต้อง' });
  }
  if (hasSetTo && setTo === null) {
    return res.status(400).json({ error: 'ยอดต้องเป็นเลขจำนวนเต็มตั้งแต่ 0 ขึ้นไป' });
  }
  const note = cleanText(req.body?.note, 255) || null;
  // the quantity the editing form showed: if it changed meanwhile (a scan or deduction from another device),
  // setting a fixed number would silently undo that change
  const hasExpected = req.body?.expected_qty !== undefined;
  const expected = hasExpected ? parseQty(req.body.expected_qty) : null;
  if (hasExpected && expected === null) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[item]] = await conn.execute(
      `SELECT id, has_sides, has_axles, has_levels, stock_qty
       FROM stock_items WHERE id = ? AND shop_id = ? AND is_active = 1 FOR UPDATE`,
      [id, req.shopId]
    );
    if (!item) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบรายการ' });
    }
    const validPositions = positionsFor(item.has_sides, item.has_axles, item.has_levels);
    if (validPositions.length > 0 ? !validPositions.includes(position) : position !== null) {
      await conn.rollback();
      return res.status(400).json({
        error: validPositions.length > 0 ? 'รายการนี้แยกตำแหน่ง ต้องระบุตำแหน่งให้ถูกต้อง' : 'รายการนี้ไม่แยกตำแหน่ง',
      });
    }
    let before = item.stock_qty;
    if (position) {
      const [[row]] = await conn.execute(
        'SELECT qty FROM stock_item_positions WHERE item_id = ? AND position = ? FOR UPDATE',
        [id, position]
      );
      before = row ? row.qty : 0;
    }
    if (hasExpected && before !== expected) {
      await conn.rollback();
      return res.status(409).json({
        error: `ยอดของรายการนี้เพิ่งเปลี่ยนเป็น ${before} (มีการรับเข้า/ตัดสต๊อกระหว่างที่แก้) — ปิดแล้วเปิดรายการใหม่ก่อนแก้ยอด`,
      });
    }
    const after = hasDelta ? before + delta : setTo;
    if (after < 0 || after > MAX_QTY) {
      await conn.rollback();
      return res.status(400).json({ error: 'ยอดคงเหลือไม่สามารถติดลบได้' });
    }
    let total = item.stock_qty;
    if (after !== before) {
      if (position) {
        await conn.execute(
          `INSERT INTO stock_item_positions (item_id, position, qty) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE qty = VALUES(qty)`,
          [id, position, after]
        );
        const [[sum]] = await conn.execute(
          'SELECT COALESCE(SUM(qty), 0) AS total FROM stock_item_positions WHERE item_id = ?',
          [id]
        );
        total = Number(sum.total);
        await conn.execute('UPDATE stock_items SET stock_qty = ? WHERE id = ? AND shop_id = ?', [total, id, req.shopId]);
      } else {
        total = after;
        await conn.execute('UPDATE stock_items SET stock_qty = ? WHERE id = ? AND shop_id = ?', [after, id, req.shopId]);
      }
      await conn.execute(
        `INSERT INTO stock_item_movements (item_id, qty_before, qty_after, reason, position, note, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, before, after, hasDelta ? 'adjust' : 'set', position, note, req.user.id]
      );
    }
    await conn.commit();
    emitStockEvent('stock:item-updated', { shopId: req.shopId, entityType: 'stock_item', entityId: id, actorId: req.user.id });
    res.json({ success: true, stock_qty: total, position, qty: after });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('Error adjusting stock qty:', err);
    res.status(500).json({ error: 'ปรับจำนวนไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

router.get('/:id/movements', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  try {
    const [rows] = await pool.execute(
      `SELECT m.id, m.qty_before, m.qty_after, m.reason, m.position, m.note, m.created_at,
              u.full_name AS user_name
       FROM stock_item_movements m
       JOIN users u ON u.id = m.user_id
       JOIN stock_items si ON si.id = m.item_id
       WHERE m.item_id = ? AND si.shop_id = ?
       ORDER BY m.id DESC
       LIMIT 100`,
      [id, req.shopId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error loading stock movements:', err);
    res.status(500).json({ error: 'โหลดประวัติไม่สำเร็จ' });
  }
});

// ซ่อนรายการ (ไม่ลบจริง — ประวัติยังอยู่ และเพิ่มรหัสเดิมกลับมาได้ภายหลัง)
// ---------- join left and right that were entered as two items ----------

// Plain items that look like two sides of one part
router.get('/pair-suggestions', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT i.id, i.category_id, c.name AS category_name, i.oem_code, i.description, i.stock_qty
       FROM stock_items i JOIN stock_categories c ON c.id = i.category_id
       WHERE i.shop_id = ? AND i.is_active = 1 AND i.has_sides = 0 AND i.has_axles = 0 AND i.has_levels = 0
       ORDER BY i.id`,
      [req.shopId]
    );
    res.json({ success: true, data: suggestPairs(rows).slice(0, 100) });
  } catch (err) {
    console.error('Error suggesting stock pairs:', err);
    res.status(500).json({ error: 'โหลดรายการแนะนำไม่สำเร็จ' });
  }
});

router.post('/pairs', async (req, res) => {
  const leftId = parseId(req.body?.left_id);
  const rightId = parseId(req.body?.right_id);
  if (!leftId || !rightId) return res.status(400).json({ error: 'กรุณาเลือกทั้งข้างซ้ายและข้างขวา' });
  const description = cleanText(req.body?.description, 500);
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const paired = await pairItems(conn, { leftId, rightId, description, shopId: req.shopId });
    if (paired.error) {
      await conn.rollback();
      return res.status(paired.status).json({ error: paired.error });
    }
    await conn.commit();
    emitStockEvent('stock:item-updated', { shopId: req.shopId, entityType: 'stock_item', entityId: paired.itemId, actorId: req.user.id });
    emitStockEvent('stock:item-deleted', { shopId: req.shopId, entityType: 'stock_item', entityId: paired.hiddenId, actorId: req.user.id });
    res.json({ success: true, item_id: paired.itemId });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('Error pairing stock items:', err);
    res.status(500).json({ error: 'จับคู่ไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

router.post('/:id/unpair', async (req, res) => {
  const itemId = parseId(req.params.id);
  if (!itemId) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const result = await unpairItem(conn, { itemId, shopId: req.shopId });
    if (result.error) {
      await conn.rollback();
      return res.status(result.status).json({ error: result.error });
    }
    await conn.commit();
    emitStockEvent('stock:item-updated', { shopId: req.shopId, entityType: 'stock_item', entityId: result.itemId, actorId: req.user.id });
    emitStockEvent('stock:item-updated', { shopId: req.shopId, entityType: 'stock_item', entityId: result.restoredId, actorId: req.user.id });
    res.json({ success: true, restored_id: result.restoredId });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'รหัสของอีกข้างถูกใช้กับรายการอื่นในหมวดนี้แล้ว' });
    console.error('Error unpairing stock item:', err);
    res.status(500).json({ error: 'แยกคู่ไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

router.delete('/:id', requireManager, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  try {
    const [result] = await pool.execute(
      'UPDATE stock_items SET is_active = 0 WHERE id = ? AND shop_id = ? AND is_active = 1',
      [id, req.shopId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'ไม่พบรายการ' });
    emitStockEvent('stock:item-deleted', { shopId: req.shopId, entityType: 'stock_item', entityId: id, actorId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    console.error('Error hiding stock item:', err);
    res.status(500).json({ error: 'ลบรายการไม่สำเร็จ' });
  }
});

module.exports = router;
