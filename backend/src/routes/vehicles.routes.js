const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { buildVisitHistory } = require('../utils/visitHistory');
const { CLOSED_STATUSES } = require('../utils/jobStatusFlow');

const router = express.Router();
router.use(authenticate);

router.get('/', requireRole('office'), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT v.*, c.customer_name, c.customer_code
       FROM vehicles v
       JOIN customers c ON v.customer_id = c.id
       ORDER BY v.created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error fetching vehicles:', err);
    res.status(500).json({ error: 'โหลดข้อมูลรถไม่สำเร็จ' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM vehicles WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบรถ' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Error fetching vehicle:', err);
    res.status(500).json({ error: 'โหลดข้อมูลรถไม่สำเร็จ' });
  }
});

// ── ประวัติการเข้ารับบริการของรถคันนี้ (ทุกครั้ง) ──
router.get('/:id/history', requireRole('office'), async (req, res) => {
  try {
    const [[vehicle]] = await pool.query(
      `SELECT v.*, c.customer_name, c.customer_code, c.phone
       FROM vehicles v JOIN customers c ON c.id = v.customer_id
       WHERE v.id = ?`,
      [req.params.id]
    );
    if (!vehicle) return res.status(404).json({ error: 'ไม่พบรถ' });

    const visits = await buildVisitHistory('vehicle_id', req.params.id);
    res.json({ success: true, data: { vehicle, visits } });
  } catch (err) {
    console.error('Error fetching vehicle history:', err);
    res.status(500).json({ error: 'โหลดประวัติไม่สำเร็จ' });
  }
});

// ── ใบเสนอราคาเดิมที่ยังเปิดอยู่ของรถคันนี้ (ไม่จำกัดวันที่) — ใช้ตอนพนักงาน
// พิมพ์ทะเบียนที่หน้า "เพิ่มคิว" แล้วเจอว่ามีใบเสนอราคาเดิมค้างไว้ (เช่นลูกค้าคุยไว้
// ทางไลน์เมื่อวาน มีรายการ/มัดจำอยู่แล้ว) ให้ดึงมาผูกกับคิววันนี้ได้เลย แทนที่จะต้อง
// พึ่งการจับคู่อัตโนมัติ (ซึ่งจำกัดแค่วันเดียวกันเท่านั้น กันจับคู่ใบเก่าที่ไม่เกี่ยวกัน
// ผิดๆ) หรือพิมพ์ไลน์ซ้ำ (เสี่ยงไปโดน isUpdate ทับรายการเดิมถ้าข้อความใหม่ไม่มี
// รายการ — เจอปัญหานี้จริงมาแล้ว) เกณฑ์ "ยังเปิดอยู่" เดียวกับที่ POST /jobs ใช้เช็ค
// ก่อนผูก: ยังไม่ปิดบิล และไม่มีงานอื่นที่ยัง active ผูกอยู่แล้ว
router.get('/:id/open-quotation', requireRole('office'), async (req, res) => {
  try {
    const [[quotation]] = await pool.query(
      `SELECT id, quotation_no, quotation_date, status, total_amount, deposit_amount, deposit_date, symptom
       FROM quotations
       WHERE vehicle_id = ? AND closed_at IS NULL
         AND id NOT IN (
           SELECT quotation_id FROM jobs
           WHERE quotation_id IS NOT NULL AND status NOT IN (${CLOSED_STATUSES.map(() => '?').join(',')})
         )
       ORDER BY created_at DESC LIMIT 1`,
      [req.params.id, ...CLOSED_STATUSES]
    );
    res.json({ success: true, data: quotation || null });
  } catch (err) {
    console.error('Error fetching open quotation:', err);
    res.status(500).json({ error: 'ค้นหาใบเสนอราคาเดิมไม่สำเร็จ' });
  }
});

router.post('/', requireRole('office'), async (req, res) => {
  const { customer_id, brand, model, color, license_plate, mileage } = req.body;
  if (!customer_id || !brand || !model) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลรถให้ครบถ้วน' });
  }
  try {
    const [vehicleResult] = await pool.execute(
      `INSERT INTO vehicles (customer_id, brand, model, color, license_plate, mileage)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [customer_id, brand, model, color || null, license_plate || null, Number(mileage) || 0]
    );
    res.status(201).json({ success: true, data: { id: vehicleResult.insertId } });
  } catch (err) {
    console.error('Error creating vehicle:', err);
    res.status(500).json({ error: 'สร้างรถไม่สำเร็จ' });
  }
});

router.put('/:id', requireRole('office'), async (req, res) => {
  const { brand, model, color, license_plate, mileage } = req.body;
  if (!brand || !model) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลรถให้ครบถ้วน' });
  }
  try {
    const [result] = await pool.execute(
      `UPDATE vehicles SET brand = ?, model = ?, color = ?, license_plate = ?, mileage = ? WHERE id = ?`,
      [brand, model, color || null, license_plate || null, Number(mileage) || 0, req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบรถ' });
    }

    res.json({ success: true, message: 'อัปเดตรถสำเร็จ' });
  } catch (err) {
    console.error('Error updating vehicle:', err);
    res.status(500).json({ error: 'อัปเดตรถไม่สำเร็จ' });
  }
});

router.delete('/:id', requireRole('office'), async (req, res) => {
  try {
    // quotations.vehicle_id เป็น ON DELETE SET NULL — ถ้าไม่เช็คก่อน ใบเสนอราคาที่
    // ยังเปิดอยู่จะหลุดจากรถคันนี้แบบเงียบ ๆ ไม่มีคำเตือนเลย (receipts.vehicle_id
    // เป็น RESTRICT อยู่แล้วจึง error ชัดเจนถ้ามีใบเสร็จผูกอยู่ — จุดนี้เป็นแค่ช่องโหว่
    // ฝั่งใบเสนอราคาที่ยังไม่ปิดบิล)
    const [[{ quotationCount }]] = await pool.query(
      `SELECT COUNT(*) AS quotationCount FROM quotations WHERE vehicle_id = ? AND closed_at IS NULL`,
      [req.params.id]
    );
    if (quotationCount > 0) {
      return res.status(409).json({ error: `รถคันนี้มีใบเสนอราคาที่ยังไม่ปิดบิลผูกอยู่ ${quotationCount} ใบ กรุณาจัดการใบเสนอราคาก่อน` });
    }

    const [result] = await pool.execute('DELETE FROM vehicles WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบรถ' });
    }
    res.json({ success: true, message: 'ลบรถสำเร็จ' });
  } catch (err) {
    console.error('Error deleting vehicle:', err);
    res.status(500).json({ error: 'ลบรถไม่สำเร็จ' });
  }
});

module.exports = router;
