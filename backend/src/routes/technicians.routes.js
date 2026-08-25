const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('office'));

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id, name FROM technicians ORDER BY name ASC');
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error loading technicians:', err);
    res.status(500).json({ error: 'โหลดรายชื่อช่างไม่สำเร็จ' });
  }
});

// เพิ่มชื่อช่างใหม่ — ใช้ตอนรับช่างเข้าใหม่ ไม่มีในลิสต์เริ่มต้น (ดู
// JobBoardPage.jsx จุดที่เรียก) ชื่อซ้ำของเดิม (UNIQUE) แค่คืนแถวเดิมกลับไปเฉย ๆ
// ไม่ถือเป็น error — กันพนักงานกดเพิ่มซ้ำโดยไม่ตั้งใจแล้วเจอข้อความ error งง ๆ
router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อช่าง' });
  try {
    await pool.execute('INSERT IGNORE INTO technicians (name) VALUES (?)', [name]);
    const [[row]] = await pool.query('SELECT id, name FROM technicians WHERE name = ?', [name]);
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    console.error('Error creating technician:', err);
    res.status(500).json({ error: 'เพิ่มชื่อช่างไม่สำเร็จ' });
  }
});

module.exports = router;
