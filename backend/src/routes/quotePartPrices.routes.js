const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole, requireManager } = require('../middleware/auth');
const { saveDataUrlToFile, deleteUploadedFile } = require('../utils/photoStorage');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('office'));

// What a shop sees = the shared master book (catalog_parts) with the shop's own adjustments from
// quote_part_prices laid on top, plus the parts only this shop has. See db/catalogSchema.js.
//   id            number-as-string for a shop row, 'c<id>' for a master part the shop has not touched
//   source        'catalog' (master price) | 'custom' (shop's own price on a master part) | 'shop' (shop-only part)
const MASTER_ID = /^c(\d+)$/;

// Master parts (with the shop's adjustment, if any). `where` / `params` filter on the master columns.
function masterBranch(where, params, shopId) {
  return {
    sql: `SELECT c.brand, c.model, c.part_name,
                 COALESCE(CAST(q.id AS CHAR), CONCAT('c', c.id)) AS id,
                 IF(q.own_price = 1, q.description, c.description) AS description,
                 IF(q.own_price = 1, q.price, c.price) AS price,
                 q.image_data AS image_data,
                 IF(q.own_price = 1, q.needs_price, c.needs_price) AS needs_price,
                 IF(q.own_price = 1, COALESCE(q.category, c.category), c.category) AS category,
                 IF(q.own_price = 1, 'custom', 'catalog') AS source,
                 c.price AS catalog_price
          FROM catalog_parts c
          LEFT JOIN quote_part_prices q
            ON q.shop_id = ? AND q.brand = c.brand AND q.model = c.model AND q.part_name = c.part_name
          WHERE c.is_active = 1 AND (q.id IS NULL OR q.is_active = 1) ${where}`,
    params: [shopId, ...params],
  };
}

// Parts only this shop has (no master part with the same brand + model + part name, active or not)
function shopBranch(where, params, shopId) {
  return {
    sql: `SELECT q.brand, q.model, q.part_name, CAST(q.id AS CHAR) AS id, q.description, q.price, q.image_data,
                 q.needs_price, q.category, 'shop' AS source, NULL AS catalog_price
          FROM quote_part_prices q
          WHERE q.shop_id = ? AND q.is_active = 1
            AND NOT EXISTS (SELECT 1 FROM catalog_parts c
                            WHERE c.brand = q.brand AND c.model = q.model AND c.part_name = q.part_name) ${where}`,
    params: [shopId, ...params],
  };
}

// brand / model / search filters, written once for each branch's table alias
function filters(alias, { brand, model, search }) {
  const parts = [];
  const params = [];
  if (brand) { parts.push(`AND ${alias}.brand = ?`); params.push(brand); }
  if (model) { parts.push(`AND ${alias}.model = ?`); params.push(model); }
  if (search) {
    parts.push(`AND (${alias}.part_name LIKE ? OR ${alias}.description LIKE ? OR ${alias}.brand LIKE ? OR ${alias}.model LIKE ?)`);
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  return { where: parts.join(' '), params };
}

async function loadEffectiveParts(shopId, criteria, limit) {
  const m = filters('c', criteria);
  const s = filters('q', criteria);
  const a = masterBranch(m.where, m.params, shopId);
  const b = shopBranch(s.where, s.params, shopId);
  const [rows] = await pool.query(
    `${a.sql} UNION ALL ${b.sql} ORDER BY brand ASC, model ASC, part_name ASC LIMIT ${Number(limit) || 2000}`,
    [...a.params, ...b.params]
  );
  return rows;
}

// GET /quote-parts/brands — brands that have parts for this shop (step 1 of the quotation picker)
router.get('/brands', async (req, res) => {
  try {
    // Master brands come from the (small) vehicle catalogue and are probed in the parts index, and the shop
    // layer is read from the (shop_id, brand, ...) index alone: scanning every part row takes ~0.3 s at 70k rows.
    // A hidden shop row can add a brand with nothing visible under it; that is harmless.
    const [rows] = await pool.query(
      `SELECT v.brand FROM (SELECT DISTINCT brand FROM vehicle_models WHERE status = 'approved') v
       WHERE EXISTS (SELECT 1 FROM catalog_parts c WHERE c.brand = v.brand AND c.is_active = 1)
       UNION
       SELECT DISTINCT brand FROM quote_part_prices WHERE shop_id = ?
       ORDER BY brand ASC`,
      [req.shopId]
    );
    res.json({ success: true, data: rows.map((r) => r.brand) });
  } catch (err) {
    console.error('Error loading quote part brands:', err);
    res.status(500).json({ error: 'โหลดรายการยี่ห้อไม่สำเร็จ' });
  }
});

// GET /quote-parts/models?brand=Honda — models of that brand (step 2)
router.get('/models', async (req, res) => {
  const { brand } = req.query;
  if (!brand) return res.status(400).json({ error: 'กรุณาระบุยี่ห้อ' });
  try {
    const [rows] = await pool.query(
      `SELECT model FROM catalog_parts WHERE is_active = 1 AND brand = ?
       UNION
       SELECT model FROM quote_part_prices WHERE shop_id = ? AND brand = ?
       ORDER BY model ASC`,
      [brand, req.shopId, brand]
    );
    res.json({ success: true, data: rows.map((r) => r.model) });
  } catch (err) {
    console.error('Error loading quote part models:', err);
    res.status(500).json({ error: 'โหลดรายการรุ่นรถไม่สำเร็จ' });
  }
});

// GET /quote-parts/parts?brand=Honda&model=BRIO — part cards with price for the quotation picker
router.get('/parts', async (req, res) => {
  const { brand, model } = req.query;
  if (!brand || !model) return res.status(400).json({ error: 'กรุณาระบุยี่ห้อและรุ่นรถ' });
  try {
    res.json({ success: true, data: await loadEffectiveParts(req.shopId, { brand, model }, 2000) });
  } catch (err) {
    console.error('Error loading quote parts:', err);
    res.status(500).json({ error: 'โหลดรายการอะไหล่ไม่สำเร็จ' });
  }
});

// GET / — list for the management page (searchable / filterable)
router.get('/', async (req, res) => {
  const { search = '', brand = '', model = '' } = req.query;
  try {
    res.json({ success: true, data: await loadEffectiveParts(req.shopId, { brand, model, search }, 2000) });
  } catch (err) {
    console.error('Error loading quote part prices:', err);
    res.status(500).json({ error: 'โหลดรายการราคาอะไหล่ไม่สำเร็จ' });
  }
});

// POST / — add a part this shop prices itself
router.post('/', requireManager, async (req, res) => {
  const { brand, model, part_name, description, price, image_data, category } = req.body;
  if (!brand?.trim() || !model?.trim() || !part_name?.trim()) {
    return res.status(400).json({ error: 'กรุณากรอกยี่ห้อ รุ่นรถ และชื่ออะไหล่ให้ครบถ้วน' });
  }
  try {
    const imageUrl = saveDataUrlToFile(image_data, 'quote-parts');
    const [result] = await pool.execute(
      `INSERT INTO quote_part_prices (shop_id, brand, model, part_name, description, price, image_data, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.shopId, brand.trim(), model.trim(), part_name.trim(), description?.trim() || null, Number(price) || 0, imageUrl || null, category?.trim() || null]
    );
    res.status(201).json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'มีรายการอะไหล่นี้ในรุ่นรถนี้อยู่แล้ว' });
    console.error('Error creating quote part price:', err);
    res.status(500).json({ error: 'เพิ่มรายการราคาอะไหล่ไม่สำเร็จ' });
  }
});

// The master part a shop row is attached to, if any
async function masterPartFor(brand, model, partName) {
  const [[row]] = await pool.query(
    'SELECT id, category FROM catalog_parts WHERE brand = ? AND model = ? AND part_name = ?',
    [brand, model, partName]
  );
  return row || null;
}

// PUT /:id — edit a part. A master part ('c<id>' or a shop row attached to one) keeps its brand / model /
// name; saving it stores this shop's own price on top of the master book.
router.put('/:id', requireManager, async (req, res) => {
  const { description, price, image_data, is_active } = req.body;
  let { brand, model, part_name } = req.body;
  if (!brand?.trim() || !model?.trim() || !part_name?.trim()) {
    return res.status(400).json({ error: 'กรุณากรอกยี่ห้อ รุ่นรถ และชื่ออะไหล่ให้ครบถ้วน' });
  }
  try {
    const imageUrl = saveDataUrlToFile(image_data, 'quote-parts');
    const masterMatch = MASTER_ID.exec(req.params.id);
    let rowId = null;
    let oldImage = null;
    let master = null;
    if (masterMatch) {
      [[master]] = await pool.query('SELECT id, brand, model, part_name, category FROM catalog_parts WHERE id = ?', [masterMatch[1]]);
      if (!master) return res.status(404).json({ error: 'ไม่พบรายการ' });
      ({ brand, model, part_name } = master);
      const [[mine]] = await pool.query(
        'SELECT id, image_data FROM quote_part_prices WHERE shop_id = ? AND brand = ? AND model = ? AND part_name = ?',
        [req.shopId, brand, model, part_name]
      );
      if (mine) { rowId = mine.id; oldImage = mine.image_data; }
    } else {
      const [[existing]] = await pool.query(
        'SELECT id, brand, model, part_name, image_data FROM quote_part_prices WHERE id = ? AND shop_id = ?',
        [req.params.id, req.shopId]
      );
      if (!existing) return res.status(404).json({ error: 'ไม่พบรายการ' });
      rowId = existing.id;
      oldImage = existing.image_data;
      master = await masterPartFor(existing.brand, existing.model, existing.part_name);
      if (master) ({ brand, model, part_name } = existing);
    }
    // saving through this page = the shop confirmed the price, so "needs a price" is cleared
    const values = [
      brand.trim(), model.trim(), part_name.trim(), description?.trim() || null, Number(price) || 0, imageUrl || null,
      is_active === undefined ? 1 : (is_active ? 1 : 0), master?.category || null,
    ];
    if (rowId) {
      await pool.execute(
        `UPDATE quote_part_prices
         SET brand = ?, model = ?, part_name = ?, description = ?, price = ?, image_data = ?, is_active = ?,
             needs_price = 0, own_price = 1
         WHERE id = ? AND shop_id = ?`,
        [...values.slice(0, 7), rowId, req.shopId]
      );
    } else {
      await pool.execute(
        `INSERT INTO quote_part_prices (shop_id, brand, model, part_name, description, price, image_data, is_active, category, needs_price, own_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`,
        [req.shopId, ...values]
      );
    }
    // a replaced / removed picture: drop the old file so it is not left behind
    if (oldImage && oldImage !== imageUrl) deleteUploadedFile(oldImage);
    res.json({ success: true, message: 'แก้ไขรายการสำเร็จ' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'มีรายการอะไหล่นี้ในรุ่นรถนี้อยู่แล้ว' });
    console.error('Error updating quote part price:', err);
    res.status(500).json({ error: 'แก้ไขรายการไม่สำเร็จ' });
  }
});

// POST /:id/reset — drop this shop's own price on a master part and go back to the master price
router.post('/:id/reset', requireManager, async (req, res) => {
  try {
    const [[row]] = await pool.query(
      'SELECT id, brand, model, part_name, image_data FROM quote_part_prices WHERE id = ? AND shop_id = ?',
      [req.params.id, req.shopId]
    );
    if (!row || !(await masterPartFor(row.brand, row.model, row.part_name))) {
      return res.status(404).json({ error: 'ไม่พบรายการที่ปรับราคาเอง' });
    }
    if (row.image_data) {
      await pool.execute('UPDATE quote_part_prices SET own_price = 0, is_active = 1 WHERE id = ? AND shop_id = ?', [row.id, req.shopId]);
    } else {
      await pool.execute('DELETE FROM quote_part_prices WHERE id = ? AND shop_id = ?', [row.id, req.shopId]);
    }
    res.json({ success: true, message: 'กลับไปใช้ราคากลางแล้ว' });
  } catch (err) {
    console.error('Error resetting quote part price:', err);
    res.status(500).json({ error: 'กลับไปใช้ราคากลางไม่สำเร็จ' });
  }
});

// DELETE /:id — a shop-only part is deleted; a master part is only hidden for this shop (the master book
// itself is edited by the administrator)
router.delete('/:id', requireManager, async (req, res) => {
  try {
    const masterMatch = MASTER_ID.exec(req.params.id);
    if (masterMatch) {
      const [[master]] = await pool.query('SELECT brand, model, part_name, price, category FROM catalog_parts WHERE id = ?', [masterMatch[1]]);
      if (!master) return res.status(404).json({ error: 'ไม่พบรายการ' });
      await pool.execute(
        `INSERT INTO quote_part_prices (shop_id, brand, model, part_name, price, category, is_active, own_price)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0)
         ON DUPLICATE KEY UPDATE is_active = 0`,
        [req.shopId, master.brand, master.model, master.part_name, master.price, master.category]
      );
      return res.json({ success: true, message: 'ซ่อนรายการนี้จากร้านแล้ว' });
    }
    const [[existing]] = await pool.query(
      'SELECT id, brand, model, part_name, image_data FROM quote_part_prices WHERE id = ? AND shop_id = ?',
      [req.params.id, req.shopId]
    );
    if (!existing) return res.status(404).json({ error: 'ไม่พบรายการ' });
    if (await masterPartFor(existing.brand, existing.model, existing.part_name)) {
      await pool.execute('UPDATE quote_part_prices SET is_active = 0, own_price = 0, image_data = NULL WHERE id = ? AND shop_id = ?', [existing.id, req.shopId]);
    } else {
      await pool.execute('DELETE FROM quote_part_prices WHERE id = ? AND shop_id = ?', [existing.id, req.shopId]);
    }
    deleteUploadedFile(existing.image_data);
    res.json({ success: true, message: 'ลบรายการสำเร็จ' });
  } catch (err) {
    console.error('Error deleting quote part price:', err);
    res.status(500).json({ error: 'ลบรายการไม่สำเร็จ' });
  }
});

module.exports = router;
