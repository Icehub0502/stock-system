const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('office'));

// Generate customer code
async function generateCustomerCode() {
  const [rows] = await pool.execute(
    'SELECT MAX(CAST(SUBSTRING(customer_code, 4) AS UNSIGNED)) as maxCode FROM customers'
  );
  const nextNumber = (rows[0]?.maxCode || 0) + 1;
  return `CM-${String(nextNumber).padStart(4, '0')}`;
}

// POST - Create new customer
router.post('/', authenticate, async (req, res) => {
  const { customer_name, phone } = req.body;

  if (!customer_name) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อลูกค้า' });
  }

  try {
    const customer_code = await generateCustomerCode();

    await pool.execute(
      'INSERT INTO customers (customer_code, customer_name, phone) VALUES (?, ?, ?)',
      [customer_code, customer_name, phone || null]
    );

    res.status(201).json({
      success: true,
      message: 'เพิ่มลูกค้าสำเร็จ',
      customer_code: customer_code
    });
  } catch (err) {
    console.error('Error creating customer:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการเพิ่มลูกค้า' });
  }
});

// GET - Get all customers with optional search
router.get('/', authenticate, async (req, res) => {
  try {
    const { search } = req.query;
    let query = 'SELECT * FROM customers ORDER BY created_at DESC';
    const params = [];

    if (search) {
      query = 'SELECT * FROM customers WHERE customer_name LIKE ? OR phone LIKE ? OR customer_code LIKE ? ORDER BY created_at DESC';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    const [rows] = await pool.execute(query, params);

    res.json({
      success: true,
      data: rows
    });
  } catch (err) {
    console.error('Error fetching customers:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
  }
});

// GET - Get customer by ID
router.get('/:id', authenticate, async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await pool.execute(
      'SELECT * FROM customers WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลลูกค้า' });
    }

    res.json({
      success: true,
      data: rows[0]
    });
  } catch (err) {
    console.error('Error fetching customer:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
  }
});

// PUT - Update customer
router.put('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { customer_name, phone } = req.body;

  if (!customer_name) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อลูกค้า' });
  }

  try {
    const [result] = await pool.execute(
      'UPDATE customers SET customer_name = ?, phone = ? WHERE id = ?',
      [customer_name, phone || null, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลลูกค้า' });
    }

    res.json({
      success: true,
      message: 'อัปเดตข้อมูลลูกค้าสำเร็จ'
    });
  } catch (err) {
    console.error('Error updating customer:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการอัปเดตข้อมูล' });
  }
});

// DELETE - Delete customer
router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.execute(
      'DELETE FROM customers WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลลูกค้า' });
    }

    res.json({
      success: true,
      message: 'ลบข้อมูลลูกค้าสำเร็จ'
    });
  } catch (err) {
    console.error('Error deleting customer:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการลบข้อมูล' });
  }
});

module.exports = router;
