const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('office'));

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM warranties ORDER BY warranty_name ASC');
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error loading warranties:', err);
    res.status(500).json({ error: 'โหลดการรับประกันไม่สำเร็จ' });
  }
});

router.post('/', async (req, res) => {
  const { warranty_name, warranty_year, warranty_month, warranty_km, is_active } = req.body;
  if (!warranty_name) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อการรับประกัน' });
  }
  try {
    const [result] = await pool.execute(
      'INSERT INTO warranties (warranty_name, warranty_year, warranty_month, warranty_km, is_active) VALUES (?, ?, ?, ?, ?)',
      [warranty_name, Number(warranty_year) || 0, Number(warranty_month) || 0, Number(warranty_km) || 0, is_active ? 1 : 0]
    );
    res.status(201).json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    console.error('Error creating warranty:', err);
    res.status(500).json({ error: 'สร้างการรับประกันไม่สำเร็จ' });
  }
});

router.put('/:id', async (req, res) => {
  const { warranty_name, warranty_year, warranty_month, warranty_km, is_active } = req.body;
  if (!warranty_name) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อการรับประกัน' });
  }
  try {
    const [result] = await pool.execute(
      'UPDATE warranties SET warranty_name = ?, warranty_year = ?, warranty_month = ?, warranty_km = ?, is_active = ? WHERE id = ?',
      [warranty_name, Number(warranty_year) || 0, Number(warranty_month) || 0, Number(warranty_km) || 0, is_active ? 1 : 0, req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบการรับประกัน' });
    }
    res.json({ success: true, message: 'อัปเดตการรับประกันสำเร็จ' });
  } catch (err) {
    console.error('Error updating warranty:', err);
    res.status(500).json({ error: 'อัปเดตการรับประกันไม่สำเร็จ' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM warranties WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบการรับประกัน' });
    }
    res.json({ success: true, message: 'ลบการรับประกันสำเร็จ' });
  } catch (err) {
    console.error('Error deleting warranty:', err);
    res.status(500).json({ error: 'ลบการรับประกันไม่สำเร็จ' });
  }
});

module.exports = router;
