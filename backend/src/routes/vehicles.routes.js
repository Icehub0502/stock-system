const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

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
