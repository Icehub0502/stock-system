const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
// Both office (creates from an approved quotation, prints/reviews) and
// technician (fills the checklist out on their phone while doing the job)
// need full access here — unlike most other routes in this app, which are
// office-only.
router.use(requireRole('office', 'technician'));

async function generateCode() {
  // Document number prefix is "RN-" (repair notice). "SPK" is reserved for the
  // rack code the office writes on the printed form, so it must NOT be reused
  // as the document number. SUBSTRING(code, 4) strips the 3-char "RN-" prefix.
  const [rows] = await pool.execute(
    "SELECT MAX(CAST(SUBSTRING(code, 4) AS UNSIGNED)) AS maxNo FROM repair_notices WHERE code LIKE 'RN-%'"
  );
  const nextNumber = (rows[0]?.maxNo || 0) + 1;
  return `RN-${String(nextNumber).padStart(4, '0')}`;
}

// A technician on their phone needs to find a vehicle too, but the
// existing customer/vehicle search endpoints are office-only (they live
// under routers gated with requireRole('office')) — this one is scoped to
// this router's broader office+technician access instead of loosening
// those.
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
    const params = words.flatMap((w) => Array(6).fill(`%${w}%`));
    const [rows] = await pool.execute(
      `SELECT v.id AS vehicle_id, v.brand, v.model, v.color, v.license_plate, v.mileage,
              c.id AS customer_id, c.customer_name, c.customer_code, c.phone
       FROM vehicles v
       JOIN customers c ON v.customer_id = c.id
       WHERE ${whereClause}
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
    const code = await generateCode();
    res.json({ success: true, code });
  } catch (err) {
    console.error('Error generating repair notice code:', err);
    res.status(500).json({ error: 'ไม่สามารถสร้างเลขที่ใบแจ้งซ่อมได้' });
  }
});

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT rn.id, rn.code, rn.notice_date, rn.checked_by, rn.repaired_by, rn.created_at,
              c.customer_name, c.customer_code,
              v.brand, v.model, v.color, v.license_plate,
              q.queue_no
       FROM repair_notices rn
       LEFT JOIN customers c ON rn.customer_id = c.id
       LEFT JOIN vehicles v ON rn.vehicle_id = v.id
       LEFT JOIN quotations q ON rn.quotation_id = q.id
       ORDER BY rn.created_at DESC
       LIMIT 300`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error loading repair notices:', err);
    res.status(500).json({ error: 'โหลดรายการใบแจ้งซ่อมไม่สำเร็จ' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [[row]] = await pool.execute(
      `SELECT rn.*, c.customer_name, c.customer_code, c.phone,
              v.brand, v.model, v.color, v.license_plate, v.mileage,
              q.queue_no
       FROM repair_notices rn
       LEFT JOIN customers c ON rn.customer_id = c.id
       LEFT JOIN vehicles v ON rn.vehicle_id = v.id
       LEFT JOIN quotations q ON rn.quotation_id = q.id
       WHERE rn.id = ?`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'ไม่พบใบแจ้งซ่อม' });
    res.json({ success: true, data: row });
  } catch (err) {
    console.error('Error loading repair notice:', err);
    res.status(500).json({ error: 'โหลดใบแจ้งซ่อมไม่สำเร็จ' });
  }
});

router.post('/', async (req, res) => {
  const { customer_id, vehicle_id, quotation_id, notice_date, checklist, checked_by, repaired_by } = req.body || {};

  if (!vehicle_id) {
    return res.status(400).json({ error: 'กรุณาเลือกรถก่อน' });
  }
  if (!checklist || typeof checklist !== 'object') {
    return res.status(400).json({ error: 'ข้อมูลรายการตรวจเช็คไม่ถูกต้อง' });
  }

  try {
    const code = await generateCode();
    const [result] = await pool.execute(
      `INSERT INTO repair_notices (code, customer_id, vehicle_id, quotation_id, notice_date, checklist, checked_by, repaired_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code,
        customer_id || null,
        vehicle_id,
        quotation_id || null,
        notice_date || new Date().toISOString().slice(0, 10),
        JSON.stringify(checklist),
        checked_by || null,
        repaired_by || null,
      ]
    );
    res.status(201).json({ success: true, id: result.insertId, code });
  } catch (err) {
    console.error('Error creating repair notice:', err);
    res.status(500).json({ error: 'สร้างใบแจ้งซ่อมไม่สำเร็จ' });
  }
});

router.put('/:id', async (req, res) => {
  const { customer_id, vehicle_id, notice_date, checklist, checked_by, repaired_by } = req.body || {};

  if (!vehicle_id) {
    return res.status(400).json({ error: 'กรุณาเลือกรถก่อน' });
  }
  if (!checklist || typeof checklist !== 'object') {
    return res.status(400).json({ error: 'ข้อมูลรายการตรวจเช็คไม่ถูกต้อง' });
  }

  try {
    const [result] = await pool.execute(
      `UPDATE repair_notices
       SET customer_id = ?, vehicle_id = ?, notice_date = ?, checklist = ?, checked_by = ?, repaired_by = ?
       WHERE id = ?`,
      [
        customer_id || null,
        vehicle_id,
        notice_date || new Date().toISOString().slice(0, 10),
        JSON.stringify(checklist),
        checked_by || null,
        repaired_by || null,
        req.params.id,
      ]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'ไม่พบใบแจ้งซ่อม' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating repair notice:', err);
    res.status(500).json({ error: 'แก้ไขใบแจ้งซ่อมไม่สำเร็จ' });
  }
});

router.delete('/:id', requireRole('office'), async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM repair_notices WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'ไม่พบใบแจ้งซ่อม' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting repair notice:', err);
    res.status(500).json({ error: 'ลบใบแจ้งซ่อมไม่สำเร็จ' });
  }
});

module.exports = router;
