const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { formatPhone } = require('../utils/parseLineQueueMessage');
// pushQuotationUpdate: ดันข้อมูลอัปเดตกลับเข้ากลุ่มไลน์ของร้าน — ใช้ตอนแก้ไขลูกค้า
// ผ่านหน้า Customer Management ดู PUT /:id ด้านล่าง
const { pushQuotationUpdate } = require('./lineWebhook.routes');

// normalize เบอร์โทรก่อนบันทึกเสมอ (ตัดอักขระอื่นออก ใส่ขีดรูปแบบเดียวกับที่บอทไลน์
// ใช้) กันเบอร์แบบไม่มีขีดหลุดเข้าฐานจากหน้าเว็บ — ทำให้ WHERE phone = ? แบบตรง ๆ ใน
// lineWebhook.routes.js หาลูกค้าที่สร้าง/แก้จากหน้าเว็บเจอด้วย ไม่สร้างซ้ำซ้อน
function normalizePhone(phone) {
  if (!phone) return phone || null;
  const digitsOnly = String(phone).replace(/\D/g, '');
  return digitsOnly ? formatPhone(digitsOnly) : phone;
}

const router = express.Router();
router.use(authenticate);
router.use(requireRole('office'));

// conn: รับ connection ของ transaction ที่กำลังสร้างลูกค้าอยู่ — ใช้ FOR UPDATE
// ล็อกแถวที่อ่านไว้จนกว่า transaction นั้นจะ commit กัน 2 คำขอสร้างลูกค้าพร้อมกัน
// อ่าน MAX เดิมแล้วได้รหัสลูกค้าซ้ำกัน (ชนกับ UNIQUE ที่ customer_code แล้ว rollback
// ทั้งฟอร์มทิ้งไปเฉย ๆ) ไม่มี conn ส่งมาใช้ pool เฉย ๆ ไม่ต้องล็อกอะไร
async function generateCustomerCode(conn = pool) {
  const [rows] = await conn.execute(
    "SELECT MAX(CAST(SUBSTRING(customer_code, 5) AS UNSIGNED)) AS maxCode FROM customers WHERE customer_code LIKE 'CMM-%' FOR UPDATE"
  );
  const nextNumber = (rows[0]?.maxCode || 0) + 1;
  return `CMM-${String(nextNumber).padStart(4, '0')}`;
}

router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    // LIMIT กันดึงทั้งตารางเวลาลูกค้าเยอะขึ้นเรื่อย ๆ — หน้า CustomerManagementPage
    // ค้นหาผ่าน search (server-side LIKE) เสมออยู่แล้ว ไม่ได้กรอง/รวมข้อมูลฝั่ง
    // client จากทั้งชุด จึงตัดด้วย LIMIT ตรงนี้ได้อย่างปลอดภัย (เหมือน receipts.routes.js)
    let query = 'SELECT id, customer_code, customer_name, phone, created_at, updated_at FROM customers ORDER BY created_at DESC LIMIT 200';
    const params = [];

    if (search) {
      query = 'SELECT id, customer_code, customer_name, phone, created_at, updated_at FROM customers WHERE customer_name LIKE ? OR phone LIKE ? OR customer_code LIKE ? ORDER BY created_at DESC LIMIT 200';
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
  const customer_name = req.body.customer_name?.toString().trim();
  const { phone } = req.body;

  if (!customer_name) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อลูกค้า' });
  }

  // ใช้ transaction ครอบคุมตั้งแต่อ่านเลขรหัสจนถึง insert เพื่อให้ FOR UPDATE ใน
  // generateCustomerCode ล็อกได้จริง (ถ้าใช้ pool.execute เฉย ๆ แบบเดิม แต่ละ
  // query จะ autocommit แยกกันทันที ล็อกที่ได้จะถูกปล่อยไปก่อนที่ query insert
  // จะรันด้วยซ้ำ ไม่ช่วยกันคำขอพร้อมกันได้จริง)
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const customer_code = await generateCustomerCode(conn);
    const [result] = await conn.execute(
      'INSERT INTO customers (customer_code, customer_name, phone) VALUES (?, ?, ?)',
      [customer_code, customer_name, normalizePhone(phone)]
    );

    await conn.commit();

    res.status(201).json({
      success: true,
      message: 'เพิ่มลูกค้าสำเร็จ',
      data: { id: result.insertId, customer_code }
    });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackErr) { console.error('Rollback error:', rollbackErr); }
    }
    console.error('Error creating customer:', err);
    res.status(500).json({ error: 'สร้างลูกค้าไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

router.put('/:id', async (req, res) => {
  const customer_name = req.body.customer_name?.toString().trim();
  const { phone } = req.body;

  if (!customer_name) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อลูกค้า' });
  }

  try {
    const [result] = await pool.execute(
      'UPDATE customers SET customer_name = ?, phone = ? WHERE id = ?',
      [customer_name, normalizePhone(phone), req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบลูกค้า' });
    }

    // แก้ไขลูกค้าคนนี้แล้ว — หาใบเสนอราคาที่มาจากไลน์+ยังเปิดอยู่ทุกใบของลูกค้าคนนี้
    // แล้ว push ข้อมูลอัปเดตกลับเข้ากลุ่มไลน์ทีละใบ (mirror ของ PUT /vehicles/:id —
    // ดูคำอธิบายเต็มที่นั่น) best-effort ไม่กระทบผลลัพธ์การบันทึกลูกค้าที่สำเร็จไปแล้ว
    try {
      const [openQuotations] = await pool.execute(
        'SELECT id FROM quotations WHERE customer_id = ? AND queue_no IS NOT NULL AND closed_at IS NULL',
        [req.params.id]
      );
      for (const q of openQuotations) {
        await pushQuotationUpdate(q.id);
      }
    } catch (err) {
      console.error('Error pushing quotation update to LINE after customer edit:', err);
    }

    res.json({ success: true, message: 'อัปเดตลูกค้าสำเร็จ' });
  } catch (err) {
    console.error('Error updating customer:', err);
    res.status(500).json({ error: 'อัปเดตลูกค้าไม่สำเร็จ' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    // vehicles.customer_id เป็น ON DELETE CASCADE — ถ้าไม่เช็คก่อน รถของลูกค้าคนนี้
    // จะหายไปด้วยแบบเงียบ ๆ ไม่มีคำเตือนเลย (ต่างจากกรณีมีใบเสนอราคา/ใบเสร็จผูกอยู่ที่
    // อย่างน้อยยัง error ชัดเจนจาก FK constraint) กันไว้ก่อนให้ต้องลบรถออกเองก่อน
    const [[{ vehicleCount }]] = await pool.query(
      'SELECT COUNT(*) AS vehicleCount FROM vehicles WHERE customer_id = ?',
      [req.params.id]
    );
    if (vehicleCount > 0) {
      return res.status(409).json({ error: `ลูกค้ารายนี้มีรถผูกอยู่ ${vehicleCount} คัน กรุณาลบข้อมูลรถออกก่อน` });
    }

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
