// Shared parts catalogue administration (role dev only), mounted under /api/dev/catalog:
//   - vehicle models: add / rename, and the review queue for models typed in by shop staff (approve / merge / reject)
//   - master parts and prices ("สมุดกลาง"); a part is hidden (is_active = 0), never deleted
// A rename has to change the master book and every shop's adjustment rows together (they are matched by
// brand + model + part name), so it runs in one transaction. See db/catalogSchema.js.
const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireDev } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { normalizeName } = require('../utils/normalizeName');

const router = express.Router();
router.use(authenticate, requireDev);

function serverError(res, err, message) {
  console.error(err);
  return res.status(500).json({ error: message });
}

// trimmed string within a length, or null when empty / too long
function cleanText(value, max) {
  const text = value === undefined || value === null ? '' : String(value).trim();
  return text && text.length <= max ? text : null;
}

// the model text used in prices: "Camry (2012-2018)" or just "Camry"
function modelLabel(model, yearRange) {
  return yearRange ? `${model} (${yearRange})` : model;
}

// run `work(conn)` in a transaction; resolves to its result, rolls back on any error
async function inTransaction(work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ── overview ────────────────────────────────────────────────────────────────

router.get('/catalog/summary', async (req, res) => {
  try {
    const [[row]] = await pool.query(
      `SELECT (SELECT COUNT(DISTINCT brand) FROM vehicle_models WHERE status = 'approved') AS brands,
              (SELECT COUNT(*) FROM vehicle_models WHERE status = 'approved') AS models,
              (SELECT COUNT(*) FROM catalog_parts WHERE is_active = 1) AS parts,
              (SELECT COUNT(*) FROM vehicle_models WHERE status = 'pending') AS pending`
    );
    res.json({ success: true, data: row });
  } catch (err) {
    serverError(res, err, 'โหลดสรุปสมุดกลางไม่สำเร็จ');
  }
});

// ── vehicle models ──────────────────────────────────────────────────────────

router.get('/catalog/models', async (req, res) => {
  const brand = cleanText(req.query.brand, 100);
  const search = cleanText(req.query.search, 100);
  try {
    let sql = "SELECT id, brand, model, year_range FROM vehicle_models WHERE status = 'approved'";
    const params = [];
    if (brand) { sql += ' AND brand = ?'; params.push(brand); }
    if (search) { sql += ' AND (brand LIKE ? OR model LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    sql += ' ORDER BY brand ASC, id ASC LIMIT 1000';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows.map((r) => ({ ...r, label: modelLabel(r.model, r.year_range) })) });
  } catch (err) {
    serverError(res, err, 'โหลดรุ่นรถไม่สำเร็จ');
  }
});

router.get('/catalog/brands', async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT brand, MIN(id) AS first_id FROM vehicle_models WHERE status = 'approved' GROUP BY brand ORDER BY first_id ASC"
    );
    res.json({ success: true, data: rows.map((r) => r.brand) });
  } catch (err) {
    serverError(res, err, 'โหลดยี่ห้อไม่สำเร็จ');
  }
});

// Another approved model of the same brand that has the same name once case / spaces / punctuation are ignored
async function findDuplicateModel(brand, model, yearRange, exceptId = 0) {
  const [rows] = await pool.query(
    "SELECT id, model, year_range FROM vehicle_models WHERE brand = ? AND status = 'approved' AND id <> ?",
    [brand, exceptId]
  );
  const wanted = normalizeName(modelLabel(model, yearRange));
  return rows.find((r) => normalizeName(modelLabel(r.model, r.year_range)) === wanted) || null;
}

router.post('/catalog/models', async (req, res) => {
  const brand = cleanText(req.body?.brand, 100);
  const model = cleanText(req.body?.model, 100);
  const yearRange = cleanText(req.body?.year_range, 50);
  if (!brand || !model) return res.status(400).json({ error: 'กรุณากรอกยี่ห้อและรุ่นรถ' });
  try {
    if (await findDuplicateModel(brand, model, yearRange)) {
      return res.status(409).json({ error: 'มีรุ่นนี้ในสมุดอยู่แล้ว' });
    }
    const [result] = await pool.execute(
      "INSERT INTO vehicle_models (brand, model, year_range, status) VALUES (?, ?, ?, 'approved')",
      [brand, model, yearRange]
    );
    await logAudit(req, 'catalog_add_model', { detail: { brand, model, year_range: yearRange } });
    res.status(201).json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    serverError(res, err, 'เพิ่มรุ่นรถไม่สำเร็จ');
  }
});

// Rename a model (brand, name, year range). Every price row that uses the old brand + label follows.
router.patch('/catalog/models/:id', async (req, res) => {
  try {
    const [[current]] = await pool.query(
      "SELECT id, brand, model, year_range FROM vehicle_models WHERE id = ? AND status = 'approved'",
      [req.params.id]
    );
    if (!current) return res.status(404).json({ error: 'ไม่พบรุ่นรถ' });
    const brand = req.body?.brand === undefined ? current.brand : cleanText(req.body.brand, 100);
    const model = req.body?.model === undefined ? current.model : cleanText(req.body.model, 100);
    const yearRange = req.body?.year_range === undefined ? current.year_range : cleanText(req.body.year_range, 50);
    if (!brand || !model) return res.status(400).json({ error: 'กรุณากรอกยี่ห้อและรุ่นรถ' });
    if (await findDuplicateModel(brand, model, yearRange, current.id)) {
      return res.status(409).json({ error: 'มีรุ่นนี้ในสมุดอยู่แล้ว' });
    }
    const oldLabel = modelLabel(current.model, current.year_range);
    const newLabel = modelLabel(model, yearRange);
    if (newLabel.length > 100) return res.status(400).json({ error: 'ชื่อรุ่นรวมช่วงปียาวเกินไป' });

    await inTransaction(async (conn) => {
      await conn.execute('UPDATE vehicle_models SET brand = ?, model = ?, year_range = ? WHERE id = ?', [brand, model, yearRange, current.id]);
      if (brand !== current.brand || newLabel !== oldLabel) {
        await conn.execute('UPDATE catalog_parts SET brand = ?, model = ? WHERE brand = ? AND model = ?', [brand, newLabel, current.brand, oldLabel]);
        // tenant-ok: platform administrator (dev) renames the model in every shop's price rows
        await conn.execute('UPDATE quote_part_prices SET brand = ?, model = ? WHERE brand = ? AND model = ?', [brand, newLabel, current.brand, oldLabel]);
      }
    });
    await logAudit(req, 'catalog_rename_model', {
      detail: { id: current.id, from: `${current.brand} ${oldLabel}`, to: `${brand} ${newLabel}` },
    });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'ชื่อใหม่ชนกับรายการอะไหล่ที่มีอยู่แล้ว' });
    serverError(res, err, 'แก้ไขรุ่นรถไม่สำเร็จ');
  }
});

// Rename a brand everywhere (catalogue, master parts, every shop's price rows)
router.patch('/catalog/brands', async (req, res) => {
  const from = cleanText(req.body?.from, 100);
  const to = cleanText(req.body?.to, 100);
  if (!from || !to) return res.status(400).json({ error: 'กรุณากรอกชื่อยี่ห้อ' });
  try {
    const [[found]] = await pool.query("SELECT 1 AS ok FROM vehicle_models WHERE brand = ? AND status = 'approved' LIMIT 1", [from]);
    if (!found) return res.status(404).json({ error: 'ไม่พบยี่ห้อนี้' });
    await inTransaction(async (conn) => {
      await conn.execute('UPDATE vehicle_models SET brand = ? WHERE brand = ?', [to, from]);
      await conn.execute('UPDATE catalog_parts SET brand = ? WHERE brand = ?', [to, from]);
      // tenant-ok: platform administrator (dev) renames the brand in every shop's price rows
      await conn.execute('UPDATE quote_part_prices SET brand = ? WHERE brand = ?', [to, from]);
    });
    await logAudit(req, 'catalog_rename_brand', { detail: { from, to } });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'ชื่อยี่ห้อใหม่ชนกับรุ่นหรืออะไหล่ที่มีอยู่แล้ว' });
    serverError(res, err, 'แก้ไขยี่ห้อไม่สำเร็จ');
  }
});

// ── review queue: models typed in by shop staff ─────────────────────────────

router.get('/catalog/pending', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT v.id, v.brand, v.model, v.submitted_by, v.submitted_at, v.submitted_shop_id, s.name AS shop_name
       FROM vehicle_models v LEFT JOIN shops s ON s.id = v.submitted_shop_id
       WHERE v.status = 'pending'
       ORDER BY v.submitted_at ASC, v.id ASC`
    );
    // approved models of the same brand that look like the typed one, so a duplicate is easy to spot
    const approvedByBrand = new Map();
    const data = [];
    for (const row of rows) {
      if (!approvedByBrand.has(row.brand)) {
        const [models] = await pool.query(
          "SELECT id, model, year_range FROM vehicle_models WHERE brand = ? AND status = 'approved'",
          [row.brand]
        );
        approvedByBrand.set(row.brand, models);
      }
      const typed = normalizeName(row.model);
      const similar = approvedByBrand.get(row.brand)
        .filter((m) => {
          const name = normalizeName(m.model);
          return typed.length >= 2 && (name === typed || name.includes(typed) || typed.includes(name));
        })
        .slice(0, 8)
        .map((m) => ({ id: m.id, label: modelLabel(m.model, m.year_range) }));
      data.push({ ...row, similar });
    }
    res.json({ success: true, data });
  } catch (err) {
    serverError(res, err, 'โหลดรายการรอตรวจไม่สำเร็จ');
  }
});

async function loadPending(id) {
  const [[row]] = await pool.query(
    "SELECT id, brand, model, submitted_shop_id FROM vehicle_models WHERE id = ? AND status = 'pending'",
    [id]
  );
  return row || null;
}

// Approve: the model joins the shared catalogue and every shop sees it
router.post('/catalog/pending/:id/approve', async (req, res) => {
  try {
    const pending = await loadPending(req.params.id);
    if (!pending) return res.status(404).json({ error: 'ไม่พบรายการรอตรวจ' });
    const duplicate = await findDuplicateModel(pending.brand, pending.model, null, pending.id);
    if (duplicate) {
      return res.status(409).json({
        error: `มีรุ่นนี้ในสมุดแล้ว (${modelLabel(duplicate.model, duplicate.year_range)}) ใช้ "รวมกับรุ่นที่มีอยู่" แทน`,
        duplicate_id: duplicate.id,
      });
    }
    await pool.execute("UPDATE vehicle_models SET status = 'approved' WHERE id = ? AND status = 'pending'", [pending.id]);
    await logAudit(req, 'catalog_approve_model', { shopId: pending.submitted_shop_id, detail: { brand: pending.brand, model: pending.model } });
    res.json({ success: true });
  } catch (err) {
    serverError(res, err, 'อนุมัติรุ่นรถไม่สำเร็จ');
  }
});

// Merge: the typed model was really an existing one. The shop's saved vehicles (which its jobs read the car
// from), quotations and own price rows that use the typed name are changed to the catalogue name, then the
// pending entry is removed.
router.post('/catalog/pending/:id/merge', async (req, res) => {
  try {
    const pending = await loadPending(req.params.id);
    if (!pending) return res.status(404).json({ error: 'ไม่พบรายการรอตรวจ' });
    const [[target]] = await pool.query(
      "SELECT id, brand, model, year_range FROM vehicle_models WHERE id = ? AND status = 'approved'",
      [req.body?.target_id]
    );
    if (!target) return res.status(400).json({ error: 'กรุณาเลือกรุ่นที่ต้องการรวมด้วย' });
    const shopId = pending.submitted_shop_id;
    const oldLabel = pending.model;
    const newLabel = modelLabel(target.model, target.year_range);

    await inTransaction(async (conn) => {
      await conn.execute(
        'UPDATE quotations SET car_brand = ?, car_model = ? WHERE shop_id = ? AND car_brand = ? AND car_model = ?',
        [target.brand, target.model, shopId, pending.brand, pending.model]
      );
      await conn.execute(
        `UPDATE vehicles v JOIN customers c ON c.id = v.customer_id
         SET v.brand = ?, v.model = ? WHERE c.shop_id = ? AND v.brand = ? AND v.model = ?`,
        [target.brand, target.model, shopId, pending.brand, pending.model]
      );
      // IGNORE: a row that would collide with a price row the shop already has for the real model stays as it was
      await conn.execute(
        'UPDATE IGNORE quote_part_prices SET brand = ?, model = ? WHERE shop_id = ? AND brand = ? AND model = ?',
        [target.brand, newLabel, shopId, pending.brand, oldLabel]
      );
      await conn.execute("DELETE FROM vehicle_models WHERE id = ? AND status = 'pending'", [pending.id]);
    });
    await logAudit(req, 'catalog_merge_model', {
      shopId,
      detail: { from: `${pending.brand} ${pending.model}`, into: `${target.brand} ${newLabel}` },
    });
    res.json({ success: true });
  } catch (err) {
    serverError(res, err, 'รวมรุ่นรถไม่สำเร็จ');
  }
});

// Reject: the pending entry goes away; vehicles and quotations that already use the typed name keep it
router.delete('/catalog/pending/:id', async (req, res) => {
  try {
    const pending = await loadPending(req.params.id);
    if (!pending) return res.status(404).json({ error: 'ไม่พบรายการรอตรวจ' });
    await pool.execute("DELETE FROM vehicle_models WHERE id = ? AND status = 'pending'", [pending.id]);
    await logAudit(req, 'catalog_reject_model', { shopId: pending.submitted_shop_id, detail: { brand: pending.brand, model: pending.model } });
    res.json({ success: true });
  } catch (err) {
    serverError(res, err, 'ปฏิเสธรุ่นรถไม่สำเร็จ');
  }
});

// ── master parts ────────────────────────────────────────────────────────────

router.get('/catalog/parts', async (req, res) => {
  const brand = cleanText(req.query.brand, 100);
  const model = cleanText(req.query.model, 100);
  const search = cleanText(req.query.search, 100);
  if (!(brand && model) && !search) return res.json({ success: true, data: [] });
  try {
    let sql = `SELECT id, brand, model, part_name, category, description, price, needs_price, is_active
               FROM catalog_parts WHERE 1 = 1`;
    const params = [];
    if (brand) { sql += ' AND brand = ?'; params.push(brand); }
    if (model) { sql += ' AND model = ?'; params.push(model); }
    if (search) {
      sql += ' AND (part_name LIKE ? OR description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    sql += ' ORDER BY brand ASC, model ASC, part_name ASC LIMIT 1000';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    serverError(res, err, 'โหลดอะไหล่ในสมุดกลางไม่สำเร็จ');
  }
});

function readPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 && price <= 99999999 ? price : null;
}

router.post('/catalog/parts', async (req, res) => {
  const brand = cleanText(req.body?.brand, 100);
  const model = cleanText(req.body?.model, 100);
  const partName = cleanText(req.body?.part_name, 255);
  const price = readPrice(req.body?.price ?? 0);
  if (!brand || !model || !partName) return res.status(400).json({ error: 'กรุณากรอกยี่ห้อ รุ่นรถ และชื่ออะไหล่ให้ครบถ้วน' });
  if (price === null) return res.status(400).json({ error: 'ราคาไม่ถูกต้อง' });
  try {
    const [[known]] = await pool.query(
      `SELECT 1 AS ok FROM vehicle_models
       WHERE status = 'approved' AND brand = ?
         AND (CASE WHEN year_range IS NULL THEN model ELSE CONCAT(model, ' (', year_range, ')') END) = ?
       LIMIT 1`,
      [brand, model]
    );
    if (!known) return res.status(400).json({ error: 'ไม่พบยี่ห้อ/รุ่นนี้ในสมุดรุ่นรถ เพิ่มรุ่นรถก่อน' });
    const [result] = await pool.execute(
      'INSERT INTO catalog_parts (brand, model, part_name, category, description, price, needs_price) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [brand, model, partName, cleanText(req.body?.category, 150), cleanText(req.body?.description, 500), price, req.body?.needs_price ? 1 : 0]
    );
    await logAudit(req, 'catalog_add_part', { detail: { brand, model, part_name: partName, price } });
    res.status(201).json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'มีอะไหล่นี้ในรุ่นนี้อยู่แล้ว' });
    serverError(res, err, 'เพิ่มอะไหล่ไม่สำเร็จ');
  }
});

// Edit a master part. Price / description / category / hidden apply to every shop that has not set its own
// price; a new name is carried over to the shops' adjustment rows so they stay attached.
router.patch('/catalog/parts/:id', async (req, res) => {
  try {
    const [[current]] = await pool.query(
      'SELECT id, brand, model, part_name, category, description, price, needs_price, is_active FROM catalog_parts WHERE id = ?',
      [req.params.id]
    );
    if (!current) return res.status(404).json({ error: 'ไม่พบอะไหล่' });
    const body = req.body || {};
    const partName = body.part_name === undefined ? current.part_name : cleanText(body.part_name, 255);
    const price = body.price === undefined ? Number(current.price) : readPrice(body.price);
    if (!partName) return res.status(400).json({ error: 'กรุณากรอกชื่ออะไหล่' });
    if (price === null) return res.status(400).json({ error: 'ราคาไม่ถูกต้อง' });
    const description = body.description === undefined ? current.description : cleanText(body.description, 500);
    const category = body.category === undefined ? current.category : cleanText(body.category, 150);
    const isActive = body.is_active === undefined ? current.is_active : (body.is_active ? 1 : 0);
    // a real price entered clears "needs a price" unless the administrator says otherwise
    const needsPrice = body.needs_price === undefined ? (body.price === undefined ? current.needs_price : 0) : (body.needs_price ? 1 : 0);

    await inTransaction(async (conn) => {
      await conn.execute(
        `UPDATE catalog_parts SET part_name = ?, description = ?, category = ?, price = ?, needs_price = ?, is_active = ?
         WHERE id = ?`,
        [partName, description, category, price, needsPrice, isActive, current.id]
      );
      if (partName !== current.part_name) {
        // tenant-ok: platform administrator (dev) renames the part in every shop's adjustment rows
        await conn.execute(
          'UPDATE quote_part_prices SET part_name = ? WHERE brand = ? AND model = ? AND part_name = ?',
          [partName, current.brand, current.model, current.part_name]
        );
      }
    });
    await logAudit(req, 'catalog_update_part', {
      detail: {
        id: current.id, brand: current.brand, model: current.model, part_name: partName,
        price: { from: Number(current.price), to: price }, is_active: isActive,
      },
    });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'ชื่ออะไหล่ใหม่ชนกับรายการที่มีอยู่แล้ว' });
    serverError(res, err, 'แก้ไขอะไหล่ไม่สำเร็จ');
  }
});

module.exports = router;
