const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { emitStockEvent } = require('../realtime');

// สต๊อกรวม: หมวดหมู่ + รหัส OEM + รายละเอียด + จำนวน (ดู stock_items ใน db/init.js)
const router = express.Router();
router.use(authenticate, requireRole('office'));

const MAX_QTY = 1000000;

function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// คืน integer ในช่วง min..MAX_QTY หรือ null ถ้าไม่ผ่าน
function parseQty(value, min = 0) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= MAX_QTY ? n : null;
}

function cleanText(value, maxLen) {
  return String(value ?? '').trim().slice(0, maxLen);
}

const ITEM_COLUMNS = `i.id, i.category_id, c.name AS category_name, i.oem_code, i.oem_code_right,
  i.description, i.has_sides, i.stock_qty, i.stock_left, i.stock_right, i.min_stock, i.updated_at`;

const SIDES = ['left', 'right'];
const SIDE_COLUMN = { left: 'stock_left', right: 'stock_right' };
const MIN_YEAR = 1950;
const MAX_YEAR = 2100;

// ตรวจรายการรุ่นรถที่ส่งมา — คืน { fitments } ที่ทำความสะอาดแล้ว หรือ { error }
function parseFitments(raw) {
  if (raw === undefined || raw === null) return { fitments: [] };
  if (!Array.isArray(raw) || raw.length > 100) return { error: 'ข้อมูลรุ่นรถไม่ถูกต้อง' };
  const seen = new Set();
  const fitments = [];
  for (const row of raw) {
    const brand = cleanText(row?.brand, 100);
    const model = cleanText(row?.model, 100);
    if (!brand || !model) return { error: 'รุ่นรถทุกแถวต้องมียี่ห้อและรุ่น' };
    const yearFrom = row.year_from === '' || row.year_from == null ? null : Number(row.year_from);
    const yearTo = row.year_to === '' || row.year_to == null ? null : Number(row.year_to);
    for (const y of [yearFrom, yearTo]) {
      if (y !== null && (!Number.isInteger(y) || y < MIN_YEAR || y > MAX_YEAR)) {
        return { error: `ปีรถต้องเป็นเลข ค.ศ. ระหว่าง ${MIN_YEAR}-${MAX_YEAR}` };
      }
    }
    if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
      return { error: 'ปีเริ่มต้องไม่มากกว่าปีสิ้นสุด' };
    }
    const key = `${brand.toLowerCase()}|${model.toLowerCase()}|${yearFrom}|${yearTo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fitments.push({ brand, model, year_from: yearFrom, year_to: yearTo });
  }
  return { fitments };
}

async function replaceFitments(conn, itemId, fitments) {
  await conn.execute('DELETE FROM stock_item_fitments WHERE item_id = ?', [itemId]);
  for (const f of fitments) {
    await conn.execute(
      'INSERT INTO stock_item_fitments (item_id, brand, model, year_from, year_to) VALUES (?, ?, ?, ?, ?)',
      [itemId, f.brand, f.model, f.year_from, f.year_to]
    );
  }
}

// ---------- หมวดหมู่ ----------
router.get('/categories', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT c.id, c.name, c.sort_order,
              COUNT(i.id) AS item_count
       FROM stock_categories c
       LEFT JOIN stock_items i ON i.category_id = c.id AND i.is_active = 1
       WHERE c.is_active = 1
       GROUP BY c.id, c.name, c.sort_order
       ORDER BY c.sort_order, c.id`
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
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextOrder FROM stock_categories'
    );
    const [result] = await pool.execute(
      'INSERT INTO stock_categories (name, sort_order) VALUES (?, ?)',
      [name, nextOrder]
    );
    emitStockEvent('stock:item-created', { entityType: 'stock_category', entityId: result.insertId, actorId: req.user.id });
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
      'UPDATE stock_categories SET name = ? WHERE id = ? AND is_active = 1',
      [name, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'ไม่พบหมวดหมู่' });
    emitStockEvent('stock:item-updated', { entityType: 'stock_category', entityId: id, actorId: req.user.id });
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
    const where = ['i.is_active = 1'];
    const params = [];
    const categoryId = parseId(req.query.category_id);
    if (categoryId) {
      where.push('i.category_id = ?');
      params.push(categoryId);
    }
    const q = cleanText(req.query.q, 100);
    if (q) {
      const like = `%${q}%`;
      where.push(`(i.oem_code LIKE ? OR i.oem_code_right LIKE ? OR i.description LIKE ?
        OR EXISTS (SELECT 1 FROM stock_item_fitments f WHERE f.item_id = i.id
                   AND CONCAT(f.brand, ' ', f.model) LIKE ?))`);
      params.push(like, like, like, like);
    }
    const [rows] = await pool.execute(
      `SELECT ${ITEM_COLUMNS}
       FROM stock_items i
       JOIN stock_categories c ON c.id = i.category_id
       WHERE ${where.join(' AND ')}
       ORDER BY c.sort_order, i.oem_code`,
      params
    );
    // รุ่นรถของทุกชิ้นที่ได้มา ดึงรอบเดียวแล้วแจกตาม item_id (ไม่ยิง query ต่อชิ้น)
    const fitmentsByItem = {};
    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
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
    res.json(rows.map((r) => ({ ...r, fitments: fitmentsByItem[r.id] || [] })));
  } catch (err) {
    console.error('Error loading stock items:', err);
    res.status(500).json({ error: 'โหลดรายการสต๊อกไม่สำเร็จ' });
  }
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  const categoryId = parseId(body.category_id);
  const oemCode = cleanText(body.oem_code, 100);
  const description = cleanText(body.description, 500);
  const hasSides = body.has_sides === true || body.has_sides === 1;
  const oemCodeRight = hasSides ? cleanText(body.oem_code_right, 100) || null : null;
  const minStock = body.min_stock === undefined ? 1 : parseQty(body.min_stock);
  // ของแยกซ้าย/ขวา: ยอดมาจาก stock_left/stock_right แล้ว stock_qty = ผลรวม
  const stockLeft = hasSides ? (body.stock_left === undefined ? 0 : parseQty(body.stock_left)) : 0;
  const stockRight = hasSides ? (body.stock_right === undefined ? 0 : parseQty(body.stock_right)) : 0;
  const stockQty = hasSides
    ? (stockLeft === null || stockRight === null ? null : stockLeft + stockRight)
    : (body.stock_qty === undefined ? 0 : parseQty(body.stock_qty));
  if (!categoryId || !oemCode) {
    return res.status(400).json({ error: 'กรุณาเลือกหมวดหมู่และกรอกรหัส OEM' });
  }
  if (stockQty === null || minStock === null) {
    return res.status(400).json({ error: 'จำนวนต้องเป็นเลขจำนวนเต็มตั้งแต่ 0 ขึ้นไป' });
  }
  const parsedFit = parseFitments(body.fitments);
  if (parsedFit.error) return res.status(400).json({ error: parsedFit.error });

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[cat]] = await conn.execute(
      'SELECT id FROM stock_categories WHERE id = ? AND is_active = 1',
      [categoryId]
    );
    if (!cat) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบหมวดหมู่' });
    }
    // รหัสเดิมที่เคยถูกซ่อน (is_active=0) → นำกลับมาใช้แทนการสร้างซ้ำ ไม่ชน UNIQUE
    const [[hidden]] = await conn.execute(
      'SELECT id FROM stock_items WHERE category_id = ? AND oem_code = ? AND is_active = 0 FOR UPDATE',
      [categoryId, oemCode]
    );
    let itemId;
    if (hidden) {
      itemId = hidden.id;
      await conn.execute(
        `UPDATE stock_items SET description = ?, has_sides = ?, oem_code_right = ?, stock_qty = ?,
                stock_left = ?, stock_right = ?, min_stock = ?, is_active = 1 WHERE id = ?`,
        [description, hasSides ? 1 : 0, oemCodeRight, stockQty, stockLeft, stockRight, minStock, itemId]
      );
    } else {
      const [result] = await conn.execute(
        `INSERT INTO stock_items (category_id, oem_code, oem_code_right, description, has_sides,
                                  stock_qty, stock_left, stock_right, min_stock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [categoryId, oemCode, oemCodeRight, description, hasSides ? 1 : 0, stockQty, stockLeft, stockRight, minStock]
      );
      itemId = result.insertId;
    }
    await replaceFitments(conn, itemId, parsedFit.fitments);
    const opening = hasSides
      ? [['left', stockLeft], ['right', stockRight]]
      : [[null, stockQty]];
    for (const [side, qty] of opening) {
      if (qty > 0) {
        await conn.execute(
          `INSERT INTO stock_item_movements (item_id, qty_before, qty_after, reason, side, user_id)
           VALUES (?, 0, ?, 'create', ?, ?)`,
          [itemId, qty, side, req.user.id]
        );
      }
    }
    await conn.commit();
    emitStockEvent('stock:item-created', { entityType: 'stock_item', entityId: itemId, actorId: req.user.id });
    res.status(201).json({ success: true, id: itemId });
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
  const oemCode = cleanText(body.oem_code, 100);
  const oemCodeRight = cleanText(body.oem_code_right, 100) || null;
  const description = cleanText(body.description, 500);
  const minStock = parseQty(body.min_stock);
  if (!id || !categoryId || !oemCode || minStock === null) {
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
      'SELECT id FROM stock_categories WHERE id = ? AND is_active = 1',
      [categoryId]
    );
    if (!cat) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบหมวดหมู่' });
    }
    const [[item]] = await conn.execute(
      'SELECT id, has_sides FROM stock_items WHERE id = ? AND is_active = 1 FOR UPDATE',
      [id]
    );
    if (!item) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบรายการ' });
    }
    // oem_code_right มีความหมายเฉพาะของแยกซ้าย/ขวา
    await conn.execute(
      `UPDATE stock_items SET category_id = ?, oem_code = ?, oem_code_right = ?, description = ?, min_stock = ?
       WHERE id = ?`,
      [categoryId, oemCode, item.has_sides ? oemCodeRight : null, description, minStock, id]
    );
    if (replaceFit) await replaceFitments(conn, id, parsedFit.fitments);
    await conn.commit();
    emitStockEvent('stock:item-updated', { entityType: 'stock_item', entityId: id, actorId: req.user.id });
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
// ของแยกซ้าย/ขวาต้องส่ง side ('left'|'right') ด้วย ของธรรมดาห้ามส่ง
// ล็อกแถวก่อนอ่านยอดเดิม กันสองเครื่องกดพร้อมกันแล้วยอดเพี้ยน ยอดติดลบไม่ได้
router.patch('/:id/qty', async (req, res) => {
  const id = parseId(req.params.id);
  const hasDelta = req.body?.delta !== undefined;
  const hasSetTo = req.body?.set_to !== undefined;
  const side = req.body?.side ?? null;
  if (!id || hasDelta === hasSetTo || (side !== null && !SIDES.includes(side))) {
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

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[item]] = await conn.execute(
      `SELECT id, has_sides, stock_qty, stock_left, stock_right
       FROM stock_items WHERE id = ? AND is_active = 1 FOR UPDATE`,
      [id]
    );
    if (!item) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบรายการ' });
    }
    if (Boolean(item.has_sides) !== (side !== null)) {
      await conn.rollback();
      return res.status(400).json({ error: item.has_sides ? 'รายการนี้แยกซ้าย/ขวา ต้องระบุข้าง' : 'รายการนี้ไม่แยกซ้าย/ขวา' });
    }
    const before = side ? item[SIDE_COLUMN[side]] : item.stock_qty;
    const after = hasDelta ? before + delta : setTo;
    if (after < 0 || after > MAX_QTY) {
      await conn.rollback();
      return res.status(400).json({ error: 'ยอดคงเหลือไม่สามารถติดลบได้' });
    }
    let total = item.stock_qty;
    if (after !== before) {
      if (side) {
        const left = side === 'left' ? after : item.stock_left;
        const right = side === 'right' ? after : item.stock_right;
        total = left + right;
        await conn.execute(
          'UPDATE stock_items SET stock_left = ?, stock_right = ?, stock_qty = ? WHERE id = ?',
          [left, right, total, id]
        );
      } else {
        total = after;
        await conn.execute('UPDATE stock_items SET stock_qty = ? WHERE id = ?', [after, id]);
      }
      await conn.execute(
        `INSERT INTO stock_item_movements (item_id, qty_before, qty_after, reason, side, note, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, before, after, hasDelta ? 'adjust' : 'set', side, note, req.user.id]
      );
    }
    await conn.commit();
    emitStockEvent('stock:item-updated', { entityType: 'stock_item', entityId: id, actorId: req.user.id });
    res.json({ success: true, stock_qty: total, side, qty: after });
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
      `SELECT m.id, m.qty_before, m.qty_after, m.reason, m.side, m.note, m.created_at,
              u.full_name AS user_name
       FROM stock_item_movements m
       JOIN users u ON u.id = m.user_id
       WHERE m.item_id = ?
       ORDER BY m.id DESC
       LIMIT 100`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error loading stock movements:', err);
    res.status(500).json({ error: 'โหลดประวัติไม่สำเร็จ' });
  }
});

// ซ่อนรายการ (ไม่ลบจริง — ประวัติยังอยู่ และเพิ่มรหัสเดิมกลับมาได้ภายหลัง)
router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  try {
    const [result] = await pool.execute(
      'UPDATE stock_items SET is_active = 0 WHERE id = ? AND is_active = 1',
      [id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'ไม่พบรายการ' });
    emitStockEvent('stock:item-deleted', { entityType: 'stock_item', entityId: id, actorId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    console.error('Error hiding stock item:', err);
    res.status(500).json({ error: 'ลบรายการไม่สำเร็จ' });
  }
});

module.exports = router;
