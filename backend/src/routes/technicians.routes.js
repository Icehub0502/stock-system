const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole, requireManager } = require('../middleware/auth');
const { trashDelete } = require('../utils/trash');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('office'));

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id, name FROM technicians WHERE shop_id = ? ORDER BY name ASC', [req.shopId]);
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
    await pool.execute('INSERT IGNORE INTO technicians (shop_id, name) VALUES (?, ?)', [req.shopId, name]);
    const [[row]] = await pool.query('SELECT id, name FROM technicians WHERE shop_id = ? AND name = ?', [req.shopId, name]);
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    console.error('Error creating technician:', err);
    res.status(500).json({ error: 'เพิ่มชื่อช่างไม่สำเร็จ' });
  }
});

// แก้ไข/ลบชื่อช่าง — เฉพาะเจ้าของร้าน (หน้าตั้งค่า) ต่างจาก GET/POST ด้านบนที่ office
// ทั่วไปใช้ตอนมอบหมายงานได้อยู่แล้ว การแก้ไข/ลบเป็นงานจัดการรายชื่อ ไม่ใช่งานประจำวัน
// จึงจำกัดเฉพาะเจ้าของร้าน — ปลอดภัยที่จะลบเพราะ jobs.technician เป็นแค่ VARCHAR
// ก็อปปี้ชื่อไว้ตอนมอบหมาย (ไม่ใช่ foreign key) งานเก่าที่เคยมอบหมายไปแล้วไม่กระทบ
router.put('/:id', requireManager, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อช่าง' });
  try {
    const [[existing]] = await pool.query('SELECT id FROM technicians WHERE id = ? AND shop_id = ?', [req.params.id, req.shopId]);
    if (!existing) return res.status(404).json({ error: 'ไม่พบช่างนี้' });
    await pool.execute('UPDATE technicians SET name = ? WHERE id = ? AND shop_id = ?', [name, req.params.id, req.shopId]);
    res.json({ success: true, data: { id: Number(req.params.id), name } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'มีชื่อช่างนี้อยู่แล้ว' });
    }
    console.error('Error renaming technician:', err);
    res.status(500).json({ error: 'แก้ไขชื่อช่างไม่สำเร็จ' });
  }
});

router.delete('/:id', requireManager, async (req, res) => {
  try {
    const [[existing]] = await pool.query('SELECT id FROM technicians WHERE id = ? AND shop_id = ?', [req.params.id, req.shopId]);
    if (!existing) return res.status(404).json({ error: 'ไม่พบช่างนี้' });
    await trashDelete(pool, { table: 'technicians', id: req.params.id, shopId: req.shopId, user: req.user });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting technician:', err);
    res.status(500).json({ error: 'ลบช่างไม่สำเร็จ' });
  }
});

module.exports = router;
