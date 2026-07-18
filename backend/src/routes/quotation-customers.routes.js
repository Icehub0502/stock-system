const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { formatPhone } = require('../utils/parseLineQueueMessage');

// เหตุผลเดียวกับ normalizePhone ใน customers.routes.js — normalize เบอร์โทรก่อน
// บันทึกเสมอ กันเบอร์แบบไม่มีขีดหลุดเข้าฐานจากหน้าเว็บ ทำให้ WHERE phone = ? แบบ
// ตรง ๆ ใน lineWebhook.routes.js หาลูกค้าที่สร้าง/แก้จากหน้าเว็บเจอด้วย
function normalizePhone(phone) {
  if (!phone) return phone || null;
  const digitsOnly = String(phone).replace(/\D/g, '');
  return digitsOnly ? formatPhone(digitsOnly) : phone;
}

const router = express.Router();
router.use(authenticate);
router.use(requireRole('office'));

// Generate customer code
// conn: รับ connection ของ transaction ที่กำลังสร้างลูกค้าอยู่ — ใช้ FOR UPDATE
// ล็อกแถวที่อ่านไว้จนกว่า transaction นั้นจะ commit กัน 2 คำขอสร้างลูกค้าพร้อมกัน
// อ่าน MAX เดิมแล้วได้รหัสลูกค้าซ้ำกัน ไม่มี conn ส่งมาใช้ pool เฉย ๆ ไม่ต้องล็อกอะไร
async function generateCustomerCode(conn = pool) {
  const [rows] = await conn.execute(
    'SELECT MAX(CAST(SUBSTRING(customer_code, 4) AS UNSIGNED)) as maxCode FROM customers FOR UPDATE'
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

  // ใช้ transaction ครอบคุมตั้งแต่อ่านเลขรหัสจนถึง insert เพื่อให้ FOR UPDATE ใน
  // generateCustomerCode ล็อกได้จริง (pool.execute เฉย ๆ แบบเดิม autocommit
  // แยกกันทันที ล็อกที่ได้จะถูกปล่อยไปก่อน insert จะรันด้วยซ้ำ)
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const customer_code = await generateCustomerCode(conn);

    await conn.execute(
      'INSERT INTO customers (customer_code, customer_name, phone) VALUES (?, ?, ?)',
      [customer_code, customer_name, normalizePhone(phone)]
    );

    await conn.commit();

    res.status(201).json({
      success: true,
      message: 'เพิ่มลูกค้าสำเร็จ',
      customer_code: customer_code
    });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackErr) { console.error('Rollback error:', rollbackErr); }
    }
    console.error('Error creating customer:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการเพิ่มลูกค้า' });
  } finally {
    if (conn) conn.release();
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
      [customer_name, normalizePhone(phone), id]
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
