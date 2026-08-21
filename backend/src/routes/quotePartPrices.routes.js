const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('office'));

// GET /quote-parts/brands — ยี่ห้อทั้งหมดที่มีราคาอะไหล่อยู่ (สำหรับ dropdown ขั้นที่ 1)
router.get('/brands', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT DISTINCT brand FROM quote_part_prices WHERE is_active = 1 ORDER BY brand ASC'
    );
    res.json({ success: true, data: rows.map((r) => r.brand) });
  } catch (err) {
    console.error('Error loading quote part brands:', err);
    res.status(500).json({ error: 'โหลดรายการยี่ห้อไม่สำเร็จ' });
  }
});

// GET /quote-parts/models?brand=Honda — รุ่นรถของยี่ห้อนั้น (สำหรับ dropdown ขั้นที่ 2)
router.get('/models', async (req, res) => {
  const { brand } = req.query;
  if (!brand) return res.status(400).json({ error: 'กรุณาระบุยี่ห้อ' });
  try {
    const [rows] = await pool.execute(
      'SELECT DISTINCT model FROM quote_part_prices WHERE is_active = 1 AND brand = ? ORDER BY model ASC',
      [brand]
    );
    res.json({ success: true, data: rows.map((r) => r.model) });
  } catch (err) {
    console.error('Error loading quote part models:', err);
    res.status(500).json({ error: 'โหลดรายการรุ่นรถไม่สำเร็จ' });
  }
});

// GET /quote-parts/parts?brand=Honda&model=BRIO — การ์ดอะไหล่พร้อมราคา/รูป
// สำหรับให้พนักงานเลือกตอนสร้างใบเสนอราคา
router.get('/parts', async (req, res) => {
  const { brand, model } = req.query;
  if (!brand || !model) return res.status(400).json({ error: 'กรุณาระบุยี่ห้อและรุ่นรถ' });
  try {
    const [rows] = await pool.execute(
      `SELECT id, brand, model, part_name, description, price, image_data, needs_price, category
       FROM quote_part_prices
       WHERE is_active = 1 AND brand = ? AND model = ?
       ORDER BY part_name ASC`,
      [brand, model]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error loading quote parts:', err);
    res.status(500).json({ error: 'โหลดรายการอะไหล่ไม่สำเร็จ' });
  }
});

// GET / — รายการทั้งหมดสำหรับหน้าจัดการ (ค้นหา/กรองได้)
router.get('/', async (req, res) => {
  const { search = '', brand = '', model = '' } = req.query;
  try {
    let sql = 'SELECT * FROM quote_part_prices WHERE 1=1';
    const params = [];
    if (search) {
      sql += ' AND (part_name LIKE ? OR description LIKE ? OR brand LIKE ? OR model LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    if (brand) {
      sql += ' AND brand = ?';
      params.push(brand);
    }
    if (model) {
      sql += ' AND model = ?';
      params.push(model);
    }
    sql += ' ORDER BY brand ASC, model ASC, part_name ASC LIMIT 2000';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error loading quote part prices:', err);
    res.status(500).json({ error: 'โหลดรายการราคาอะไหล่ไม่สำเร็จ' });
  }
});

// POST / — เพิ่มรายการราคาอะไหล่ใหม่
router.post('/', async (req, res) => {
  const { brand, model, part_name, description, price, image_data, category } = req.body;
  if (!brand?.trim() || !model?.trim() || !part_name?.trim()) {
    return res.status(400).json({ error: 'กรุณากรอกยี่ห้อ รุ่นรถ และชื่ออะไหล่ให้ครบถ้วน' });
  }
  try {
    const [result] = await pool.execute(
      `INSERT INTO quote_part_prices (brand, model, part_name, description, price, image_data, category)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [brand.trim(), model.trim(), part_name.trim(), description?.trim() || null, Number(price) || 0, image_data || null, category?.trim() || null]
    );
    res.status(201).json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    console.error('Error creating quote part price:', err);
    res.status(500).json({ error: 'เพิ่มรายการราคาอะไหล่ไม่สำเร็จ' });
  }
});

// PUT /:id — แก้ไขรายการ
router.put('/:id', async (req, res) => {
  const { brand, model, part_name, description, price, image_data, is_active } = req.body;
  if (!brand?.trim() || !model?.trim() || !part_name?.trim()) {
    return res.status(400).json({ error: 'กรุณากรอกยี่ห้อ รุ่นรถ และชื่ออะไหล่ให้ครบถ้วน' });
  }
  try {
    // แก้ไข/บันทึกผ่านหน้านี้ = ออฟฟิศตั้งใจยืนยันราคาแล้ว (ไม่ว่าจะเป็นแถวที่พิมพ์
    // เองแต่แรก หรือแถวที่ import_quote_parts_for_all_models.js สร้างราคา 0 ให้ไว้
    // ก่อน) เคลียร์ needs_price ทิ้งเสมอ กันค้างสถานะ "ยังไม่ตั้งราคา" ทั้งที่แก้แล้ว
    const [result] = await pool.execute(
      `UPDATE quote_part_prices
       SET brand = ?, model = ?, part_name = ?, description = ?, price = ?, image_data = ?, is_active = ?, needs_price = 0
       WHERE id = ?`,
      [
        brand.trim(),
        model.trim(),
        part_name.trim(),
        description?.trim() || null,
        Number(price) || 0,
        image_data || null,
        is_active === undefined ? 1 : (is_active ? 1 : 0),
        req.params.id,
      ]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบรายการ' });
    }
    res.json({ success: true, message: 'แก้ไขรายการสำเร็จ' });
  } catch (err) {
    console.error('Error updating quote part price:', err);
    res.status(500).json({ error: 'แก้ไขรายการไม่สำเร็จ' });
  }
});

// DELETE /:id
router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM quote_part_prices WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบรายการ' });
    }
    res.json({ success: true, message: 'ลบรายการสำเร็จ' });
  } catch (err) {
    console.error('Error deleting quote part price:', err);
    res.status(500).json({ error: 'ลบรายการไม่สำเร็จ' });
  }
});

module.exports = router;
