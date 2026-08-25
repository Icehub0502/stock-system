const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { formatPhone } = require('../utils/parseLineQueueMessage');
// pushQuotationUpdate: ดัน "ข้อมูลอัปเดตแล้ว" กลับเข้ากลุ่มไลน์ของร้านหลังแก้ไขใบ
// เสนอราคาที่มาจากไลน์ (มีเลขคิว+ยังไม่ปิดบิล) ผ่านหน้าเว็บ — กันพนักงานคัดลอก
// ข้อความไลน์เก่าที่ยังผิดอยู่มาส่งซ้ำทับข้อมูลที่ออฟฟิศเพิ่งแก้ (ดู PUT /:id ด้านล่าง)
const { pushQuotationUpdate, computeReceiptAmount } = require('./lineWebhook.routes');
const { emitQuotationEvent, emitReceiptEvent } = require('../realtime');

// ทำให้ตรงรูปแบบเดียวกับที่ customers.routes.js ใช้ กันเบอร์ที่พิมพ์ไม่มีขีดตรงนี้
// ไปหลุดจากการค้นหาของบอทไลน์ (lineWebhook.routes.js เทียบแบบ phone = ? ตรง ๆ)
function normalizePhone(phone) {
  if (!phone) return phone;
  const digitsOnly = phone.replace(/\D/g, '');
  return digitsOnly ? formatPhone(digitsOnly) : phone;
}

const router = express.Router();
router.use(authenticate);
// ใบเสนอราคาเป็นเอกสารการเงิน — จำกัดเฉพาะ office เหมือน receipts.routes.js
// (หน้าเว็บ /quotations เองก็ล็อกไว้แค่ office อยู่แล้ว ช่างไม่มีหน้าจอที่เรียก
// endpoint พวกนี้เลย กันไม่ให้ยิง API ตรง ๆ ข้ามการล็อกฝั่ง UI ไปแก้ไข/ลบ/อนุมัติได้)
router.use(requireRole('office'));

// ใบแจ้งซ่อมถือว่า "กรอกแล้ว" ก็ต่อเมื่อมีเนื้อหาจริง (ติ๊กอย่างน้อย 1 ช่อง,
// กรอกหมายเหตุ/other, หรือกรอกชื่อผู้ตรวจ/ช่างซ่อม) ไม่ใช่แค่เคยกดบันทึกแล้ว —
// เพราะฟอร์มส่ง checklist แบบเต็มโครงสร้าง (ทุกช่องเป็น false) กลับมาเสมอแม้ไม่ได้
// ติ๊กอะไรเลย ถ้าเช็คแค่ checklist <> '{}' จะกลายเป็น false positive ทันทีที่กดบันทึก
function hasCheckedContent(node) {
  if (node == null) return false;
  if (typeof node === 'boolean') return node === true;
  if (typeof node === 'string') return node.trim() !== '';
  if (typeof node === 'object') {
    return Object.values(node).some(hasCheckedContent);
  }
  return false;
}

function isRepairNoticeFilled(checklistRaw, checkedBy, repairedBy) {
  if ((checkedBy && checkedBy.trim()) || (repairedBy && repairedBy.trim())) return true;
  if (!checklistRaw) return false;
  let checklist;
  try {
    checklist = typeof checklistRaw === 'string' ? JSON.parse(checklistRaw) : checklistRaw;
  } catch {
    return false;
  }
  return hasCheckedContent(checklist);
}

// Generate quotation number (IV260630001)
// conn: รับ connection ของ transaction ที่กำลังสร้างใบเสนอราคาอยู่ (ถ้ามี) — ใช้
// FOR UPDATE ล็อกแถวที่อ่านไว้จนกว่า transaction นั้นจะ commit กัน 2 คำขอพร้อมกัน
// อ่าน MAX เดิมแล้วได้เลขซ้ำกัน (ดูจุดเดียวกันใน generateReceiptNo/
// generateCustomerCode/generateRepairNoticeCode ด้านล่าง และ generateQuotationNo
// ใน lineWebhook.routes.js) ไม่มี conn ส่งมา (เช่น route /next-no ที่แค่พรีวิว
// เลขไว้ดู ไม่ได้ insert จริง) ใช้ pool เฉย ๆ ไม่ต้องล็อกอะไร
async function generateQuotationNo(conn = pool) {
  const today = new Date();
  const dateStr = String(today.getDate()).padStart(2, '0')
                + String(today.getMonth() + 1).padStart(2, '0')
                + String(today.getFullYear()).slice(-2);

  const [rows] = await conn.execute(
    'SELECT MAX(CAST(SUBSTRING(quotation_no, -3) AS UNSIGNED)) as maxNo FROM quotations WHERE quotation_no LIKE ? FOR UPDATE',
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
  // FOR UPDATE ล็อกแถว receipt_no วันนี้ไว้จนกว่า transaction ผู้เรียกจะ commit —
  // กันคำขออนุมัติใบเสนอราคา 2 ใบพร้อมกันอ่าน MAX เดิมแล้วได้เลขบิลซ้ำกัน
  const [rows] = await conn.execute(
    'SELECT MAX(CAST(SUBSTRING(receipt_no, -3) AS UNSIGNED)) AS maxNo FROM receipts WHERE receipt_no LIKE ? FOR UPDATE',
    [`RC${dateStr}%`]
  );
  const nextNumber = (rows[0]?.maxNo || 0) + 1;
  return `RC${dateStr}${String(nextNumber).padStart(3, '0')}`;
}

async function generateCustomerCode(conn) {
  // FOR UPDATE เหตุผลเดียวกับ generateReceiptNo/generateQuotationNo ด้านบน
  const [rows] = await conn.execute(
    "SELECT MAX(CAST(SUBSTRING(customer_code, 5) AS UNSIGNED)) AS maxCode FROM customers WHERE customer_code LIKE 'CMM-%' FOR UPDATE"
  );
  const nextNumber = (rows[0]?.maxCode || 0) + 1;
  return `CMM-${String(nextNumber).padStart(4, '0')}`;
}

// Mirrors generateCode() in repairNotices.routes.js — creating a quotation now
// auto-creates its repair notice in the same transaction, so it needs the same
// "RN-####" numbering scheme.
async function generateRepairNoticeCode(conn) {
  // FOR UPDATE เหตุผลเดียวกับตัวสร้างเลขเอกสารด้านบน
  const [rows] = await conn.execute(
    "SELECT MAX(CAST(SUBSTRING(code, 4) AS UNSIGNED)) AS maxNo FROM repair_notices WHERE code LIKE 'RN-%' FOR UPDATE"
  );
  const nextNumber = (rows[0]?.maxNo || 0) + 1;
  return `RN-${String(nextNumber).padStart(4, '0')}`;
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

// รายการที่มีชื่อจริง (ไม่ใช่แถวว่างเปล่าที่ตั้งใจไม่กรอก) แต่จำนวนกรอกมาไม่ใช่
// ตัวเลขบวก (เช่น พิมพ์ตัวอักษรผิดพลาดในช่องจำนวน กลายเป็น NaN) — buildValidItems
// ด้านบนกรองรายการแบบนี้ทิ้งเงียบ ๆ ทำให้เคยเกิดใบเสนอราคาว่างเปล่า/ยอด 0 โดยไม่มี
// error เตือนเลย ต้องเช็คแยกก่อน insert เพื่อตอบ 400 ให้แก้ไขแทนที่จะปล่อยผ่าน
function findInvalidItems(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => {
    const name = item.product_name?.toString().trim();
    if (!name) return false;
    const quantity = Number(item.quantity || 0);
    return !(quantity > 0);
  });
}

// POST - Create new quotation
router.post('/', async (req, res) => {
  const { customer_id, newCustomer, vehicle_id, newVehicle, quotation_date, mileage, remark, queue_no, symptom, items, deposit_amount, deposit_date } = req.body;

  const toNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  // มัดจำ: ไม่บังคับกรอก — ว่าง/ไม่ส่งมา = NULL, มีค่าก็แปลงเป็นตัวเลข (loose
  // validation พอ ร้านเล็กไม่ต้อง over-engineer) วันที่คงรูปแบบ YYYY-MM-DD ตามที่
  // ฟอร์มส่งมาตรง ๆ (เหมือน quotation_date ด้านบนที่ไม่แปลงอะไรเพิ่ม)
  const depositAmount = deposit_amount !== undefined && deposit_amount !== '' && deposit_amount !== null
    ? Number(deposit_amount)
    : null;
  const depositDate = deposit_date || null;

  let selectedCustomerId = customer_id ? toNumber(customer_id) : null;
  let selectedVehicleId = vehicle_id ? toNumber(vehicle_id) : null;

  if ((!selectedCustomerId && (!newCustomer || !newCustomer.customer_name)) || !quotation_date) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลลูกค้าและวันที่ให้ครบถ้วน' });
  }

  // รายการสินค้าไม่บังคับตอนสร้าง — กรอกแค่ข้อมูลลูกค้า/รถแล้วบันทึกได้เลย
  // ให้หน้างานมาเพิ่มรายการทีหลังตอนเสนอราคาจริง
  const invalidItems = findInvalidItems(items);
  if (invalidItems.length > 0) {
    return res.status(400).json({ error: `จำนวนของรายการ "${invalidItems[0].product_name}" ไม่ถูกต้อง กรุณาตรวจสอบ` });
  }
  const validItems = buildValidItems(items);

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
          'INSERT INTO customers (customer_code, customer_name, phone) VALUES (?, ?, ?)',
          [customerCode, customer_name, normalizedNewPhone]
        );
        selectedCustomerId = customerResult.insertId;
      }
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

    const quotation_no = await generateQuotationNo(conn);
    const total_amount = validItems.reduce((sum, item) => sum + Number(item.quantity || 1) * Number(item.unit_price || 0), 0);

    const [quotationResult] = await conn.execute(
      `INSERT INTO quotations (quotation_no, quotation_date, customer_id, vehicle_id, mileage, remark, product_summary, total_amount, queue_no, symptom, deposit_amount, deposit_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        symptom || null,
        depositAmount,
        depositDate
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

    // Auto-create an (empty) repair notice for this quotation right away, so the
    // vehicle appears on the repair-notice list the moment the quotation is
    // created — no waiting for approval. An empty '{}' checklist is filled in
    // later by whoever ticks what needs repair (normalizeChecklist handles the
    // empty shape on read). repair_notice_filled in the list query flips once
    // it has real content, which is how the UI shows "already filled".
    if (selectedVehicleId) {
      const rnCode = await generateRepairNoticeCode(conn);
      await conn.execute(
        `INSERT INTO repair_notices (code, customer_id, vehicle_id, quotation_id, notice_date, checklist)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [rnCode, selectedCustomerId, selectedVehicleId, quotation_id, quotation_date, '{}']
      );
    }

    await conn.commit();

    emitQuotationEvent('quotation:created', { quotationId: quotation_id, status: 'pending', actorId: req.user.id });

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
    // หน้า QuotationListPage ดึงมาทั้งชุดแล้วค้นหา/จัดกลุ่มฝั่ง client เอง (ไม่มี
    // search param ส่งมาที่ endpoint นี้เลย) ใส่ LIMIT ตรงตัวเลข 200 แบบ
    // receipts.routes.js จึงจะทำให้ค้นหาใบเก่ากว่านั้นหายไปเงียบ ๆ — ใส่เพดานสูง
    // (5000) ไว้กันเติบโตแบบไม่จำกัดแทน ในสเกลร้านนี้ (คิวไม่กี่สิบ/วัน) ยังไม่มีทาง
    // แตะเพดานนี้ในทางปฏิบัติ ถ้าจำนวนใบเสนอราคาโตเกินนี้จริง ต้องทำ pagination
    // จริงจัง (search/limit/offset) ฝั่ง frontend ควบคู่กันแทน ไม่ใช่ตัด LIMIT ต่ำ ๆ ที่นี่
    const [rows] = await pool.execute(
      `SELECT q.*, c.customer_name, c.customer_code, c.phone,
              v.brand, v.model, v.color, v.license_plate,
              rn.id AS repair_notice_id, rn.checklist AS repair_notice_checklist,
              rn.checked_by AS repair_notice_checked_by, rn.repaired_by AS repair_notice_repaired_by,
              -- เฉพาะงานที่ "ยังเปิดอยู่" เท่านั้น — ใบที่ลูกค้ามัดจำแล้วขับรถกลับไป
              -- (งานเดิมจบเป็น carout) ต้องกด "สร้างคิว" ใหม่ได้อีกตอนกลับมาทำจริง
              -- ไม่ใช่โดนล็อกให้ไปหน้างานเก่าที่ปิดไปแล้ว
              (SELECT j.id FROM jobs j
                WHERE j.quotation_id = q.id AND j.status NOT IN ('delivered','carout')
                ORDER BY j.id DESC LIMIT 1) AS linked_job_id
       FROM quotations q
       LEFT JOIN customers c ON q.customer_id = c.id
       LEFT JOIN vehicles v ON q.vehicle_id = v.id
       LEFT JOIN repair_notices rn ON rn.quotation_id = q.id
       ORDER BY q.created_at DESC
       LIMIT 5000`
    );

    const data = rows.map((row) => {
      const { repair_notice_checklist, repair_notice_checked_by, repair_notice_repaired_by, ...rest } = row;
      return {
        ...rest,
        repair_notice_filled: isRepairNoticeFilled(
          repair_notice_checklist,
          repair_notice_checked_by,
          repair_notice_repaired_by
        ),
      };
    });

    res.json({
      success: true,
      data
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

// PATCH - Mark quotation as printed (mirrors receipts' /:id/mark-printed)
router.patch('/:id/mark-printed', async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute(
      'UPDATE quotations SET printed_at = NOW() WHERE id = ?',
      [id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบใบเสนอราคานี้' });
    }
    const [[row]] = await pool.execute('SELECT printed_at FROM quotations WHERE id = ?', [id]);
    emitQuotationEvent('quotation:updated', { quotationId: Number(id), status: null, actorId: req.user.id });
    res.json({ success: true, printed_at: row.printed_at });
  } catch (err) {
    console.error('Error marking quotation as printed:', err);
    res.status(500).json({ error: 'บันทึกสถานะการพิมพ์ไม่สำเร็จ' });
  }
});

// PUT - Update quotation
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { customer_id, newCustomer, vehicle_id, newVehicle, quotation_date, mileage, remark, queue_no, symptom, items, deposit_amount, deposit_date } = req.body;

  const toNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  let selectedCustomerId = customer_id ? toNumber(customer_id) : null;
  let selectedVehicleId = vehicle_id ? toNumber(vehicle_id) : null;

  if ((!selectedCustomerId && (!newCustomer || !newCustomer.customer_name)) || !quotation_date) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลลูกค้าและวันที่ให้ครบถ้วน' });
  }

  const invalidItems = findInvalidItems(items);
  if (invalidItems.length > 0) {
    return res.status(400).json({ error: `จำนวนของรายการ "${invalidItems[0].product_name}" ไม่ถูกต้อง กรุณาตรวจสอบ` });
  }
  const validItems = buildValidItems(items);

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // เพิ่ม queue_no ในผลลัพธ์ที่ดึงมา — ใช้เช็คหลัง commit ว่าใบนี้ "มาจากไลน์และ
    // ยังเปิดอยู่" ไหม (มีเลขคิว + closed_at ยังว่าง) เพื่อตัดสินใจ push ข้อมูล
    // อัปเดตกลับเข้ากลุ่มไลน์ (ดู pushQuotationUpdate ท้ายฟังก์ชันนี้)
    const [existingRows] = await conn.execute('SELECT id, status, converted_receipt_id, deposit_amount, deposit_date, queue_no, closed_at FROM quotations WHERE id = ?', [id]);
    if (existingRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
    }
    const existingQuotation = existingRows[0];

    // มัดจำ: ไม่ส่ง field มาเลย (เช่นฟอร์มเก่าที่ยังไม่มีช่องมัดจำ) = คงค่าเดิมไว้
    // ไม่ทับด้วย null ทิ้ง — ส่งมาชัดเจน (แม้จะเป็นค่าว่าง/null) = ตั้งใจล้าง/แก้ไขจริง
    const depositAmount = deposit_amount === undefined
      ? existingQuotation.deposit_amount
      : (deposit_amount === '' || deposit_amount === null ? null : Number(deposit_amount));
    const depositDate = deposit_date === undefined ? existingQuotation.deposit_date : (deposit_date || null);

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
          'INSERT INTO customers (customer_code, customer_name, phone) VALUES (?, ?, ?)',
          [customerCode, customer_name, normalizedNewPhone]
        );
        selectedCustomerId = customerResult.insertId;
      }
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
       SET customer_id = ?, vehicle_id = ?, quotation_date = ?, mileage = ?, remark = ?, product_summary = ?, total_amount = ?, queue_no = ?, symptom = ?, deposit_amount = ?, deposit_date = ?
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
        depositAmount,
        depositDate,
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

    // ใบเสนอราคานี้อนุมัติไปแล้วและมีใบเสร็จที่แปลงไว้แล้ว — แก้ไขที่นี่ให้ไหลไป
    // อัปเดตใบเสร็จนั้นด้วยเลย กันไม่ให้ต้องแก้ 2 ที่/พิมพ์ 2 รอบ (ใบเสร็จเก็บแค่
    // ข้อมูลที่มาจากใบเสนอราคาโดยตรง — payment_method/technician_name/
    // printed_at/receipt_date เป็นของใบเสร็จเองไม่แตะ)
    let syncedReceipt = false;
    if (existingQuotation.status === 'approved' && existingQuotation.converted_receipt_id) {
      const receiptId = existingQuotation.converted_receipt_id;
      // deposit_amount/deposit_date: snapshot ค่ามัดจำที่แก้ไขมาในคำขอนี้ลงใบเสร็จ
      // ด้วยเหมือน remark/mileage ด้านบน — ถ้าออฟฟิศแก้มัดจำของใบที่อนุมัติไปแล้ว
      // ต้องสะท้อนไปที่ใบเสร็จทันที ไม่ใช่ค้างค่าเดิมก่อนแก้ไว้
      await conn.execute(
        `UPDATE receipts SET customer_id = ?, vehicle_id = ?, mileage = ?, remark = ?, total_amount = ?, deposit_amount = ?, deposit_date = ? WHERE id = ?`,
        [selectedCustomerId, selectedVehicleId, Number(mileage) || 0, remark || null, total_amount, depositAmount, depositDate, receiptId]
      );
      await conn.execute('DELETE FROM receipt_items WHERE receipt_id = ?', [receiptId]);
      for (const item of validItems) {
        const qty = parseInt(item.quantity || 1);
        const price = parseFloat(item.unit_price || 0);
        await conn.execute(
          `INSERT INTO receipt_items (receipt_id, service_item_id, product_name_snapshot, qty, price, amount, warranty_name, warranty_year, warranty_month, warranty_km)
           VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [receiptId, item.product_name, qty, price, qty * price, item.warranty_name || null, Number(item.warranty_year || 0), Number(item.warranty_month || 0), Number(item.warranty_km || 0)]
        );
      }
      syncedReceipt = true;
    }

    await conn.commit();

    emitQuotationEvent('quotation:updated', { quotationId: Number(id), status: existingQuotation.status, actorId: req.user.id });
    if (syncedReceipt) {
      emitReceiptEvent('receipt:updated', { receiptId: existingQuotation.converted_receipt_id, actorId: req.user.id });
    }

    // Push ข้อมูลอัปเดตกลับเข้ากลุ่มไลน์ของร้าน ถ้าใบนี้ "มาจากไลน์และยังเปิดอยู่"
    // (มีเลขคิว + closed_at ยังว่าง — เช็คจากค่าที่อ่านไว้ก่อน UPDATE ด้านบน เพราะ
    // ฟอร์มนี้ไม่มีช่องแก้ closed_at) กันพนักงานคัดลอกข้อความไลน์เก่าที่ยังผิดอยู่มา
    // ส่งซ้ำทับข้อมูลที่ออฟฟิศเพิ่งแก้ — best-effort ทั้งหมด (ดู pushQuotationUpdate)
    // ไม่ block/ไม่ทำให้ request นี้ล้มเหลวแม้ push จะพลาด
    if (existingQuotation.queue_no && !existingQuotation.closed_at) {
      try {
        await pushQuotationUpdate(id);
      } catch (err) {
        console.error('Error pushing quotation update to LINE after edit:', err);
      }
    }

    res.json({
      success: true,
      message: syncedReceipt ? 'อัปเดตใบเสนอราคาและใบเสร็จที่อนุมัติแล้วสำเร็จ' : 'อัปเดตใบเสนอราคาสำเร็จ',
      synced_receipt: syncedReceipt
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

    // deposit_amount/deposit_date: snapshot จากใบเสนอราคาลงใบเสร็จเหมือน remark/
    // mileage ด้านบน (ตั้งมาจากบอทไลน์ก่อนกดอนุมัติได้ — ดู createQuotationFromQueue)
    const [receiptResult] = await conn.execute(
      `INSERT INTO receipts (receipt_no, receipt_date, customer_id, vehicle_id, mileage, remark, total_amount, customer_signature, deposit_amount, deposit_date)
       VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?)`,
      [receipt_no, quotation.customer_id, quotation.vehicle_id, quotation.mileage || 0, quotation.remark || null, total_amount, quotation.customer_signature || null, quotation.deposit_amount, quotation.deposit_date]
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

    // ใบเสนอราคาปกติที่สร้างจากหน้าเว็บมีใบแจ้งซ่อมคู่กันมาตั้งแต่ตอนสร้างแล้ว
    // (ดู POST / ด้านบน) แต่ใบที่บอทไลน์สร้างตั้งใจไม่สร้างใบแจ้งซ่อมให้ทันที —
    // รอถึงตอนอนุมัติแบบนี้ค่อยสร้าง (หน้างานได้ตรวจสอบร่างจากไลน์ก่อนแล้ว)
    const [existingNotice] = await conn.execute(
      'SELECT id FROM repair_notices WHERE quotation_id = ? LIMIT 1',
      [id]
    );
    if (existingNotice.length === 0) {
      const rnCode = await generateRepairNoticeCode(conn);
      await conn.execute(
        `INSERT INTO repair_notices (code, customer_id, vehicle_id, quotation_id, notice_date, checklist)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [rnCode, quotation.customer_id, quotation.vehicle_id, id, quotation.quotation_date, '{}']
      );
    }

    await conn.commit();

    emitQuotationEvent('quotation:updated', { quotationId: Number(id), status: 'approved', actorId: req.user.id });
    emitReceiptEvent('receipt:created', { receiptId, actorId: req.user.id });

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

// PATCH - รับชำระเงิน/ปิดบิลจากหน้าเว็บโดยตรง — เดิมมีแค่ 2 ทางที่ตั้งค่า closed_at
// ได้ (ทั้งคู่มาจากไลน์: วลี "ชำระเงินเรียบร้อย" หรือข้อความปิดบิลสั้น) ทำให้ออฟฟิศที่
// ปิดงานผ่านเว็บอย่างเดียวไม่มีทางตั้งสถานะ "ชำระแล้ว" ได้เลย ต้องย้อนไปพิมพ์ในไลน์
// เสมอ — endpoint นี้ทำหน้าที่เดียวกับปิดบิลผ่านไลน์ แต่เรียกจากเว็บตรง ๆ
router.patch('/:id/close', async (req, res) => {
  const { id } = req.params;
  const { payment_method, paid_amount } = req.body || {};

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[quotation]] = await conn.query(
      'SELECT id, status, converted_receipt_id, closed_at, deposit_amount, total_amount FROM quotations WHERE id = ?',
      [id]
    );
    if (!quotation) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
    }
    if (quotation.status !== 'approved' || !quotation.converted_receipt_id) {
      await conn.rollback();
      return res.status(400).json({ error: 'ใบเสนอราคานี้ยังไม่อนุมัติ/ยังไม่มีใบเสร็จ กรุณาอนุมัติก่อนปิดบิล' });
    }
    if (quotation.closed_at) {
      await conn.rollback();
      return res.status(400).json({ error: 'ใบเสนอราคานี้ปิดบิลไปแล้ว' });
    }

    // สูตรเดียวกับตอนปิดบิลผ่านไลน์ — ไม่ได้พิมพ์ยอดที่ได้รับจริงมา (paid_amount ว่าง)
    // ก็ fallback เป็นยอดรวมทั้งบิลเดิม (มัดจำ+ยอดรวมทั้งบิล ถ้ามีมัดจำอยู่แล้ว)
    const paidAmountNum = paid_amount !== undefined && paid_amount !== '' && paid_amount !== null
      ? Number(paid_amount)
      : null;
    const receiptAmount = computeReceiptAmount(quotation.deposit_amount, paidAmountNum, Number(quotation.total_amount));

    await conn.execute(
      'UPDATE receipts SET payment_method = ?, total_amount = ? WHERE id = ?',
      [payment_method || null, receiptAmount, quotation.converted_receipt_id]
    );
    await conn.execute('UPDATE quotations SET closed_at = NOW() WHERE id = ?', [id]);

    await conn.commit();

    emitQuotationEvent('quotation:updated', { quotationId: Number(id), status: 'approved', actorId: req.user.id });
    emitReceiptEvent('receipt:updated', { receiptId: quotation.converted_receipt_id, actorId: req.user.id });

    res.json({ success: true, message: 'ปิดบิลสำเร็จ', total_amount: receiptAmount });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackErr) { console.error('Rollback error:', rollbackErr); }
    }
    console.error('Error closing quotation:', err);
    res.status(500).json({ error: 'ปิดบิลไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// PATCH - Mark a quotation as "customer will come back later" with a date
// deposit_amount/deposit_date เป็น optional — เดิม endpoint นี้ตั้งได้แค่วันนัด
// อย่างเดียว พนักงานต้องไปกดแก้ไขใบเสนอราคาแยกอีกทีเพื่อใส่มัดจำ (ถ้าลืมทำ มัดจำ
// จะไม่ถูกบันทึกแม้จะมีวันนัดแล้วก็ตาม) ให้ใส่มัดจำพร้อมวันนัดในขั้นตอนเดียวกันได้เลย
// จากหน้าใบเสนอราคา/หน้านัดหมาย (ScheduleDateDialog.jsx) — ไม่ส่งมาก็แก้ไขแค่วันนัด
// เหมือนเดิมทุกอย่าง (COALESCE เก็บมัดจำเดิมไว้ ไม่ล้างทิ้งถ้าไม่ได้ส่งมาใหม่)
router.patch('/:id/schedule', async (req, res) => {
  const { id } = req.params;
  const { scheduled_date, deposit_amount, deposit_date } = req.body || {};

  if (!scheduled_date) {
    return res.status(400).json({ error: 'กรุณาระบุวันที่' });
  }

  const depositAmount = deposit_amount !== undefined && deposit_amount !== '' && deposit_amount !== null
    ? Number(deposit_amount)
    : undefined;

  try {
    const [result] = await pool.execute(
      `UPDATE quotations SET status = 'scheduled', scheduled_date = ?,
              deposit_amount = COALESCE(?, deposit_amount), deposit_date = COALESCE(?, deposit_date)
       WHERE id = ?`,
      [scheduled_date, depositAmount ?? null, deposit_date || null, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
    }
    emitQuotationEvent('quotation:updated', { quotationId: Number(id), status: 'scheduled', actorId: req.user.id });
    res.json({ success: true, message: 'บันทึกวันนัดหมายสำเร็จ' });
  } catch (err) {
    console.error('Error scheduling quotation:', err);
    res.status(500).json({ error: 'บันทึกวันนัดหมายไม่สำเร็จ' });
  }
});

// อะไหล่มาถึงร้านแล้ว ออฟฟิศโทรแจ้งลูกค้าแล้ว แต่ยังไม่ได้วันที่แน่นอนที่ลูกค้าจะ
// เข้ามาทำ (กดจากกลุ่ม "ยังไม่ระบุวันนัดหมาย" ในหน้านัดหมาย) — ต่างจาก /schedule
// ที่ต้องมีวันที่แน่นอนแล้วเท่านั้น ถ้าลูกค้ายืนยันวันมาระหว่างคุยโทรศัพท์ ให้ข้าม
// ไปกด /schedule ตรงๆ แทนได้เลย ไม่จำเป็นต้องผ่านสถานะนี้ก่อนเสมอไป
router.patch('/:id/mark-called', async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await pool.execute(
      "UPDATE quotations SET status = 'parts_ready' WHERE id = ?",
      [id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
    }
    emitQuotationEvent('quotation:updated', { quotationId: Number(id), status: 'parts_ready', actorId: req.user.id });
    res.json({ success: true, message: 'บันทึกสถานะโทรแจ้งลูกค้าแล้วสำเร็จ' });
  } catch (err) {
    console.error('Error marking quotation as parts-ready:', err);
    res.status(500).json({ error: 'บันทึกไม่สำเร็จ' });
  }
});

// สำนักงานกดยืนยันชัดเจนว่าลูกค้าไม่ระบุวันนัดหมาย (ต่างจาก pending เฉยๆ ที่แปลว่า
// ยังไม่ได้ดำเนินการอะไรเลยกับใบเสนอราคานี้) — รับมัดจำ optional เหมือน /schedule
// ด้านบน (COALESCE เก็บของเดิมไว้ถ้าไม่ได้ส่งมาใหม่)
router.patch('/:id/no-date', async (req, res) => {
  const { id } = req.params;
  const { deposit_amount, deposit_date } = req.body || {};
  const depositAmount = deposit_amount !== undefined && deposit_amount !== '' && deposit_amount !== null
    ? Number(deposit_amount)
    : undefined;

  try {
    const [result] = await pool.execute(
      `UPDATE quotations SET status = 'no_date', scheduled_date = NULL,
              deposit_amount = COALESCE(?, deposit_amount), deposit_date = COALESCE(?, deposit_date)
       WHERE id = ?`,
      [depositAmount ?? null, deposit_date || null, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
    }
    emitQuotationEvent('quotation:updated', { quotationId: Number(id), status: 'no_date', actorId: req.user.id });
    res.json({ success: true, message: 'บันทึกสถานะไม่ระบุวันนัดหมายสำเร็จ' });
  } catch (err) {
    console.error('Error marking quotation as no-date:', err);
    res.status(500).json({ error: 'บันทึกไม่สำเร็จ' });
  }
});

// ชุดเหตุผลคงที่ที่เลือกได้ตอนกด "ลูกค้าไม่ได้ทำ" (mirror กับ DECLINE_REASONS ใน
// frontend/src/utils/declineReasons.js — ต้องแก้ทั้งคู่พร้อมกันถ้าจะเพิ่ม/ลดตัวเลือก)
// จำกัดเป็นค่าคงที่แทนข้อความอิสระ เพื่อให้หน้าสรุปสถิติ (DeclinedSummaryPage.jsx)
// จัดกลุ่มได้ถูกต้องแม่นยำ ไม่กระจัดกระจายเป็นข้อความคนละแบบความหมายเดียวกัน
const DECLINE_REASON_VALUES = ['price_high', 'budget', 'quote_only', 'other_day', 'other'];

// ลูกค้าขอใบเสนอราคาแล้วไม่ได้ทำจริง — สำนักงานกดปุ่ม "ลูกค้าไม่ได้ทำ" บนหน้า
// รายการใบเสนอราคา แยกใบนี้ออกจากรายการหลัก/หน้านัดหมาย ไปอยู่ในหน้า "ลูกค้าที่
// ไม่ได้ทำ" แทน (mirror รูปแบบเดียวกับ /no-date ด้านบน) ต้องระบุเหตุผลด้วยเสมอ (ดู
// DeclineReasonModal.jsx) — reason='other' ต้องมี note มาด้วย ไม่งั้นข้อมูลสรุปจะมีแต่
// "อื่นๆ" ที่ไม่รู้ว่าคืออะไรจริง ๆ
router.patch('/:id/decline', async (req, res) => {
  const { id } = req.params;
  const { reason, note } = req.body || {};

  if (!DECLINE_REASON_VALUES.includes(reason)) {
    return res.status(400).json({ error: 'กรุณาเลือกเหตุผลที่ลูกค้าไม่ได้ทำ' });
  }
  if (reason === 'other' && !note?.trim()) {
    return res.status(400).json({ error: 'กรุณาระบุรายละเอียดเหตุผล' });
  }

  try {
    const [result] = await pool.execute(
      "UPDATE quotations SET status = 'declined', scheduled_date = NULL, decline_reason = ?, decline_note = ? WHERE id = ?",
      [reason, reason === 'other' ? note.trim() : null, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
    }
    emitQuotationEvent('quotation:updated', { quotationId: Number(id), status: 'declined', actorId: req.user.id });
    res.json({ success: true, message: 'บันทึกสถานะลูกค้าไม่ได้ทำสำเร็จ' });
  } catch (err) {
    console.error('Error marking quotation as declined:', err);
    res.status(500).json({ error: 'บันทึกไม่สำเร็จ' });
  }
});

// PATCH - Save the customer's signature (captured on a tablet/phone at the counter)
router.patch('/:id/signature', async (req, res) => {
  const { id } = req.params;
  const { signature } = req.body || {};

  if (!signature || !signature.startsWith('data:image/')) {
    return res.status(400).json({ error: 'ข้อมูลลายเซ็นไม่ถูกต้อง' });
  }

  try {
    const [result] = await pool.execute(
      'UPDATE quotations SET customer_signature = ? WHERE id = ?',
      [signature, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
    }
    emitQuotationEvent('quotation:updated', { quotationId: Number(id), status: null, actorId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    console.error('Error saving quotation signature:', err);
    res.status(500).json({ error: 'บันทึกลายเซ็นไม่สำเร็จ' });
  }
});

// PATCH - Save the staff (seller)'s signature — mirrors /:id/signature above,
// which is the customer's. Both are captured live on the shop's
// tablet/phone at the counter before confirming the quotation.
router.patch('/:id/staff-signature', async (req, res) => {
  const { id } = req.params;
  const { signature, staff_name } = req.body || {};

  if (!signature || !signature.startsWith('data:image/')) {
    return res.status(400).json({ error: 'ข้อมูลลายเซ็นไม่ถูกต้อง' });
  }

  try {
    const [result] = await pool.execute(
      'UPDATE quotations SET staff_signature = ?, staff_name = ? WHERE id = ?',
      [signature, staff_name?.trim() || null, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
    }
    emitQuotationEvent('quotation:updated', { quotationId: Number(id), status: null, actorId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    console.error('Error saving staff signature:', err);
    res.status(500).json({ error: 'บันทึกลายเซ็นไม่สำเร็จ' });
  }
});

// DELETE - Delete quotation
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // ใบที่อนุมัติแล้ว+มีใบเสร็จผูกอยู่ ห้ามลบตรง ๆ — repair_notices.quotation_id
    // เป็น ON DELETE SET NULL (จะหลุดการเชื่อมโยงย้อนกลับไปหาใบเสนอราคาเงียบ ๆ) และ
    // ใบเสร็จเองก็ไม่มีอะไรอ้างอิงกลับมาบอกว่าเคยมาจากใบเสนอราคาใบนี้อีกต่อไป ถ้าจะ
    // ลบจริงต้องลบใบเสร็จ/ยกเลิกอนุมัติก่อน (จัดการผ่านหน้าใบเสร็จแทน)
    const [[quotation]] = await pool.query(
      'SELECT status, converted_receipt_id FROM quotations WHERE id = ?',
      [id]
    );
    if (!quotation) {
      return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
    }
    if (quotation.status === 'approved' && quotation.converted_receipt_id) {
      return res.status(409).json({ error: 'ใบเสนอราคานี้อนุมัติและมีใบเสร็จผูกอยู่แล้ว กรุณาจัดการที่ใบเสร็จแทน' });
    }

    const [result] = await pool.execute(
      'DELETE FROM quotations WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบใบเสนอราคา' });
    }

    emitQuotationEvent('quotation:deleted', { quotationId: Number(id), status: null, actorId: req.user.id });

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
module.exports.generateQuotationNo = generateQuotationNo; // ให้ jobs.routes.js ใช้เลขที่ชุดเดียวกันตอนโปรโมท quote_draft เป็นใบเสนอราคาจริง
module.exports.generateReceiptNo = generateReceiptNo; // ให้ jobs.routes.js สร้างใบเสร็จตอนอนุมัติ ด้วยตรรกะออกเลขเดียวกับ /:id/approve
module.exports.generateRepairNoticeCode = generateRepairNoticeCode; // ให้ jobs.routes.js สร้างใบแจ้งซ่อมคู่กันเหมือน POST /quotations เดิม
module.exports.buildValidItems = buildValidItems; // ให้ jobs.routes.js กรองรายการจาก quote_draft ด้วยกติกาเดียวกัน
module.exports.findInvalidItems = findInvalidItems; // ให้ jobs.routes.js ตรวจสอบ quote_draft.items ก่อนโปรโมท
