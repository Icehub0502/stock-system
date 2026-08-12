const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('office'));

// GET /vehicle-models/brands — ยี่ห้อรถทั้งหมดในแคตตาล็อกอ้างอิง เรียงตามลำดับ
// ที่นำเข้ามา (id ต่ำสุดของแต่ละยี่ห้อ) ให้ยี่ห้อที่พบบ่อยขึ้นก่อนตามไฟล์ต้นฉบับ
router.get('/brands', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT brand, MIN(id) AS first_id
       FROM vehicle_models
       GROUP BY brand
       ORDER BY first_id ASC`
    );
    res.json({ success: true, data: rows.map((r) => r.brand) });
  } catch (err) {
    console.error('Error loading vehicle model brands:', err);
    res.status(500).json({ error: 'โหลดรายการยี่ห้อไม่สำเร็จ' });
  }
});

// GET /vehicle-models/models?brand=Toyota — รุ่นรถของยี่ห้อนั้น พร้อม label
// รวมช่วงปี (ใช้ label เดียวกันทั้งตอนแสดงผลและตอนอ้างอิงราคาอะไหล่ กันสะกด
// ไม่ตรงกันระหว่างหน้าคีออสกับหน้ากรอกราคา)
router.get('/models', async (req, res) => {
  const { brand } = req.query;
  if (!brand) return res.status(400).json({ error: 'กรุณาระบุยี่ห้อ' });
  try {
    const [rows] = await pool.execute(
      'SELECT id, model, year_range FROM vehicle_models WHERE brand = ? ORDER BY id ASC',
      [brand]
    );
    const data = rows.map((r) => ({
      model: r.model,
      year_range: r.year_range,
      label: r.year_range ? `${r.model} (${r.year_range})` : r.model,
    }));
    res.json({ success: true, data });
  } catch (err) {
    console.error('Error loading vehicle models:', err);
    res.status(500).json({ error: 'โหลดรายการรุ่นรถไม่สำเร็จ' });
  }
});

module.exports = router;
