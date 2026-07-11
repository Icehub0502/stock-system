const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// Generate quotation number (IV260630001)
async function generateQuotationNo() {
  const today = new Date();
  const dateStr = String(today.getDate()).padStart(2, '0')
                + String(today.getMonth() + 1).padStart(2, '0')
                + String(today.getFullYear()).slice(-2);

  const [rows] = await pool.execute(
    'SELECT MAX(CAST(SUBSTRING(quotation_no, -3) AS UNSIGNED)) as maxNo FROM quotations WHERE quotation_no LIKE ?',
    [`IV${dateStr}%`]
  );

  const nextNumber = (rows[0]?.maxNo || 0) + 1;
  return `IV${dateStr}${String(nextNumber).padStart(3, '0')}`;
}

function formatReceiptDate(date) {
  const d = new Date(date);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear() + 543).slice(-2);
  return `${yy}${mm}${dd}`;
}

// Mirrors receipts.routes.js's generateReceiptNo() — the quotation-approval
// flow inserts directly into receipts and needs the same numbering scheme.
async function generateReceiptNo(conn) {
  const dateStr = formatReceiptDate(new Date());
  const [rows] = await conn.execute(
    'SELECT MAX(CAST(SUBSTRING(receipt_no, -3) AS UNSIGNED)) AS maxNo FROM receipts WHERE receipt_no LIKE ?',
    [`RC${dateStr}%`]
  );
  const nextNumber = (rows[0]?.maxNo || 0) + 1;
  return `RC${dateStr}${String(nextNumber).padStart(3, '0')}`;
}

async function generateCustomerCode(conn) {
  const [rows] = await conn.execute(
    "SELECT MAX(CAST(SUBSTRING(customer_code, 5) AS UNSIGNED)) AS maxCode FROM customers WHERE customer_code LIKE 'CMM-%'"
  );
  const nextNumber = (rows[0]?.maxCode || 0) + 1;
  return `CMM-${String(nextNumber).padStart(4, '0')}`;
}

router.get('/next-no', async (req, res) => {
  try {
    const quotation_no = await generateQuotationNo();
    res.json({ success: true, quotation_no });
  } catch (err) {
    console.error('Error generating quotation no:', err);
    res.status(500).json({ error: 'ไม่สามารถสร้างเลขที่ใบเสนอราคาได้' });
  }
});

function buildValidItems(items) {
  return Array.isArray(items)
    ? items.filter((item) => {
        const name = item.product_name?.toString().trim();
        const quantity = Number(item.quantity || 0);
        // A blank unit_price is valid — a set-expanded component row is
        // often left unpriced since it's covered by the set's combined
        // price, and should still be saved (as ฿0), not dropped.
        return Boolean(name) && quantity > 0;
      })
    : [];
}

// POST - Create new quotation
router.post('/', async (req, res) => {
  const { customer_id, newCustomer, vehicle_id, newVehicle, quotation_date, mileage, remark, queue_no, symptom, items } = req.body;

  const toNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  let selectedCustomerId = customer_id ? toNumber(customer_id) : null;
  let selectedVehicleId = vehicle_id ? toNumber(vehicle_id) : null;

  if ((!selectedCustomerId && (!newCustomer || !newCustomer.customer_name)) || !quotation_date) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลลูกค้าและวันที่ให้ครบถ้วน' });
  }

  const validItems = buildValidItems(items);
  if (validItems.length === 0) {
    return res.status(400).json({ error: 'กรุณาเพิ่มรายการสินค้าอย่างน้อยหนึ่งรายการ' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    if (!selectedCustomerId) {
      const { customer_name, phone } = newCustomer;
      const customerCode = await generateCustomerCode(conn);
      const [customerResult] = await conn.execute(
        'INSERT INTO customers (customer_code, customer_name, phone) VALUES (?, ?, ?)',
        [customerCode, customer_name, phone || null]
      );
      selectedCustomerId = customerResult.insertId;
    } else {
      const [customerRows] = await conn.execute('SELECT id FROM customers WHERE id = ?', [selectedCustomerId]);
      if (customerRows.length === 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'ไม่พบลูกค้าที่เลือก' });
      }
    }

    if (!selectedVehicleId && newVehicle && newVehicle.brand && newVehicle.model) {
      const [vehicleResult] = await conn.execute(
        `INSERT INTO vehicles (customer_id, brand, model, color, license_plate, mileage)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [selectedCustomerId, newVehicle.brand, newVehicle.model, newVehicle.color || null, newVehicle.license_plate || null, Number(mileage) || 0]
      );
      selectedVehicleId = vehicleResult.insertId;
    } else if (selectedVehicleId) {
      const [vehicleRows] = await conn.execute(
        'SELECT id FROM vehicles WHERE id = ? AND customer_id = ?',
        [selectedVehicleId, selectedCustomerId]
      );
      if (vehicleRows.length === 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'ไม่พบรถที่เลือกสำหรับลูกค้านี้' });
      }
    }

    const quotation_no = await generateQuotationNo();
    const total_amount = validItems.reduce((sum, item) => sum + Number(item.quantity || 1) * Number(item.unit_price || 0), 0);

    const [quotationResult] = await conn.execute(
      `INSERT INTO quotations (quotation_no, quotation_date, customer_id, vehicle_id, mileage, remark, product_summary, total_amount, queue_no, symptom)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        quotation_no,
        quotation_date,
        selectedCustomerId,
        selectedVehicleId,
        Number(mileage) || 0,
        remark || null,
        validItems.map((i) => i.product_name).join(', '),
        total_amount,
        queue_no || null,
        symptom || null
      ]
    );

    const quotation_id = quotationResult.insertId;

    for (const item of validItems) {
      await conn.execute(
        `INSERT INTO quotation_items (quotation_id, product_id, product_name, quantity, unit_price, warranty_name, warranty_year, warranty_month, warranty_km)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          quotation_id,
          item.product_id || null,
          item.product_name,
          parseInt(item.quantity || 1),
          parseFloat(item.unit_price || 0),
          item.warranty_name || null,
          Number(item.warranty_year || 0),
          Number(item.warranty_month || 0),
          Number(item.warranty_km || 0)
        ]
      );
    }

    await conn.commit();

    res.status(201).json({
      success: true,
      message: 'สร้างใบเสนอราคาสำเร็จ',
      quotation_id,
      quotation_no
    });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackErr) { console.error('Rollback error:', rollbackErr); }
    }
    console.error('Error creating quotation:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการสร้างใบเสนอราคา' });
  } finally {
    if (conn) conn.release();
  }
});

// GET - Get all quotations with customer + vehicle info
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT q.*, c.customer_name, c.customer_code, c.phone,
              v.brand, v.model, v.color, v.license_plate
       FROM quotations q
       LEFT JOIN customers c ON q.customer_id = c.id
       LEFT JOIN vehicles v ON q.vehicle_id = v.id
       ORDER BY q.created_at DESC`
    );

    res.json({
      success: true,
      data: rows
    });
  } catch (err) {
    console.error('Error fetching quotations:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
  }
});

// GET - Get quotation by ID with items
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [quotations] = await pool.execute(
      `SELECT q.*, c.customer_name, c.customer_code, c.phone,
              v.brand, v.model, v.color, v.license_plate, v.mileage AS vehicle_mileage
       FROM quotations q
       LEFT JOIN customers c ON q.customer_id = c.id
       LEFT JOIN vehicles v ON q.vehicle_id = v.id
       WHERE q.id = ?`,
      [id]
    );

    if (quotations.length === 0) {
      return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
    }

    const [items] = await pool.execute(
      'SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY id ASC',
      [id]
    );

    res.json({
      success: true,
      data: {
        ...quotations[0],
        items
      }
    });
  } catch (err) {
    console.error('Error fetching quotation:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
  }
});

// PUT - Update quotation
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { customer_id, newCustomer, vehicle_id, newVehicle, quotation_date, mileage, remark, queue_no, symptom, items } = req.body;

  const toNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  let selectedCustomerId = customer_id ? toNumber(customer_id) : null;
  let selectedVehicleId = vehicle_id ? toNumber(vehicle_id) : null;

  if ((!selectedCustomerId && (!newCustomer || !newCustomer.customer_name)) || !quotation_date) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลลูกค้าและวันที่ให้ครบถ้วน' });
  }

  const validItems = buildValidItems(items);
  if (validItems.length === 0) {
    return res.status(400).json({ error: 'กรุณาเพิ่มรายการสินค้าอย่างน้อยหนึ่งรายการ' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [existingRows] = await conn.execute('SELECT id FROM quotations WHERE id = ?', [id]);
    if (existingRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
    }

    if (!selectedCustomerId) {
      const { customer_name, phone } = newCustomer;
      const customerCode = await generateCustomerCode(conn);
      const [customerResult] = await conn.execute(
        'INSERT INTO customers (customer_code, customer_name, phone) VALUES (?, ?, ?)',
        [customerCode, customer_name, phone || null]
      );
      selectedCustomerId = customerResult.insertId;
    } else {
      const [customerRows] = await conn.execute('SELECT id FROM customers WHERE id = ?', [selectedCustomerId]);
      if (customerRows.length === 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'ไม่พบลูกค้าที่เลือก' });
      }
    }

    if (!selectedVehicleId && newVehicle && newVehicle.brand && newVehicle.model) {
      const [vehicleResult] = await conn.execute(
        `INSERT INTO vehicles (customer_id, brand, model, color, license_plate, mileage)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [selectedCustomerId, newVehicle.brand, newVehicle.model, newVehicle.color || null, newVehicle.license_plate || null, Number(mileage) || 0]
      );
      selectedVehicleId = vehicleResult.insertId;
    } else if (selectedVehicleId) {
      const [vehicleRows] = await conn.execute(
        'SELECT id FROM vehicles WHERE id = ? AND customer_id = ?',
        [selectedVehicleId, selectedCustomerId]
      );
      if (vehicleRows.length === 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'ไม่พบรถที่เลือกสำหรับลูกค้านี้' });
      }
    }

    const total_amount = validItems.reduce((sum, item) => sum + Number(item.quantity || 1) * Number(item.unit_price || 0), 0);

    await conn.execute(
      `UPDATE quotations
       SET customer_id = ?, vehicle_id = ?, quotation_date = ?, mileage = ?, remark = ?, product_summary = ?, total_amount = ?, queue_no = ?, symptom = ?
       WHERE id = ?`,
      [
        selectedCustomerId,
        selectedVehicleId,
        quotation_date,
        Number(mileage) || 0,
        remark || null,
        validItems.map((i) => i.product_name).join(', '),
        total_amount,
        queue_no || null,
        symptom || null,
        id
      ]
    );

    await conn.execute('DELETE FROM quotation_items WHERE quotation_id = ?', [id]);

    for (const item of validItems) {
      await conn.execute(
        `INSERT INTO quotation_items (quotation_id, product_id, product_name, quantity, unit_price, warranty_name, warranty_year, warranty_month, warranty_km)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          item.product_id || null,
          item.product_name,
          parseInt(item.quantity || 1),
          parseFloat(item.unit_price || 0),
          item.warranty_name || null,
          Number(item.warranty_year || 0),
          Number(item.warranty_month || 0),
          Number(item.warranty_km || 0)
        ]
      );
    }

    await conn.commit();

    res.json({
      success: true,
      message: 'อัปเดตใบเสนอราคาสำเร็จ'
    });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackErr) { console.error('Rollback error:', rollbackErr); }
    }
    console.error('Error updating quotation:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการอัปเดตใบเสนอราคา' });
  } finally {
    if (conn) conn.release();
  }
});

// PATCH - Approve a quotation: silently create a receipt from its
// customer/vehicle/items, per the user's explicit choice to not
// auto-navigate to the new receipt.
router.patch('/:id/approve', async (req, res) => {
  const { id } = req.params;

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [quotationRows] = await conn.execute('SELECT * FROM quotations WHERE id = ?', [id]);
    if (quotationRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
    }
    const quotation = quotationRows[0];

    if (quotation.status === 'approved' && quotation.converted_receipt_id) {
      await conn.rollback();
      return res.status(400).json({ error: 'ใบเสนอราคานี้อนุมัติและสร้างใบเสร็จไปแล้ว' });
    }

    if (!quotation.vehicle_id) {
      await conn.rollback();
      return res.status(400).json({ error: 'ใบเสนอราคานี้ยังไม่มีข้อมูลรถ ไม่สามารถสร้างใบเสร็จได้' });
    }

    const [items] = await conn.execute('SELECT * FROM quotation_items WHERE quotation_id = ?', [id]);
    if (items.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'ใบเสนอราคานี้ไม่มีรายการสินค้า' });
    }

    const receipt_no = await generateReceiptNo(conn);
    const total_amount = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price), 0);

    const [receiptResult] = await conn.execute(
      `INSERT INTO receipts (receipt_no, receipt_date, customer_id, vehicle_id, mileage, remark, total_amount)
       VALUES (?, CURDATE(), ?, ?, ?, ?, ?)`,
      [receipt_no, quotation.customer_id, quotation.vehicle_id, quotation.mileage || 0, quotation.remark || null, total_amount]
    );
    const receiptId = receiptResult.insertId;

    for (const item of items) {
      const qty = Number(item.quantity);
      const price = Number(item.unit_price);
      await conn.execute(
        `INSERT INTO receipt_items (receipt_id, service_item_id, product_name_snapshot, qty, price, amount, warranty_name, warranty_year, warranty_month, warranty_km)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [receiptId, item.product_name, qty, price, qty * price, item.warranty_name || null, item.warranty_year || 0, item.warranty_month || 0, item.warranty_km || 0]
      );
    }

    await conn.execute(
      "UPDATE quotations SET status = 'approved', converted_receipt_id = ? WHERE id = ?",
      [receiptId, id]
    );

    await conn.commit();

    res.json({
      success: true,
      message: 'อนุมัติใบเสนอราคาและสร้างใบเสร็จสำเร็จ',
      receipt_id: receiptId,
      receipt_no
    });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackErr) { console.error('Rollback error:', rollbackErr); }
    }
    console.error('Error approving quotation:', err);
    res.status(500).json({ error: 'อนุมัติใบเสนอราคาไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// PATCH - Mark a quotation as "customer will come back later" with a date
router.patch('/:id/schedule', async (req, res) => {
  const { id } = req.params;
  const { scheduled_date } = req.body || {};

  if (!scheduled_date) {
    return res.status(400).json({ error: 'กรุณาระบุวันที่' });
  }

  try {
    const [result] = await pool.execute(
      "UPDATE quotations SET status = 'scheduled', scheduled_date = ? WHERE id = ?",
      [scheduled_date, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
    }
    res.json({ success: true, message: 'บันทึกวันนัดหมายสำเร็จ' });
  } catch (err) {
    console.error('Error scheduling quotation:', err);
    res.status(500).json({ error: 'บันทึกวันนัดหมายไม่สำเร็จ' });
  }
});

// DELETE - Delete quotation
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.execute(
      'DELETE FROM quotations WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
    }

    res.json({
      success: true,
      message: 'ลบใบเสนอราคาสำเร็จ'
    });
  } catch (err) {
    console.error('Error deleting quotation:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการลบใบเสนอราคา' });
  }
});

module.exports = router;
