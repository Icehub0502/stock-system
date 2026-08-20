const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { formatPhone } = require('../utils/parseLineQueueMessage');
const { emitReceiptEvent, emitQuotationEvent } = require('../realtime');

// ทำให้ตรงรูปแบบเดียวกับที่ customers.routes.js ใช้ กันเบอร์ที่พิมพ์ไม่มีขีดตรงนี้
// ไปหลุดจากการค้นหาของบอทไลน์ (lineWebhook.routes.js เทียบแบบ phone = ? ตรง ๆ)
function normalizePhone(phone) {
  if (!phone) return phone;
  const digitsOnly = phone.replace(/\D/g, '');
  return digitsOnly ? formatPhone(digitsOnly) : phone;
}

// รายการที่มีชื่อ/service_item_id จริง แต่จำนวนกรอกมาไม่ใช่ตัวเลขบวก (เช่น พิมพ์
// ตัวอักษรผิดในช่องจำนวน กลายเป็น NaN) — การกรอง validItems ด้านล่างจะดรอปรายการ
// แบบนี้ทิ้งเงียบ ๆ ถ้ายังมีรายการอื่นที่ถูกต้องเหลืออยู่ (ไม่ครบ 0 รายการ เลยไม่โดน
// เช็ค "กรุณาเพิ่มรายการ" ด้านล่าง) ต้องเช็คแยกก่อนเพื่อตอบ 400 ให้แก้ไขแทน
function findInvalidItems(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => {
    const productName = item.product_name_snapshot?.toString().trim();
    const hasService = Boolean(item.service_item_id);
    if (!productName && !hasService) return false;
    const qty = Number(item.qty || 0);
    return !(qty > 0);
  });
}

const router = express.Router();
router.use(authenticate);
router.use(requireRole('office'));

function formatDate(date) {
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear() + 543).slice(-2);
  return `${yy}${mm}${dd}`;
}

// conn: รับ connection ของ transaction ที่กำลังสร้าง/แก้ไขบิลอยู่ (ถ้ามี) — ใช้
// FOR UPDATE ล็อกแถวที่อ่านไว้จนกว่า transaction นั้นจะ commit กัน 2 คำขอพร้อมกัน
// อ่าน MAX เดิมแล้วได้เลขบิลซ้ำกัน ไม่มี conn ส่งมา (route /next-no ที่แค่พรีวิว
// เลขไว้ดู ไม่ได้ insert จริง) ใช้ pool เฉย ๆ ไม่ต้องล็อกอะไร
async function generateReceiptNo(conn = pool) {
  const today = new Date();
  const dateStr = formatDate(today);
  const [rows] = await conn.execute(
    'SELECT MAX(CAST(SUBSTRING(receipt_no, -3) AS UNSIGNED)) AS maxNo FROM receipts WHERE receipt_no LIKE ? FOR UPDATE',
    [`RC${dateStr}%`]
  );
  const nextNumber = (rows[0]?.maxNo || 0) + 1;
  return `RC${dateStr}${String(nextNumber).padStart(3, '0')}`;
}

// เหตุผลเดียวกับ generateReceiptNo ด้านบน
async function generateCustomerCode(conn = pool) {
  const [rows] = await conn.execute(
    "SELECT MAX(CAST(SUBSTRING(customer_code, 5) AS UNSIGNED)) AS maxCode FROM customers WHERE customer_code LIKE 'CMM-%' FOR UPDATE"
  );
  const nextNumber = (rows[0]?.maxCode || 0) + 1;
  return `CMM-${String(nextNumber).padStart(4, '0')}`;
}

router.get('/next-no', async (req, res) => {
  try {
    const receipt_no = await generateReceiptNo();
    res.json({ success: true, receipt_no });
  } catch (err) {
    console.error('Error generating receipt no:', err);
    res.status(500).json({ error: 'ไม่สามารถสร้างเลขที่บิลได้' });
  }
});

router.get('/customers', async (req, res) => {
  try {
    const { search } = req.query;
    let query = 'SELECT id, customer_code, customer_name, phone FROM customers ORDER BY created_at DESC LIMIT 50';
    const params = [];
    if (search) {
      query = 'SELECT id, customer_code, customer_name, phone FROM customers WHERE customer_name LIKE ? OR phone LIKE ? OR customer_code LIKE ? ORDER BY created_at DESC LIMIT 50';
      const term = `%${search}%`;
      params.push(term, term, term);
    }
    const [rows] = await pool.execute(query, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error searching customers:', err);
    res.status(500).json({ error: 'โหลดลูกค้าไม่สำเร็จ' });
  }
});

router.get('/customers/:customerId/vehicles', async (req, res) => {
  try {
    const { customerId } = req.params;
    const [rows] = await pool.execute(
      'SELECT id, brand, model, color, license_plate, mileage FROM vehicles WHERE customer_id = ? ORDER BY created_at DESC',
      [customerId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error loading vehicles:', err);
    res.status(500).json({ error: 'โหลดข้อมูลรถไม่สำเร็จ' });
  }
});

router.get('/service-items', async (req, res) => {
  try {
    const { search } = req.query;
    let query = `SELECT s.id, s.category, s.product_name, w.warranty_name, w.warranty_year, w.warranty_month, w.warranty_km
                 FROM service_items s
                 LEFT JOIN warranties w ON s.warranty_id = w.id
                 WHERE s.is_active = 1`;
    const params = [];
    if (search) {
      query += ' AND (s.product_name LIKE ? OR s.category LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term);
    }
    query += ' ORDER BY s.category ASC, s.product_name ASC LIMIT 100';
    const [rows] = await pool.execute(query, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error loading service items:', err);
    res.status(500).json({ error: 'โหลดรายการสินค้า/บริการไม่สำเร็จ' });
  }
});

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      // ใบเสร็จที่เกิดจากปุ่ม "อนุมัติ" บนใบเสนอราคาจะถูกสร้างทันทีเพื่อพิมพ์เอกสาร
      // ให้ลูกค้า แต่ไม่ได้แปลว่าจ่ายเงินแล้ว — ต้องเช็ค quotations.closed_at (ตั้งค่า
      // เฉพาะตอนบอทไลน์ยืนยันจ่ายเงินจริง) เพื่อรู้สถานะที่แท้จริง ใบที่ไม่มี
      // ใบเสนอราคาต้นทาง (สร้างตรงจากปุ่ม "สร้างบิลใหม่" หน้าเว็บ) ถือว่าจ่ายแล้วเสมอ
      // เพราะเป็นการออกบิลหน้าเคาน์เตอร์ตอนรับเงิน
      `SELECT r.id, r.receipt_no, r.receipt_date, r.total_amount, r.remark, r.printed_at,
              c.customer_name, c.customer_code,
              v.brand, v.model, v.color, v.license_plate,
              (q.id IS NULL OR q.closed_at IS NOT NULL) AS is_paid
       FROM receipts r
       JOIN customers c ON r.customer_id = c.id
       LEFT JOIN vehicles v ON r.vehicle_id = v.id
       LEFT JOIN quotations q ON q.converted_receipt_id = r.id
       ORDER BY r.receipt_date DESC, r.created_at DESC
       LIMIT 200`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error loading receipts:', err);
    res.status(500).json({ error: 'โหลดบิลไม่สำเร็จ' });
  }
});

router.patch('/:id/mark-printed', async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute(
      'UPDATE receipts SET printed_at = NOW() WHERE id = ?',
      [id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบบิลนี้' });
    }
    const [[row]] = await pool.execute('SELECT printed_at FROM receipts WHERE id = ?', [id]);
    emitReceiptEvent('receipt:updated', { receiptId: Number(id), actorId: req.user.id });
    res.json({ success: true, printed_at: row.printed_at });
  } catch (err) {
    console.error('Error marking receipt as printed:', err);
    res.status(500).json({ error: 'บันทึกสถานะการพิมพ์ไม่สำเร็จ' });
  }
});

router.get('/by-date', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ error: 'กรุณาระบุวันที่' });
    }
    // receipt_date เป็นคอลัมน์ DATE อยู่แล้ว (ไม่ใช่ DATETIME) เทียบตรง ๆ ได้เลย ไม่ต้อง
    // ครอบด้วย DATE() — การครอบฟังก์ชันบนคอลัมน์ทำให้ index บน receipt_date ใช้ไม่ได้
    const [rows] = await pool.execute(
      `SELECT r.id, r.receipt_no, r.receipt_date, r.total_amount, r.payment_method, r.technician_name, r.remark,
              c.customer_name, c.customer_code,
              v.brand, v.model, v.license_plate,
              (SELECT GROUP_CONCAT(ri.product_name_snapshot SEPARATOR ', ')
                 FROM receipt_items ri WHERE ri.receipt_id = r.id) AS item_summary
       FROM receipts r
       JOIN customers c ON r.customer_id = c.id
       LEFT JOIN vehicles v ON r.vehicle_id = v.id
       WHERE r.receipt_date = ?
       ORDER BY r.created_at DESC`,
      [date]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error loading receipts by date:', err);
    res.status(500).json({ error: 'โหลดรายการบิลของวันนี้ไม่สำเร็จ' });
  }
});

router.patch('/:id/meta', async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_method, technician_name, remark, total_amount } = req.body || {};

    // total_amount is optional here — the daily summary page lets office
    // manually override it (e.g. a late discount), but most callers
    // (payment method / technician / remark edits) don't send it at all,
    // and must not accidentally reset it to 0.
    const setTotal = total_amount !== undefined && total_amount !== null && total_amount !== '';
    const sql = setTotal
      ? 'UPDATE receipts SET payment_method = ?, technician_name = ?, remark = ?, total_amount = ? WHERE id = ?'
      : 'UPDATE receipts SET payment_method = ?, technician_name = ?, remark = ? WHERE id = ?';
    const params = setTotal
      ? [payment_method || null, technician_name || null, remark || null, Number(total_amount), id]
      : [payment_method || null, technician_name || null, remark || null, id];

    const [result] = await pool.execute(sql, params);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบบิลนี้' });
    }
    emitReceiptEvent('receipt:updated', { receiptId: Number(id), actorId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating receipt meta:', err);
    res.status(500).json({ error: 'บันทึกข้อมูลไม่สำเร็จ' });
  }
});

router.patch('/:id/date', async (req, res) => {
  try {
    const { id } = req.params;
    const { receipt_date } = req.body || {};
    if (!receipt_date) {
      return res.status(400).json({ error: 'กรุณาระบุวันที่' });
    }
    const [result] = await pool.execute(
      'UPDATE receipts SET receipt_date = ? WHERE id = ?',
      [receipt_date, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบบิลนี้' });
    }
    emitReceiptEvent('receipt:updated', { receiptId: Number(id), actorId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    console.error('Error moving receipt date:', err);
    res.status(500).json({ error: 'ย้ายวันที่ไม่สำเร็จ' });
  }
});

router.get('/top-products', async (req, res) => {
  try {
    // LIMIT/INTERVAL as bound placeholders (`?`) trip up some MySQL/MariaDB
    // versions (works on XAMPP's bundled MySQL, 500s on plain `apt install
    // mysql-server`) — safe to inline here since both are coerced through
    // Number(...) above, never raw user input reaching the SQL string.
    const days = Number(req.query.days) > 0 ? Math.floor(Number(req.query.days)) : 30;
    const limit = Number(req.query.limit) > 0 ? Math.floor(Number(req.query.limit)) : 5;
    const [rows] = await pool.execute(
      `SELECT ri.product_name_snapshot AS product_name,
              SUM(ri.qty) AS total_qty,
              COUNT(DISTINCT ri.receipt_id) AS bill_count
       FROM receipt_items ri
       JOIN receipts r ON r.id = ri.receipt_id
       WHERE r.receipt_date >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)
         AND ri.product_name_snapshot IS NOT NULL AND ri.product_name_snapshot != ''
         AND ri.product_name_snapshot NOT LIKE '%ค่าแรง%'
       GROUP BY ri.product_name_snapshot
       ORDER BY total_qty DESC
       LIMIT ${limit}`
    );
    res.json({ success: true, data: rows, days });
  } catch (err) {
    console.error('Error loading top products:', err);
    res.status(500).json({ error: 'โหลดสินค้าขายดีไม่สำเร็จ' });
  }
});

router.get('/top-vehicle-models', async (req, res) => {
  try {
    const limit = Number(req.query.limit) > 0 ? Math.floor(Number(req.query.limit)) : 10;
    const [rows] = await pool.execute(
      `SELECT v.brand, v.model,
              COUNT(*) AS visit_count,
              COUNT(DISTINCT r.customer_id) AS customer_count
       FROM receipts r
       JOIN vehicles v ON v.id = r.vehicle_id
       GROUP BY v.brand, v.model
       ORDER BY visit_count DESC
       LIMIT ${limit}`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error loading top vehicle models:', err);
    res.status(500).json({ error: 'โหลดอันดับรถที่เข้ามาทำบ่อยไม่สำเร็จ' });
  }
});

router.get('/top-customers', async (req, res) => {
  try {
    const limit = Number(req.query.limit) > 0 ? Math.floor(Number(req.query.limit)) : 10;
    const [rows] = await pool.execute(
      `SELECT c.id AS customer_id, c.customer_name, c.customer_code,
              COUNT(*) AS bill_count,
              SUM(r.total_amount) AS total_spent
       FROM receipts r
       JOIN customers c ON c.id = r.customer_id
       GROUP BY c.id, c.customer_name, c.customer_code
       ORDER BY total_spent DESC
       LIMIT ${limit}`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error loading top customers:', err);
    res.status(500).json({ error: 'โหลดอันดับลูกค้าไม่สำเร็จ' });
  }
});

router.get('/daily-summary', async (req, res) => {
  try {
    // ไม่ใส่ LIMIT อีกต่อไป — หน้าสรุปยอดฝั่งเว็บเก็บเดือนเก่าไว้เป็น "แฟ้ม" ย้อนหลัง
    // ได้ไม่จำกัด (พับเก็บ ไม่ได้ลบทิ้ง) เดิม LIMIT 365 ตัดข้อมูลของปีก่อนหน้าออกไป
    const [rows] = await pool.execute(
      `SELECT DATE(receipt_date) AS date,
              COUNT(*) AS bill_count,
              COUNT(DISTINCT customer_id) AS customer_count,
              SUM(total_amount) AS total_revenue
       FROM receipts
       GROUP BY DATE(receipt_date)
       ORDER BY date DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error loading daily summary:', err);
    res.status(500).json({ error: 'โหลดสรุปยอดรายวันไม่สำเร็จ' });
  }
});

// สรุปยอดรายเดือน — ใช้แสดงหัวข้อ "แฟ้ม" ของแต่ละเดือนในหน้าสรุปยอด (จำนวนบิล/
// ลูกค้า/ยอดขายรวมของทั้งเดือน) ต้องคำนวณ customer_count ที่นี่แยกจาก daily-summary
// เพราะเอาผลรวมของแต่ละวันมาบวกกันไม่ได้ (ลูกค้าคนเดียวมาหลายวันในเดือนเดียวกันจะถูก
// นับซ้ำ) — COUNT(DISTINCT customer_id) ต้อง group ระดับเดือนตรง ๆ เท่านั้น
router.get('/monthly-summary', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT DATE_FORMAT(receipt_date, '%Y-%m-01') AS month,
              COUNT(*) AS bill_count,
              COUNT(DISTINCT customer_id) AS customer_count,
              SUM(total_amount) AS total_revenue
       FROM receipts
       GROUP BY DATE_FORMAT(receipt_date, '%Y-%m-01')
       ORDER BY month DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error loading monthly summary:', err);
    res.status(500).json({ error: 'โหลดสรุปยอดรายเดือนไม่สำเร็จ' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [[receipt]] = await pool.execute(
      `SELECT r.*, c.customer_name, c.customer_code, c.phone,
              v.brand, v.model, v.color, v.license_plate, v.mileage AS vehicle_mileage
       FROM receipts r
       JOIN customers c ON r.customer_id = c.id
       LEFT JOIN vehicles v ON r.vehicle_id = v.id
       WHERE r.id = ?`,
      [id]
    );

    if (!receipt) {
      return res.status(404).json({ error: 'ไม่พบบิลนี้' });
    }

    const [items] = await pool.execute(
      `SELECT ri.*, s.product_name AS service_item_name
       FROM receipt_items ri
       LEFT JOIN service_items s ON s.id = ri.service_item_id
       WHERE ri.receipt_id = ?
       ORDER BY ri.id ASC`,
      [id]
    );

    res.json({ success: true, data: { ...receipt, items } });
  } catch (err) {
    console.error('Error loading receipt details:', err);
    res.status(500).json({ error: 'โหลดรายละเอียดบิลไม่สำเร็จ' });
  }
});

router.post('/', async (req, res) => {
  const { customer_id, newCustomer, vehicle_id, receipt_date, mileage, remark, payment_method, technician_name, items, newVehicle } = req.body;
  const toNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  let selectedCustomerId = customer_id ? toNumber(customer_id) : null;
  let selectedVehicleId = vehicle_id ? toNumber(vehicle_id) : null;

  const formatValidation = (errs) => ({ success: false, errors: errs.map(([field, msg]) => ({ field, message: msg })) });

  if ((!selectedCustomerId && (!newCustomer || !newCustomer.customer_name)) || !receipt_date || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json(formatValidation([['general', 'กรุณากรอกข้อมูลบิลให้ครบถ้วน']]));
  }

  const invalidItems = findInvalidItems(items);
  if (invalidItems.length > 0) {
    return res.status(400).json(formatValidation([['items', `จำนวนของรายการ "${invalidItems[0].product_name_snapshot || '-'}" ไม่ถูกต้อง กรุณาตรวจสอบ`]]));
  }

  const validItems = Array.isArray(items)
    ? items.filter((item) => {
        const productName = item.product_name_snapshot?.toString().trim();
        const hasName = Boolean(productName);
        const hasService = Boolean(item.service_item_id);
        const qty = Number(item.qty || 0);
        // price can be negative (a discount line), zero, or blank (a
        // set-expanded component already covered by the set's combined
        // price) — only a missing name/service or a non-positive qty is
        // invalid. A blank price is coerced to 0 below, not dropped.
        return (hasName || hasService) && qty > 0;
      })
    : [];

  if (validItems.length === 0) {
    return res.status(400).json(formatValidation([['items', 'กรุณาเพิ่มรายการสินค้า/บริการอย่างน้อยหนึ่งรายการ']]));
  }

  const normalizedItems = validItems.map((item) => ({
    service_item_id: item.service_item_id || null,
    product_name_snapshot: item.product_name_snapshot ? item.product_name_snapshot.toString().trim() : null,
    qty: Number(item.qty || 0),
    price: Number(item.price || 0),
    warranty_name: item.warranty_name || null,
    warranty_year: Number(item.warranty_year || 0),
    warranty_month: Number(item.warranty_month || 0),
    warranty_km: Number(item.warranty_km || 0),
  }));

  if (normalizedItems.some((item) => !item.product_name_snapshot || item.qty <= 0)) {
    return res.status(400).json(formatValidation([['items', 'กรุณากรอกข้อมูลรายการสินค้า/บริการให้ครบถ้วน']]));
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    if (!selectedCustomerId) {
      const { customer_name, phone } = newCustomer;
      const normalizedNewPhone = normalizePhone(phone);
      // เช็คเบอร์ซ้ำก่อนสร้างลูกค้าใหม่ (เหมือนที่บอทไลน์ทำ) — กันสร้างลูกค้าซ้ำซ้อน
      // ถ้าเบอร์นี้เคยมีอยู่แล้วในระบบ (เช่น เคยสร้างผ่านไลน์มาก่อน) ใช้คนเดิมแทน
      const [existingByPhone] = normalizedNewPhone
        ? await conn.execute('SELECT id FROM customers WHERE phone = ? LIMIT 1', [normalizedNewPhone])
        : [[]];
      if (existingByPhone.length > 0) {
        selectedCustomerId = existingByPhone[0].id;
      } else {
        const customerCode = await generateCustomerCode(conn);
        const [customerResult] = await conn.execute(
          `INSERT INTO customers (customer_code, customer_name, phone) VALUES (?, ?, ?)`,
          [customerCode, customer_name, normalizedNewPhone]
        );
        selectedCustomerId = customerResult.insertId;
      }
    } else {
      const [customerRows] = await conn.execute('SELECT id FROM customers WHERE id = ?', [selectedCustomerId]);
      if (customerRows.length === 0) {
        await conn.rollback();
        return res.status(400).json(formatValidation([['customer_id', 'ไม่พบลูกค้าที่เลือก']]));
      }
    }

    if (!selectedVehicleId) {
      if (!newVehicle || !newVehicle.brand || !newVehicle.model) {
        await conn.rollback();
        return res.status(400).json({ error: 'กรุณาเลือกหรือกรอกข้อมูลรถ' });
      }
      const [vehicleResult] = await conn.execute(
        `INSERT INTO vehicles (customer_id, brand, model, color, license_plate, mileage)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [selectedCustomerId, newVehicle.brand, newVehicle.model, newVehicle.color || null, newVehicle.license_plate || null, Number(mileage) || 0]
      );
      selectedVehicleId = vehicleResult.insertId;
    }
    else {
      const [vehicleRows] = await conn.execute(
        'SELECT id FROM vehicles WHERE id = ? AND customer_id = ?',
        [selectedVehicleId, selectedCustomerId]
      );
      if (vehicleRows.length === 0) {
        await conn.rollback();
        return res.status(400).json(formatValidation([['vehicle_id', 'ไม่พบรถที่เลือกสำหรับลูกค้านี้']]));
      }
    }

    const receipt_no = await generateReceiptNo(conn);
    const total_amount = normalizedItems.reduce((sum, item) => sum + item.qty * item.price, 0);

    const [receiptResult] = await conn.execute(
      `INSERT INTO receipts (receipt_no, receipt_date, customer_id, vehicle_id, mileage, remark, payment_method, technician_name, total_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [receipt_no, receipt_date, selectedCustomerId, selectedVehicleId, Number(mileage) || 0, remark || null, payment_method || null, technician_name || null, total_amount]
    );

    const receiptId = receiptResult.insertId;
    for (const item of normalizedItems) {
      await conn.execute(
        `INSERT INTO receipt_items
         (receipt_id, service_item_id, product_name_snapshot, qty, price, amount, warranty_name, warranty_year, warranty_month, warranty_km)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          receiptId,
          item.service_item_id,
          item.product_name_snapshot,
          item.qty,
          item.price,
          item.qty * item.price,
          item.warranty_name,
          item.warranty_year,
          item.warranty_month,
          item.warranty_km
        ]
      );
    }

    await conn.commit();
    emitReceiptEvent('receipt:created', { receiptId, actorId: req.user.id });
    res.status(201).json({ success: true, receipt_id: receiptId, receipt_no });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackErr) { console.error('Rollback error:', rollbackErr); }
    }
    console.error('Error creating receipt:', err);
    res.status(500).json({ success: false, error: 'สร้างบิลไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

router.put('/:id', async (req, res) => {
  const receiptId = Number(req.params.id);
  const { customer_id, newCustomer, vehicle_id, receipt_date, mileage, remark, payment_method, technician_name, items, newVehicle, deposit_amount, deposit_date } = req.body;
  const toNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  let selectedCustomerId = customer_id ? toNumber(customer_id) : null;
  let selectedVehicleId = vehicle_id ? toNumber(vehicle_id) : null;

  const formatValidation = (errs) => ({ success: false, errors: errs.map(([field, msg]) => ({ field, message: msg })) });

  if (!receiptId) {
    return res.status(400).json(formatValidation([['general', 'รหัสใบเสร็จไม่ถูกต้อง']]));
  }

  if ((!selectedCustomerId && (!newCustomer || !newCustomer.customer_name)) || !receipt_date || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json(formatValidation([['general', 'กรุณากรอกข้อมูลบิลให้ครบถ้วน']]));
  }

  const invalidItems = findInvalidItems(items);
  if (invalidItems.length > 0) {
    return res.status(400).json(formatValidation([['items', `จำนวนของรายการ "${invalidItems[0].product_name_snapshot || '-'}" ไม่ถูกต้อง กรุณาตรวจสอบ`]]));
  }

  const validItems = Array.isArray(items)
    ? items.filter((item) => {
        const productName = item.product_name_snapshot?.toString().trim();
        const hasService = Boolean(item.service_item_id);
        const qty = Number(item.qty || 0);
        // price can be negative (a discount line), zero, or blank (a
        // set-expanded component already covered by the set's combined
        // price) — only a missing name/service or a non-positive qty is
        // invalid. A blank price is coerced to 0 below, not dropped.
        return (productName || hasService) && qty > 0;
      })
    : [];

  if (validItems.length === 0) {
    return res.status(400).json(formatValidation([['items', 'กรุณาเพิ่มรายการสินค้า/บริการอย่างน้อยหนึ่งรายการ']]));
  }

  const normalizedItems = validItems.map((item) => ({
    service_item_id: item.service_item_id || null,
    product_name_snapshot: item.product_name_snapshot ? item.product_name_snapshot.toString().trim() : null,
    qty: Number(item.qty || 0),
    price: Number(item.price || 0),
    warranty_name: item.warranty_name || null,
    warranty_year: Number(item.warranty_year || 0),
    warranty_month: Number(item.warranty_month || 0),
    warranty_km: Number(item.warranty_km || 0),
  }));

  if (normalizedItems.some((item) => !item.product_name_snapshot || item.qty <= 0)) {
    return res.status(400).json(formatValidation([['items', 'กรุณากรอกข้อมูลรายการสินค้า/บริการให้ครบถ้วน']]));
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [receiptRows] = await conn.execute('SELECT id, deposit_amount, deposit_date FROM receipts WHERE id = ?', [receiptId]);
    if (receiptRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบบิลนี้' });
    }
    const existingReceipt = receiptRows[0];

    // มัดจำ: ไม่ส่ง field มาเลย (ฟอร์มเก่า/ไม่ได้แตะช่องนี้) = คงค่าเดิมไว้ ไม่ทับด้วย
    // null ทิ้ง — ส่งมาชัดเจน (แม้จะเป็นค่าว่าง/null) = ตั้งใจล้าง/แก้ไขจริง (เหมือน
    // จุดเดียวกันใน quotations.routes.js PUT /:id)
    const depositAmount = deposit_amount === undefined
      ? existingReceipt.deposit_amount
      : (deposit_amount === '' || deposit_amount === null ? null : Number(deposit_amount));
    const depositDate = deposit_date === undefined ? existingReceipt.deposit_date : (deposit_date || null);

    if (!selectedCustomerId) {
      const { customer_name, phone } = newCustomer;
      const normalizedNewPhone = normalizePhone(phone);
      // เช็คเบอร์ซ้ำก่อนสร้างลูกค้าใหม่ (เหมือนที่บอทไลน์ทำ) — กันสร้างลูกค้าซ้ำซ้อน
      // ถ้าเบอร์นี้เคยมีอยู่แล้วในระบบ (เช่น เคยสร้างผ่านไลน์มาก่อน) ใช้คนเดิมแทน
      const [existingByPhone] = normalizedNewPhone
        ? await conn.execute('SELECT id FROM customers WHERE phone = ? LIMIT 1', [normalizedNewPhone])
        : [[]];
      if (existingByPhone.length > 0) {
        selectedCustomerId = existingByPhone[0].id;
      } else {
        const customerCode = await generateCustomerCode(conn);
        const [customerResult] = await conn.execute(
          `INSERT INTO customers (customer_code, customer_name, phone) VALUES (?, ?, ?)`,
          [customerCode, customer_name, normalizedNewPhone]
        );
        selectedCustomerId = customerResult.insertId;
      }
    } else {
      const [customerRows] = await conn.execute('SELECT id FROM customers WHERE id = ?', [selectedCustomerId]);
      if (customerRows.length === 0) {
        await conn.rollback();
        return res.status(400).json(formatValidation([['customer_id', 'ไม่พบลูกค้าที่เลือก']]));
      }
    }

    if (!selectedVehicleId) {
      if (!newVehicle || !newVehicle.brand || !newVehicle.model) {
        await conn.rollback();
        return res.status(400).json({ error: 'กรุณาเลือกหรือกรอกข้อมูลรถ' });
      }
      const [vehicleResult] = await conn.execute(
        `INSERT INTO vehicles (customer_id, brand, model, color, license_plate, mileage)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [selectedCustomerId, newVehicle.brand, newVehicle.model, newVehicle.color || null, newVehicle.license_plate || null, Number(mileage) || 0]
      );
      selectedVehicleId = vehicleResult.insertId;
    } else {
      const [vehicleRows] = await conn.execute(
        'SELECT id FROM vehicles WHERE id = ? AND customer_id = ?',
        [selectedVehicleId, selectedCustomerId]
      );
      if (vehicleRows.length === 0) {
        await conn.rollback();
        return res.status(400).json(formatValidation([['vehicle_id', 'ไม่พบรถที่เลือกสำหรับลูกค้านี้']]));
      }
    }

    const total_amount = normalizedItems.reduce((sum, item) => sum + item.qty * item.price, 0);

    await conn.execute(
      `UPDATE receipts SET receipt_date = ?, customer_id = ?, vehicle_id = ?, mileage = ?, remark = ?, payment_method = ?, technician_name = ?, total_amount = ?, deposit_amount = ?, deposit_date = ? WHERE id = ?`,
      [receipt_date, selectedCustomerId, selectedVehicleId, Number(mileage) || 0, remark || null, payment_method || null, technician_name || null, total_amount, depositAmount, depositDate, receiptId]
    );

    await conn.execute('DELETE FROM receipt_items WHERE receipt_id = ?', [receiptId]);
    for (const item of normalizedItems) {
      await conn.execute(
        `INSERT INTO receipt_items
         (receipt_id, service_item_id, product_name_snapshot, qty, price, amount, warranty_name, warranty_year, warranty_month, warranty_km)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          receiptId,
          item.service_item_id,
          item.product_name_snapshot,
          item.qty,
          item.price,
          item.qty * item.price,
          item.warranty_name,
          item.warranty_year,
          item.warranty_month,
          item.warranty_km,
        ]
      );
    }

    await conn.commit();
    emitReceiptEvent('receipt:updated', { receiptId, actorId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackErr) { console.error('Rollback error:', rollbackErr); }
    }
    console.error('Error updating receipt:', err);
    res.status(500).json({ error: 'แก้ไขบิลไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

router.delete('/:id', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // เก็บ id ของใบเสนอราคาที่ผูกกับใบเสร็จนี้ไว้ก่อน UPDATE ด้านล่างจะล้าง
    // converted_receipt_id ทิ้ง — ใช้ยิง event แจ้งฝั่งใบเสนอราคาหลัง commit
    const [[linked]] = await conn.query(
      'SELECT id FROM quotations WHERE converted_receipt_id = ? LIMIT 1',
      [req.params.id]
    );

    // ถ้าใบเสร็จนี้ถูกแปลงมาจากใบเสนอราคา ต้องคืนสถานะใบเสนอราคากลับเป็น pending
    // ก่อนลบใบเสร็จ ไม่งั้น FK จะแค่ set converted_receipt_id เป็น NULL แต่ status
    // ยังเป็น 'approved' ค้างอยู่ ทำให้ดูเหมือนอนุมัติแล้วแต่ไม่มีใบเสร็จจริง
    await conn.execute(
      "UPDATE quotations SET status = 'pending', converted_receipt_id = NULL WHERE converted_receipt_id = ?",
      [req.params.id]
    );

    const [result] = await conn.execute('DELETE FROM receipts WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบใบเสร็จ' });
    }

    await conn.commit();

    emitReceiptEvent('receipt:deleted', { receiptId: Number(req.params.id), actorId: req.user.id });
    if (linked) {
      emitQuotationEvent('quotation:updated', { quotationId: linked.id, status: 'pending', actorId: req.user.id });
    }

    res.json({ success: true, message: 'ลบใบเสร็จสำเร็จ' });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackErr) { console.error('Rollback error:', rollbackErr); }
    }
    console.error('Error deleting receipt:', err);
    res.status(500).json({ error: 'ลบใบเสร็จไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
