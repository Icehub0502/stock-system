const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole, requireManager } = require('../middleware/auth');
const { trashDelete } = require('../utils/trash');
const { ownsRow } = require('../utils/tenant');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('office'));

const CASE_TYPES = ['parts_claim', 'rework'];
const CASE_STATUSES = ['open', 'follow_up', 'closed'];
const REPORT_RESULTS = ['ok', 'still_problem', 'no_answer'];
const OUTCOMES = ['resolved', 'partial', 'not_resolved'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function isFutureOrToday(value) {
  if (!DATE_RE.test(String(value))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value >= todayStr();
}

const actorName = (req) => String(req.user.full_name || req.user.username || '').slice(0, 100) || null;

// The case fields of a create / edit request. A field that was not sent stays undefined, so an edit keeps its value.
// A follow-up can only be planned once the fix is written down (given here or already saved on the case).
function parseCaseFields(body, savedResolution = null) {
  const fields = {};
  if (body.case_type !== undefined) {
    if (!CASE_TYPES.includes(body.case_type)) return { error: 'ประเภทเคสไม่ถูกต้อง' };
    fields.case_type = body.case_type;
  }
  if (body.source_receipt_id !== undefined) {
    if (body.source_receipt_id === null || body.source_receipt_id === '') {
      fields.source_receipt_id = null;
    } else {
      const id = Number(body.source_receipt_id);
      if (!Number.isInteger(id) || id <= 0) return { error: 'ใบเสร็จต้นเหตุไม่ถูกต้อง' };
      fields.source_receipt_id = id;
    }
  }
  if (body.finding !== undefined) fields.finding = cleanText(body.finding);
  if (body.resolution !== undefined) fields.resolution = cleanText(body.resolution);
  if (body.follow_up_date) {
    if (!isFutureOrToday(body.follow_up_date)) return { error: 'วันที่ติดตามผลไม่ถูกต้อง' };
    const resolution = fields.resolution === undefined ? savedResolution : fields.resolution;
    if (!cleanText(resolution)) return { error: 'กรุณาบันทึกวิธีแก้ก่อนตั้งวันติดตามผล' };
    fields.follow_up_date = body.follow_up_date;
  }
  return fields;
}

async function receiptBelongsToCar(conn, receiptId, vehicleId, shopId) {
  if (!receiptId) return true;
  const [[row]] = await conn.execute('SELECT id FROM receipts WHERE id = ? AND vehicle_id = ? AND shop_id = ?', [receiptId, vehicleId, shopId]);
  return Boolean(row);
}

// Claim number CLM-YYMMDD-NNN: bound to the date (not a running number) because "which claim of today is this" means more
// to the shop floor than a bare counter. FOR UPDATE stops two concurrent requests from taking the same number.
async function generateClaimNo(conn, shopId) {
  const dateStr = todayStr().replace(/-/g, '').slice(2); // YYMMDD
  const prefix = `CLM-${dateStr}-`;
  const [rows] = await conn.execute(
    "SELECT MAX(CAST(SUBSTRING(claim_no, ?) AS UNSIGNED)) AS maxNo FROM claims WHERE shop_id = ? AND claim_no LIKE ? FOR UPDATE",
    [prefix.length + 1, shopId, `${prefix}%`]
  );
  const nextNumber = (rows[0]?.maxNo || 0) + 1;
  return `${prefix}${String(nextNumber).padStart(3, '0')}`;
}

// Vehicle lookup for the claim form (words match brand / model / plate / customer separately)
router.get('/vehicle-search', async (req, res) => {
  try {
    const { search } = req.query;
    if (!search || !search.trim()) return res.json({ success: true, data: [] });
    // Split into words so "Toyota Revo" matches brand="Toyota" AND
    // model="Revo" separately — a single LIKE '%Toyota Revo%' would never
    // match since those live in different columns.
    const words = search.trim().split(/\s+/).filter(Boolean);
    const perWordClause = 'v.license_plate LIKE ? OR v.brand LIKE ? OR v.model LIKE ? OR c.customer_name LIKE ? OR c.phone LIKE ? OR c.customer_code LIKE ?';
    const whereClause = words.map(() => `(${perWordClause})`).join(' AND ');
    const params = [req.shopId, ...words.flatMap((w) => Array(6).fill(`%${w}%`))];
    const [rows] = await pool.execute(
      `SELECT v.id AS vehicle_id, v.brand, v.model, v.color, v.license_plate, v.mileage,
              c.id AS customer_id, c.customer_name, c.customer_code, c.phone
       FROM vehicles v
       JOIN customers c ON v.customer_id = c.id
       WHERE v.shop_id = ? AND ${whereClause}
       ORDER BY v.created_at DESC
       LIMIT 20`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error searching vehicles:', err);
    res.status(500).json({ error: 'ค้นหารถไม่สำเร็จ' });
  }
});

router.get('/next-code', async (req, res) => {
  try {
    const claim_no = await generateClaimNo(pool, req.shopId);
    res.json({ success: true, claim_no });
  } catch (err) {
    console.error('Error generating claim no:', err);
    res.status(500).json({ error: 'ไม่สามารถสร้างเลขที่เคลมได้' });
  }
});

// GET /claims?search=&status= : every word must match the car, the customer, the case text or a part, so a past case
// can be found by model, symptom or part when the same problem comes back
router.get('/', async (req, res) => {
  try {
    const { search, status } = req.query;
    const params = [req.shopId];
    let whereClause = 'WHERE cl.shop_id = ?';
    if (CASE_STATUSES.includes(status)) {
      whereClause += ' AND cl.status = ?';
      params.push(status);
    }
    if (search && search.trim()) {
      const words = search.trim().split(/\s+/).filter(Boolean).slice(0, 6);
      const perWordClause = `v.license_plate LIKE ? OR v.brand LIKE ? OR v.model LIKE ? OR c.customer_name LIKE ? OR c.phone LIKE ?
        OR cl.claim_no LIKE ? OR cl.symptom LIKE ? OR cl.finding LIKE ? OR cl.resolution LIKE ? OR cl.lesson LIKE ?
        OR EXISTS (SELECT 1 FROM claim_items si WHERE si.claim_id = cl.id AND si.product_name LIKE ?)`;
      whereClause += ` AND ${words.map(() => `(${perWordClause})`).join(' AND ')}`;
      words.forEach((w) => params.push(...Array(11).fill(`%${w}%`)));
    }
    const [rows] = await pool.query(
      `SELECT cl.id, cl.claim_no, cl.claim_date, cl.symptom, cl.created_at, cl.case_type, cl.status, cl.resolution, cl.outcome,
              c.customer_name, c.phone,
              v.brand, v.model, v.license_plate,
              (SELECT COUNT(*) FROM claim_items ci WHERE ci.claim_id = cl.id) AS item_count,
              (SELECT MIN(f.scheduled_date) FROM claim_follow_ups f WHERE f.claim_id = cl.id AND f.done_at IS NULL) AS next_follow_up
       FROM claims cl
       JOIN customers c ON cl.customer_id = c.id
       JOIN vehicles v ON cl.vehicle_id = v.id
       ${whereClause}
       ORDER BY cl.created_at DESC
       LIMIT 300`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error loading claims:', err);
    res.status(500).json({ error: 'โหลดรายการเคลมไม่สำเร็จ' });
  }
});

// GET /claims/follow-ups : the follow-up page. Cases still being worked on, sorted into what staff have to do next.
router.get('/follow-ups', async (req, res) => {
  try {
    const [cases] = await pool.query(
      `SELECT cl.id, cl.claim_no, cl.claim_date, cl.case_type, cl.status, cl.symptom, cl.finding, cl.resolution,
              c.customer_name, c.phone,
              v.id AS vehicle_id, v.brand, v.model, v.color, v.license_plate, v.province
       FROM claims cl
       JOIN customers c ON cl.customer_id = c.id
       JOIN vehicles v ON cl.vehicle_id = v.id
       WHERE cl.shop_id = ? AND cl.status IN ('open', 'follow_up')
       ORDER BY cl.id DESC
       LIMIT 500`,
      [req.shopId]
    );
    const ids = cases.map((c) => c.id);
    const [items] = ids.length ? await pool.query(
      'SELECT claim_id, product_name, quantity FROM claim_items WHERE claim_id IN (?) ORDER BY id',
      [ids]
    ) : [[]];
    const [followUps] = ids.length ? await pool.query(
      `SELECT id, claim_id, scheduled_date, done_at, done_by, result, note FROM claim_follow_ups
       WHERE claim_id IN (?) ORDER BY scheduled_date, id`,
      [ids]
    ) : [[]];

    const today = todayStr();
    const buckets = { due: [], upcoming: [], ready: [], open: [] };
    cases.forEach((c) => {
      const own = followUps.filter((f) => f.claim_id === c.id);
      const pending = own.find((f) => !f.done_at) || null;
      const row = {
        ...c,
        items: items.filter((i) => i.claim_id === c.id),
        reports: own.filter((f) => f.done_at),
        pending,
      };
      if (c.status === 'open') buckets.open.push(row);
      else if (!pending) buckets.ready.push(row);
      else if (pending.scheduled_date <= today) buckets.due.push(row);
      else buckets.upcoming.push(row);
    });
    const byDate = (a, b) => a.pending.scheduled_date.localeCompare(b.pending.scheduled_date);
    buckets.due.sort(byDate);
    buckets.upcoming.sort(byDate);
    res.json({ success: true, data: { today, ...buckets } });
  } catch (err) {
    console.error('Error loading follow-ups:', err);
    res.status(500).json({ error: 'โหลดรายการติดตามผลไม่สำเร็จ' });
  }
});

// GET /claims/similar?vehicle_id= : past cases of the same model that have a written fix, shown while filling in a new case
router.get('/similar', async (req, res) => {
  const vehicleId = Number(req.query.vehicle_id);
  const exclude = Number(req.query.exclude) || 0;
  if (!Number.isInteger(vehicleId) || vehicleId <= 0) return res.status(400).json({ error: 'รหัสรถไม่ถูกต้อง' });
  try {
    const [[car]] = await pool.query('SELECT brand, model, vehicle_model_id FROM vehicles WHERE id = ? AND shop_id = ?', [vehicleId, req.shopId]);
    if (!car) return res.status(404).json({ error: 'ไม่พบรถ' });
    // one model is saved as typed ("Yaris G2") or as picked from the list ("Yaris G2 (ปี 2013-ปัจจุบัน)"): both are the same model
    const baseModel = String(car.model || '').replace(/\s*\(ปี[^)]*\)\s*$/, '').trim();
    const likeBase = baseModel.replace(/[\\%_]/g, '\\$&');
    const [rows] = await pool.query(
      `SELECT cl.id, cl.claim_no, cl.claim_date, cl.case_type, cl.symptom, cl.finding, cl.resolution, cl.outcome, cl.lesson
       FROM claims cl
       JOIN vehicles v ON cl.vehicle_id = v.id
       WHERE cl.shop_id = ? AND cl.id <> ?
         AND cl.resolution IS NOT NULL AND cl.resolution <> ''
         AND (v.vehicle_model_id = ? OR (v.brand = ? AND (v.model = ? OR v.model LIKE ?)))
       ORDER BY cl.claim_date DESC, cl.id DESC
       LIMIT 5`,
      [req.shopId, exclude, car.vehicle_model_id, car.brand, baseModel, `${likeBase} (ปี %`]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error loading similar cases:', err);
    res.status(500).json({ error: 'โหลดเคสตัวอย่างไม่สำเร็จ' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [[claim]] = await pool.execute(
      `SELECT cl.*, c.customer_name, c.phone,
              v.brand, v.model, v.color, v.license_plate, v.mileage,
              r.receipt_no AS source_receipt_no
       FROM claims cl
       JOIN customers c ON cl.customer_id = c.id
       JOIN vehicles v ON cl.vehicle_id = v.id
       LEFT JOIN receipts r ON r.id = cl.source_receipt_id AND r.shop_id = cl.shop_id
       WHERE cl.id = ? AND cl.shop_id = ?`,
      [req.params.id, req.shopId]
    );
    if (!claim) return res.status(404).json({ error: 'ไม่พบเคลม' });
    const [items] = await pool.execute(
      'SELECT id, product_name, quantity, unit_price FROM claim_items WHERE claim_id = ? ORDER BY id ASC',
      [req.params.id]
    );
    const [followUps] = await pool.execute(
      'SELECT id, scheduled_date, done_at, done_by, result, note FROM claim_follow_ups WHERE claim_id = ? ORDER BY scheduled_date, id',
      [req.params.id]
    );
    res.json({ success: true, data: { ...claim, items, follow_ups: followUps } });
  } catch (err) {
    console.error('Error loading claim:', err);
    res.status(500).json({ error: 'โหลดเคลมไม่สำเร็จ' });
  }
});

router.post('/', async (req, res) => {
  const { customer_id, vehicle_id, claim_date, symptom, remark, items = [] } = req.body || {};
  if (!customer_id || !vehicle_id) {
    return res.status(400).json({ error: 'กรุณาเลือกลูกค้าและรถก่อน' });
  }
  const fields = parseCaseFields(req.body);
  if (fields.error) return res.status(400).json({ error: fields.error });

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    if (!(await ownsRow(conn, 'customers', customer_id, req.shopId)) || !(await ownsRow(conn, 'vehicles', vehicle_id, req.shopId))) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบลูกค้าหรือรถที่เลือก' });
    }
    if (!(await receiptBelongsToCar(conn, fields.source_receipt_id, vehicle_id, req.shopId))) {
      await conn.rollback();
      return res.status(400).json({ error: 'ใบเสร็จต้นเหตุไม่ใช่ของรถคันนี้' });
    }
    const claim_no = await generateClaimNo(conn, req.shopId);
    const [result] = await conn.execute(
      `INSERT INTO claims (shop_id, claim_no, customer_id, vehicle_id, claim_date, symptom, remark, created_by,
                           case_type, status, source_receipt_id, finding, resolution)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.shopId,
        claim_no,
        customer_id,
        vehicle_id,
        claim_date || todayStr(),
        symptom || null,
        remark || null,
        req.user.id,
        fields.case_type || 'parts_claim',
        fields.follow_up_date ? 'follow_up' : 'open',
        fields.source_receipt_id ?? null,
        fields.finding ?? null,
        fields.resolution ?? null,
      ]
    );
    const claimId = result.insertId;
    for (const it of items) {
      if (!it.product_name) continue;
      await conn.execute(
        'INSERT INTO claim_items (claim_id, product_name, quantity, unit_price) VALUES (?, ?, ?, ?)',
        [claimId, it.product_name, Number(it.quantity) || 1, Number(it.unit_price) || 0]
      );
    }
    if (fields.follow_up_date) {
      await conn.execute('INSERT INTO claim_follow_ups (claim_id, scheduled_date) VALUES (?, ?)', [claimId, fields.follow_up_date]);
    }
    await conn.commit();
    res.status(201).json({ success: true, id: claimId, claim_no });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackErr) { console.error('Rollback error:', rollbackErr); }
    }
    console.error('Error creating claim:', err);
    res.status(500).json({ error: 'สร้างเคลมไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

router.put('/:id', async (req, res) => {
  const { customer_id, vehicle_id, claim_date, symptom, remark, items = [] } = req.body || {};
  if (!customer_id || !vehicle_id) {
    return res.status(400).json({ error: 'กรุณาเลือกลูกค้าและรถก่อน' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    if (!(await ownsRow(conn, 'customers', customer_id, req.shopId)) || !(await ownsRow(conn, 'vehicles', vehicle_id, req.shopId))) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบลูกค้าหรือรถที่เลือก' });
    }
    const [[current]] = await conn.execute(
      'SELECT status, case_type, source_receipt_id, finding, resolution FROM claims WHERE id = ? AND shop_id = ? FOR UPDATE',
      [req.params.id, req.shopId]
    );
    if (!current) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบเคลม' });
    }
    const fields = parseCaseFields(req.body, current.resolution);
    if (fields.error) {
      await conn.rollback();
      return res.status(400).json({ error: fields.error });
    }
    if (!(await receiptBelongsToCar(conn, fields.source_receipt_id, vehicle_id, req.shopId))) {
      await conn.rollback();
      return res.status(400).json({ error: 'ใบเสร็จต้นเหตุไม่ใช่ของรถคันนี้' });
    }
    if (fields.follow_up_date && current.status === 'closed') {
      await conn.rollback();
      return res.status(409).json({ error: 'เคสนี้ปิดแล้ว ให้ผู้จัดการเปิดเคสใหม่ก่อนตั้งวันติดตามผล' });
    }
    await conn.execute(
      `UPDATE claims SET customer_id = ?, vehicle_id = ?, claim_date = ?, symptom = ?, remark = ?,
         case_type = ?, status = ?, source_receipt_id = ?, finding = ?, resolution = ?
       WHERE id = ? AND shop_id = ?`,
      [
        customer_id,
        vehicle_id,
        claim_date || todayStr(),
        symptom || null,
        remark || null,
        fields.case_type ?? current.case_type,
        fields.follow_up_date ? 'follow_up' : current.status,
        fields.source_receipt_id === undefined ? current.source_receipt_id : fields.source_receipt_id,
        fields.finding === undefined ? current.finding : fields.finding,
        fields.resolution === undefined ? current.resolution : fields.resolution,
        req.params.id,
        req.shopId,
      ]
    );
    // แทนที่รายการอะไหล่ทั้งหมด — ง่ายกว่า diff ทีละแถว เหมือนที่ใบเสนอราคาแก้ไข
    // รายการก็ใช้วิธีนี้ (ดู quotations.routes.js PUT /:id)
    await conn.execute('DELETE FROM claim_items WHERE claim_id = ?', [req.params.id]);
    for (const it of items) {
      if (!it.product_name) continue;
      await conn.execute(
        'INSERT INTO claim_items (claim_id, product_name, quantity, unit_price) VALUES (?, ?, ?, ?)',
        [req.params.id, it.product_name, Number(it.quantity) || 1, Number(it.unit_price) || 0]
      );
    }
    if (fields.follow_up_date) {
      // one planned call at a time: a new date moves the call that is still waiting
      const [moved] = await conn.execute(
        'UPDATE claim_follow_ups SET scheduled_date = ? WHERE claim_id = ? AND done_at IS NULL',
        [fields.follow_up_date, req.params.id]
      );
      if (moved.affectedRows === 0) {
        await conn.execute('INSERT INTO claim_follow_ups (claim_id, scheduled_date) VALUES (?, ?)', [req.params.id, fields.follow_up_date]);
      }
    }
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackErr) { console.error('Rollback error:', rollbackErr); }
    }
    console.error('Error updating claim:', err);
    res.status(500).json({ error: 'แก้ไขเคลมไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// POST /claims/:id/follow-ups/:followUpId/report : what the customer said on the call
//   ok            the car is fine; a further call is optional
//   still_problem the problem is back: the case returns to "being fixed", nothing more is planned until it is fixed again
//   no_answer     could not reach the customer: the next try must be given
router.post('/:id/follow-ups/:followUpId/report', async (req, res) => {
  const { result, note, next_date } = req.body || {};
  const cleanNote = cleanText(note);
  if (!REPORT_RESULTS.includes(result)) return res.status(400).json({ error: 'กรุณาเลือกผลการติดตาม' });
  if (result !== 'no_answer' && !cleanNote) return res.status(400).json({ error: 'กรุณาเขียนรายงานว่าลูกค้าแจ้งว่าอย่างไร' });
  if (result === 'no_answer' && !next_date) return res.status(400).json({ error: 'กรุณาเลือกวันที่จะโทรอีกครั้ง' });
  if (result === 'still_problem' && next_date) return res.status(400).json({ error: 'ยังมีปัญหาอยู่ ให้แก้ไขก่อนแล้วค่อยตั้งวันติดตามใหม่' });
  if (next_date && !isFutureOrToday(next_date)) return res.status(400).json({ error: 'วันที่ติดตามครั้งถัดไปไม่ถูกต้อง' });

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[claim]] = await conn.execute(
      'SELECT id FROM claims WHERE id = ? AND shop_id = ? FOR UPDATE',
      [req.params.id, req.shopId]
    );
    if (!claim) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบเคส' });
    }
    const [[followUp]] = await conn.execute(
      'SELECT id, done_at FROM claim_follow_ups WHERE id = ? AND claim_id = ? FOR UPDATE',
      [req.params.followUpId, claim.id]
    );
    if (!followUp) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบรายการติดตามผล' });
    }
    if (followUp.done_at) {
      await conn.rollback();
      return res.status(409).json({ error: 'รายการนี้บันทึกผลไปแล้ว' });
    }
    await conn.execute(
      'UPDATE claim_follow_ups SET done_at = NOW(), done_by = ?, result = ?, note = ? WHERE id = ?',
      [actorName(req), result, cleanNote, followUp.id]
    );
    if (next_date) {
      await conn.execute('INSERT INTO claim_follow_ups (claim_id, scheduled_date) VALUES (?, ?)', [claim.id, next_date]);
    }
    if (result === 'still_problem') {
      await conn.execute("UPDATE claims SET status = 'open' WHERE id = ? AND shop_id = ?", [claim.id, req.shopId]);
    }
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackErr) { console.error('Rollback error:', rollbackErr); }
    }
    console.error('Error saving follow-up report:', err);
    res.status(500).json({ error: 'บันทึกผลการติดตามไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// POST /claims/:id/close (manager and above): needs the fix written down, at least one call reported and nothing still planned
router.post('/:id/close', requireManager, async (req, res) => {
  const { outcome, lesson } = req.body || {};
  if (!OUTCOMES.includes(outcome)) return res.status(400).json({ error: 'กรุณาเลือกผลสรุปของเคส' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[claim]] = await conn.execute(
      'SELECT id, status, resolution FROM claims WHERE id = ? AND shop_id = ? FOR UPDATE',
      [req.params.id, req.shopId]
    );
    if (!claim) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบเคส' });
    }
    if (claim.status !== 'follow_up' || !cleanText(claim.resolution)) {
      await conn.rollback();
      return res.status(409).json({ error: 'ปิดเคสได้เมื่อบันทึกวิธีแก้และตั้งการติดตามผลแล้วเท่านั้น' });
    }
    const [[counts]] = await conn.execute(
      'SELECT SUM(done_at IS NULL) AS waiting, SUM(done_at IS NOT NULL) AS reported FROM claim_follow_ups WHERE claim_id = ?',
      [claim.id]
    );
    if (Number(counts.waiting) > 0 || !Number(counts.reported)) {
      await conn.rollback();
      return res.status(409).json({ error: 'ต้องโทรติดตามและเขียนรายงานให้ครบก่อนปิดเคส' });
    }
    await conn.execute(
      "UPDATE claims SET status = 'closed', outcome = ?, lesson = ?, closed_at = NOW(), closed_by = ? WHERE id = ? AND shop_id = ?",
      [outcome, cleanText(lesson), actorName(req), claim.id, req.shopId]
    );
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackErr) { console.error('Rollback error:', rollbackErr); }
    }
    console.error('Error closing case:', err);
    res.status(500).json({ error: 'ปิดเคสไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// POST /claims/:id/reopen (manager and above): the problem came back. The earlier fix and reports stay on the case.
router.post('/:id/reopen', requireManager, async (req, res) => {
  try {
    const [result] = await pool.execute(
      "UPDATE claims SET status = 'open', outcome = NULL, closed_at = NULL, closed_by = NULL WHERE id = ? AND shop_id = ? AND status = 'closed'",
      [req.params.id, req.shopId]
    );
    if (result.affectedRows === 0) return res.status(409).json({ error: 'เปิดเคสใหม่ได้เฉพาะเคสที่ปิดแล้ว' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error reopening case:', err);
    res.status(500).json({ error: 'เปิดเคสใหม่ไม่สำเร็จ' });
  }
});

router.delete('/:id', requireManager, async (req, res) => {
  try {
    const result = await trashDelete(pool, { table: 'claims', id: req.params.id, shopId: req.shopId, user: req.user });
    if (!result.deleted) return res.status(404).json({ error: 'ไม่พบเคลม' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting claim:', err);
    res.status(500).json({ error: 'ลบเคลมไม่สำเร็จ' });
  }
});

module.exports = router;
