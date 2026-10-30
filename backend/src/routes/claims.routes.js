const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole, requireManager } = require('../middleware/auth');
const { trashDelete } = require('../utils/trash');
const { ownsRow } = require('../utils/tenant');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('office'));

// Claim number CLM-YYMMDD-NNN: bound to the date (not a running number) because "which claim of today is this" means more
// to the shop floor than a bare counter. FOR UPDATE stops two concurrent requests from taking the same number.
async function generateClaimNo(conn, shopId) {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '').slice(2); // YYMMDD
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

router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    const params = [req.shopId];
    let whereClause = 'WHERE cl.shop_id = ?';
    if (search && search.trim()) {
      const words = search.trim().split(/\s+/).filter(Boolean);
      const perWordClause = 'v.license_plate LIKE ? OR c.customer_name LIKE ? OR c.phone LIKE ?';
      whereClause += ` AND ${words.map(() => `(${perWordClause})`).join(' AND ')}`;
      words.forEach((w) => params.push(`%${w}%`, `%${w}%`, `%${w}%`));
    }
    const [rows] = await pool.execute(
      `SELECT cl.id, cl.claim_no, cl.claim_date, cl.symptom, cl.created_at,
              c.customer_name, c.phone,
              v.brand, v.model, v.license_plate,
              (SELECT COUNT(*) FROM claim_items ci WHERE ci.claim_id = cl.id) AS item_count
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

router.get('/:id', async (req, res) => {
  try {
    const [[claim]] = await pool.execute(
      `SELECT cl.*, c.customer_name, c.phone,
              v.brand, v.model, v.color, v.license_plate, v.mileage
       FROM claims cl
       JOIN customers c ON cl.customer_id = c.id
       JOIN vehicles v ON cl.vehicle_id = v.id
       WHERE cl.id = ? AND cl.shop_id = ?`,
      [req.params.id, req.shopId]
    );
    if (!claim) return res.status(404).json({ error: 'ไม่พบเคลม' });
    const [items] = await pool.execute(
      'SELECT id, product_name, quantity, unit_price FROM claim_items WHERE claim_id = ? ORDER BY id ASC',
      [req.params.id]
    );
    res.json({ success: true, data: { ...claim, items } });
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

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    if (!(await ownsRow(conn, 'customers', customer_id, req.shopId)) || !(await ownsRow(conn, 'vehicles', vehicle_id, req.shopId))) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบลูกค้าหรือรถที่เลือก' });
    }
    const claim_no = await generateClaimNo(conn, req.shopId);
    const [result] = await conn.execute(
      `INSERT INTO claims (shop_id, claim_no, customer_id, vehicle_id, claim_date, symptom, remark, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.shopId,
        claim_no,
        customer_id,
        vehicle_id,
        claim_date || new Date().toISOString().slice(0, 10),
        symptom || null,
        remark || null,
        req.user.id,
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
    const [result] = await conn.execute(
      `UPDATE claims SET customer_id = ?, vehicle_id = ?, claim_date = ?, symptom = ?, remark = ? WHERE id = ? AND shop_id = ?`,
      [customer_id, vehicle_id, claim_date || new Date().toISOString().slice(0, 10), symptom || null, remark || null, req.params.id, req.shopId]
    );
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบเคลม' });
    }
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
