const express = require('express');
const QRCode = require('qrcode');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// list all racks (any logged-in role) - ใช้แสดงในตาราง CRUD ของออฟฟิส
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM racks ORDER BY model_code');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดข้อมูลไม่สำเร็จ' });
  }
});

// lookup by model_code (ใช้ทันทีหลังสแกน QR), ทุก role เรียกได้
router.get('/lookup/:code', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM racks WHERE model_code = ?', [req.params.code]);
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบรหัสรุ่นนี้ในระบบ' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
});

// get one rack by id
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM racks WHERE id = ?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบรายการ' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาด' });
  }
});

// QR code image (PNG data URL) สำหรับพิมพ์ป้าย
router.get('/:id/qrcode', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM racks WHERE id = ?', [req.params.id]);
    const rack = rows[0];
    if (!rack) return res.status(404).json({ error: 'ไม่พบรายการ' });
    const dataUrl = await QRCode.toDataURL(rack.model_code, { width: 300, margin: 1 });
    res.json({ model_code: rack.model_code, name: rack.name, qrcode: dataUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'สร้าง QR code ไม่สำเร็จ' });
  }
});

// ----- เฉพาะ office: CRUD เต็มรูปแบบ -----
router.post('/', requireRole('office'), async (req, res) => {
  const { model_code, name, stock_qty = 0, min_stock = 1 } = req.body || {};
  if (!model_code || !name) {
    return res.status(400).json({ error: 'กรุณากรอกรหัสรุ่นและรายการแร็ค' });
  }
  try {
    const [result] = await pool.execute(
      'INSERT INTO racks (model_code, name, stock_qty, min_stock) VALUES (?, ?, ?, ?)',
      [String(model_code).trim(), String(name).trim(), Number(stock_qty), Number(min_stock)]
    );
    const [rows] = await pool.execute('SELECT * FROM racks WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'รหัสรุ่นนี้มีอยู่ในระบบแล้ว' });
    }
    console.error(err);
    res.status(500).json({ error: 'เพิ่มรายการไม่สำเร็จ' });
  }
});

router.put('/:id', requireRole('office'), async (req, res) => {
  try {
    const [existingRows] = await pool.execute('SELECT * FROM racks WHERE id = ?', [req.params.id]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'ไม่พบรายการ' });

    const {
      model_code = existing.model_code,
      name = existing.name,
      stock_qty = existing.stock_qty,
      min_stock = existing.min_stock
    } = req.body || {};

    await pool.execute(
      'UPDATE racks SET model_code = ?, name = ?, stock_qty = ?, min_stock = ? WHERE id = ?',
      [String(model_code).trim(), String(name).trim(), Number(stock_qty), Number(min_stock), req.params.id]
    );
    const [rows] = await pool.execute('SELECT * FROM racks WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'รหัสรุ่นนี้มีอยู่ในระบบแล้ว' });
    }
    console.error(err);
    res.status(500).json({ error: 'แก้ไขรายการไม่สำเร็จ' });
  }
});

router.delete('/:id', requireRole('office'), async (req, res) => {
  try {
    const [existingRows] = await pool.execute('SELECT * FROM racks WHERE id = ?', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'ไม่พบรายการ' });
    await pool.execute('DELETE FROM racks WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ลบรายการไม่สำเร็จ' });
  }
});

module.exports = router;
