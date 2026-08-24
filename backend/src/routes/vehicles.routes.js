const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
// pushQuotationUpdate: ดันข้อมูลอัปเดตกลับเข้ากลุ่มไลน์ของร้าน — ใช้ตอนแก้ไขรถผ่าน
// หน้า Vehicle Management (เจ้าของร้านยืนยันเองว่าการแก้ทะเบียน/ยี่ห้อ/รุ่นเกิดที่
// หน้านี้ ไม่ใช่ผ่านฟอร์มใบเสนอราคา) ดู PUT /:id ด้านล่าง
const { pushQuotationUpdate } = require('./lineWebhook.routes');
const { buildVisitHistory } = require('../utils/visitHistory');

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

    // แก้ไขรถคันนี้แล้ว — หาใบเสนอราคาที่มาจากไลน์+ยังเปิดอยู่ทุกใบที่ผูกกับรถคันนี้
    // (ปกติมีใบเดียว แต่ไม่บล็อกกรณีมีมากกว่า 1) แล้ว push ข้อมูลอัปเดตกลับเข้ากลุ่ม
    // ไลน์ทีละใบ — best-effort ทั้งหมด ไม่กระทบผลลัพธ์การบันทึกรถที่สำเร็จไปแล้ว
    try {
      const [openQuotations] = await pool.execute(
        'SELECT id FROM quotations WHERE vehicle_id = ? AND queue_no IS NOT NULL AND closed_at IS NULL',
        [req.params.id]
      );
      for (const q of openQuotations) {
        await pushQuotationUpdate(q.id);
      }
    } catch (err) {
      console.error('Error pushing quotation update to LINE after vehicle edit:', err);
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
