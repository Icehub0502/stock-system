const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('office'));

async function generateCustomerCode() {
  const [rows] = await pool.execute(
    "SELECT MAX(CAST(SUBSTRING(customer_code, 5) AS UNSIGNED)) AS maxCode FROM customers WHERE customer_code LIKE 'CMM-%'"
  );
  const nextNumber = (rows[0]?.maxCode || 0) + 1;
  return `CMM-${String(nextNumber).padStart(4, '0')}`;
}

router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    let query = 'SELECT id, customer_code, customer_name, phone, created_at, updated_at FROM customers ORDER BY created_at DESC';
    const params = [];

    if (search) {
      query = 'SELECT id, customer_code, customer_name, phone, created_at, updated_at FROM customers WHERE customer_name LIKE ? OR phone LIKE ? OR customer_code LIKE ? ORDER BY created_at DESC';
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    const [rows] = await pool.execute(query, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error fetching customers:', err);
    res.status(500).json({ error: 'โหลดข้อมูลลูกค้าไม่สำเร็จ' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, customer_code, customer_name, phone, created_at, updated_at FROM customers WHERE id = ?',
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบลูกค้า' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('Error fetching customer:', err);
    res.status(500).json({ error: 'โหลดข้อมูลลูกค้าไม่สำเร็จ' });
  }
});

router.post('/', async (req, res) => {
  const { customer_name, phone } = req.body;

  if (!customer_name) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อลูกค้า' });
  }

  try {
    const customer_code = await generateCustomerCode();
    const [result] = await pool.execute(
      'INSERT INTO customers (customer_code, customer_name, phone) VALUES (?, ?, ?)',
      [customer_code, customer_name, phone || null]
    );

    res.status(201).json({
      success: true,
      message: 'เพิ่มลูกค้าสำเร็จ',
      data: { id: result.insertId, customer_code }
    });
  } catch (err) {
    console.error('Error creating customer:', err);
    res.status(500).json({ error: 'สร้างลูกค้าไม่สำเร็จ' });
  }
});

router.put('/:id', async (req, res) => {
  const { customer_name, phone } = req.body;

  if (!customer_name) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อลูกค้า' });
  }

  try {
    const [result] = await pool.execute(
      'UPDATE customers SET customer_name = ?, phone = ? WHERE id = ?',
      [customer_name, phone || null, req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบลูกค้า' });
    }

    res.json({ success: true, message: 'อัปเดตลูกค้าสำเร็จ' });
  } catch (err) {
    console.error('Error updating customer:', err);
    res.status(500).json({ error: 'อัปเดตลูกค้าไม่สำเร็จ' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM customers WHERE id = ?', [req.params.id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบลูกค้า' });
    }

    res.json({ success: true, message: 'ลบลูกค้าสำเร็จ' });
  } catch (err) {
    console.error('Error deleting customer:', err);
    res.status(500).json({ error: 'ลบลูกค้าไม่สำเร็จ' });
  }
});

module.exports = router;
