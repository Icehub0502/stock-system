// LINE Messaging API webhook — รับข้อความ "คิวรถเข้า" จากไลน์กลุ่มของร้าน แล้ว
// สร้าง (หรือแก้ไข) ใบเสนอราคาร่างให้อัตโนมัติ — ไม่สร้างใบแจ้งซ่อม (รอกดอนุมัติ
// ก่อนถึงสร้างให้ ดู PATCH /quotations/:id/approve)
//
// เส้นทางนี้ไม่ผ่าน authenticate (LINE ล็อกอินไม่ได้) — ใช้ลายเซ็น HMAC-SHA256
// จาก LINE แทน: ทุก request ต้องมี X-Line-Signature ที่คำนวณจาก raw body +
// LINE_CHANNEL_SECRET ตรงกัน ไม่งั้นปฏิเสธ 401 (กันคนนอกยิง endpoint ตรง ๆ)
//
// .env ที่ต้องมี:
//   LINE_CHANNEL_SECRET       — จากหน้า Basic settings ของ LINE Developers console
//   LINE_CHANNEL_ACCESS_TOKEN — จากหน้า Messaging API (ใช้ตอบยืนยันกลับเข้ากลุ่ม;
//                               เว้นว่างได้ บอทจะเงียบแต่ยังสร้างใบเสนอราคาให้ปกติ)
const crypto = require('crypto');
const express = require('express');
const pool = require('../db/pool');
const parseLineQueueMessage = require('../utils/parseLineQueueMessage');

const router = express.Router();

// LINE ส่ง webhook ซ้ำได้ (retry เมื่อคิดว่า timeout) — จำ message id ที่ประมวลผล
// แล้วไว้กันสร้างใบเสนอราคาซ้ำ และจำว่าข้อความไหนสร้างใบเสนอราคาใหม่ไว้บ้าง
// (customer id/vehicle id) ไว้ใช้ตอนพิมพ์ผิดแล้วลบ/เรียกคืนข้อความ (unsend) — ลบ
// ใบเสนอราคานั้นให้อัตโนมัติ (ดู deleteQuotationForMessage) เฉพาะข้อความที่ "เปิด
// ใบใหม่" เท่านั้น — ข้อความที่ไปแก้ไขใบเดิม (คิว+ลูกค้าเดียวกัน) ไม่ถูกจำไว้ตรงนี้
// กันเรียกคืนข้อความล่าสุดแล้วลบใบที่มีข้อมูลจากข้อความก่อนหน้าอยู่ด้วย เก็บใน
// หน่วยความจำพอ เพราะแอปรันโปรเซสเดียวใน PM2 และเรื่องพวกนี้มักเกิดใกล้ ๆ เวลาที่
// พิมพ์ผิดเท่านั้น
const MAX_TRACKED = 1000;
const processedIds = new Set();
const processedOrder = [];
const messageQuotations = new Map(); // messageId -> { quotationId, quotationNo, customerId, vehicleId, wasNewCustomer, wasNewVehicle }
const trackedOrder = [];

function markProcessed(id) {
  processedIds.add(id);
  processedOrder.push(id);
  if (processedOrder.length > MAX_TRACKED) {
    processedIds.delete(processedOrder.shift());
  }
}

function trackMessageQuotation(messageId, info) {
  if (!messageId) return;
  messageQuotations.set(messageId, info);
  trackedOrder.push(messageId);
  if (trackedOrder.length > MAX_TRACKED) {
    messageQuotations.delete(trackedOrder.shift());
  }
}

function verifySignature(rawBody, signature, secret) {
  if (!rawBody || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ตอบกลับเข้าห้องแชตด้วย reply token (ฟรี ไม่นับโควตา push) — best-effort:
// ตอบไม่สำเร็จก็แค่ log ไว้ ใบเสนอราคาสร้างเสร็จไปแล้วไม่ต้อง rollback
async function replyToLine(replyToken, text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !replyToken) return;
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
    });
    if (!res.ok) {
      console.error('LINE reply failed:', res.status, await res.text());
    }
  } catch (err) {
    console.error('LINE reply error:', err.message);
  }
}

// ── ตัวสร้างเลขเอกสาร: mirror จาก quotations.routes.js (ตามแบบแผนเดิมของ
// โปรเจกต์ที่ generateReceiptNo/generateRepairNoticeCode ก็ mirror ข้ามไฟล์กัน) ──
async function generateQuotationNo(conn) {
  const today = new Date();
  const dateStr = String(today.getDate()).padStart(2, '0')
                + String(today.getMonth() + 1).padStart(2, '0')
                + String(today.getFullYear()).slice(-2);
  const [rows] = await conn.execute(
    'SELECT MAX(CAST(SUBSTRING(quotation_no, -3) AS UNSIGNED)) as maxNo FROM quotations WHERE quotation_no LIKE ?',
    [`IV${dateStr}%`]
  );
  const nextNumber = (rows[0]?.maxNo || 0) + 1;
  return `IV${dateStr}${String(nextNumber).padStart(3, '0')}`;
}

async function generateCustomerCode(conn) {
  const [rows] = await conn.execute(
    "SELECT MAX(CAST(SUBSTRING(customer_code, 5) AS UNSIGNED)) AS maxCode FROM customers WHERE customer_code LIKE 'CMM-%'"
  );
  const nextNumber = (rows[0]?.maxCode || 0) + 1;
  return `CMM-${String(nextNumber).padStart(4, '0')}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// เลือกใช้เฉพาะตอนชื่อที่พิมพ์มาตรงกับสินค้าในแคตาล็อกแบบไม่มีข้อโต้แย้ง (ตัดช่องว่าง
// แล้วตรงกันเป๊ะ 1 รายการ) — ตั้งใจไม่ใช้ LIKE คลุมเครือ (เช่น "แร็ค" ตรงกับ "แร็ค OEM"/
// "แร็คบิ้ว"/"แร็คมือสอง" หลายรายการพร้อมกัน) เพราะเดาผิดจะได้ชื่อ/ประกันผิดในใบเสนอราคา
// ไม่ match ก็ยังเป็นรายการได้ปกติ แค่ไม่ได้ผูกหมวดหมู่/ประกันให้เท่านั้น
async function matchServiceItem(conn, name) {
  const normalized = name.replace(/\s+/g, '');
  const [rows] = await conn.execute(
    `SELECT si.id, si.product_name, si.category, si.is_set,
            w.warranty_name, w.warranty_year, w.warranty_month, w.warranty_km
     FROM service_items si
     LEFT JOIN warranties w ON si.warranty_id = w.id
     WHERE si.is_active = 1 AND REPLACE(si.product_name, ' ', '') = ?
     LIMIT 2`,
    [normalized]
  );
  return rows.length === 1 ? rows[0] : null;
}

// รายการที่พิมพ์มา → แถวใบเสนอราคา 1 แถวขึ้นไป จับคู่แคตาล็อกไม่ได้ก็ยังใส่เป็น
// รายการเดี่ยวด้วยชื่อที่พิมพ์มาตามเดิม (ราคาใช้ตัวที่พิมพ์มา ไม่มีค่อยเป็น 0 —
// ไม่เดาราคาจากแคตาล็อก เพราะราคาจริงอาจเปลี่ยนบ่อยกว่าที่ระบบตั้งไว้)
//
// จับคู่ได้แต่เป็น "ชุด" (is_set=1 เช่น ชุดโปรช่วงล่างเก๋ง/กระบะ/March/Almera) จะ
// ขยายเป็นหลายแถวตามรายการย่อยใน service_item_components — พฤติกรรมเดียวกับตอน
// หน้างานเลือกชุดเองในแอป (ดู expandSetIntoItems ใน QuotationFormModal.jsx/
// ReceiptFormModal.jsx): แถวแรก (สรุปหัวข้อชุด) ใส่ราคาที่พิมพ์มาไว้ แถวย่อยที่
// เหลือ (รายการอุปกรณ์ในชุด) ราคา 0 ทุกแถว — ทุกแถวได้ประกันของชุดเหมือนกันหมด
async function resolveQuotationItemRows(conn, item) {
  const match = await matchServiceItem(conn, item.name);
  const price = item.price != null ? item.price : 0;

  if (!match) {
    return [{ product_name: item.name, quantity: 1, unit_price: price, warranty_name: null, warranty_year: 0, warranty_month: 0, warranty_km: 0 }];
  }

  const warranty = {
    warranty_name: match.warranty_name || null,
    warranty_year: match.warranty_year || 0,
    warranty_month: match.warranty_month || 0,
    warranty_km: match.warranty_km || 0,
  };

  if (!match.is_set) {
    return [{ product_name: match.product_name, quantity: 1, unit_price: price, ...warranty }];
  }

  const [components] = await conn.execute(
    'SELECT component_name, default_qty FROM service_item_components WHERE service_item_id = ? ORDER BY sort_order ASC, id ASC',
    [match.id]
  );
  const parts = components.length > 0 ? components : [{ component_name: match.product_name, default_qty: 1 }];
  return parts.map((part, index) => ({
    product_name: part.component_name,
    quantity: Number(part.default_qty) > 0 ? Number(part.default_qty) : 1,
    unit_price: index === 0 ? price : 0, // ราคาที่พิมพ์มาอยู่แถวบนสุด (หัวข้อชุด) แถวย่อยที่เหลือเป็น 0
    ...warranty,
  }));
}

// สร้าง (หรือแก้ไข) ลูกค้า → รถ → ใบเสนอราคา ในทรานแซกชันเดียว ตาม flow เดียวกับ
// POST /quotations เกือบทุกประการ ต่างแค่:
//   - จับคู่ลูกค้าเดิมด้วยเบอร์โทรก่อน (คนเดิมโทรมาซ้ำ ไม่สร้างลูกค้าใหม่ซ้อน)
//   - จับคู่รถเดิมด้วยทะเบียนใต้ลูกค้าคนนั้น
//   - ทุกรายการที่พาร์สได้จะพยายามจับคู่กับแคตาล็อกรายการสินค้า/บริการเสมอ เพื่อ
//     ดึงชื่อมาตรฐาน+ประกันมาใส่ให้ ถ้าจับคู่ไม่ได้ก็ยังใส่เป็นรายการด้วยชื่อที่
//     พิมพ์มาตามเดิม (ราคาใช้ตัวที่พิมพ์มาก่อนเสมอ ไม่มีค่อยใช้ราคาแคตาล็อก)
//   - ไม่สร้างใบแจ้งซ่อมที่นี่ — รอสร้างตอนกดอนุมัติ (ดู PATCH /quotations/:id/approve)
//     เพราะข้อความจากไลน์เป็นแค่ร่าง หน้างานอาจยังไม่ได้ตรวจสอบ
//   - ถ้ามีใบเสนอราคาของลูกค้า+คิวเดียวกัน สร้างวันนี้ และยังไม่อนุมัติอยู่แล้ว ถือ
//     ว่าเป็นข้อความที่พิมพ์ซ้ำ/ทยอยเพิ่มรายการทีหลัง (คัดลอกหัวข้อมูลเดิมมาทั้งชุด
//     แล้วต่อท้ายด้วย "รายการ:") → แก้ไขใบเดิมแทนการเปิดใบใหม่ซ้อน (isUpdate: true)
//   - คืนค่า wasNewCustomer/wasNewVehicle ไว้ให้ผู้เรียกใช้ตอนต้องล้างข้อมูลถ้า
//     ข้อความต้นทางถูกลบ/เรียกคืนทีหลัง (ดู handleUnsend) — ข้อความที่ไป "แก้ไข"
//     ใบเดิม (ไม่ใช่เปิดใบใหม่) จะไม่ถูกติดตามเพื่อลบ กันไม่ให้เรียกคืนข้อความล่าสุด
//     แล้วทำลายข้อมูลจากข้อความก่อนหน้าที่ยังอ้างอิงใบเดียวกันอยู่ไปด้วย
async function createQuotationFromQueue(parsed) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // ลูกค้า: เทียบเบอร์แบบตัดขีด/ช่องว่าง เพราะในฐานข้อมูลพิมพ์มาหลายรูปแบบ
    let customerId = null;
    let wasNewCustomer = false;
    if (parsed.phone) {
      const [rows] = await conn.execute(
        "SELECT id FROM customers WHERE REPLACE(REPLACE(COALESCE(phone,''), '-', ''), ' ', '') = ? LIMIT 1",
        [parsed.phone.replace(/[-\s]/g, '')]
      );
      if (rows.length > 0) customerId = rows[0].id;
    }
    if (!customerId) {
      const customerCode = await generateCustomerCode(conn);
      const [result] = await conn.execute(
        'INSERT INTO customers (customer_code, customer_name, phone) VALUES (?, ?, ?)',
        [customerCode, parsed.customer_name, parsed.phone || null]
      );
      customerId = result.insertId;
      wasNewCustomer = true;
    }

    // รถ: มีทะเบียนตรงกันใต้ลูกค้าคนนี้ → ใช้คันเดิม, ไม่มีทะเบียนในข้อความ →
    // ลองเทียบยี่ห้อ+รุ่นแทน (ร้านบางทีไม่พิมพ์ทะเบียน กันสร้างรถซ้ำทุกครั้งที่ส่ง
    // ข้อความแก้ไข), ไม่เจอเลยค่อยสร้างใหม่ถ้ามีข้อมูลพอ
    let vehicleId = null;
    let wasNewVehicle = false;
    if (parsed.license_plate) {
      const [rows] = await conn.execute(
        'SELECT id FROM vehicles WHERE customer_id = ? AND license_plate = ? LIMIT 1',
        [customerId, parsed.license_plate]
      );
      if (rows.length > 0) vehicleId = rows[0].id;
    } else if (parsed.brand) {
      const [rows] = await conn.execute(
        'SELECT id FROM vehicles WHERE customer_id = ? AND brand = ? AND model = ? ORDER BY id DESC LIMIT 1',
        [customerId, parsed.brand, parsed.model || '-']
      );
      if (rows.length > 0) vehicleId = rows[0].id;
    }
    if (vehicleId && (parsed.color || parsed.mileage != null)) {
      // รถคันเดิมแต่ข้อความบอกสี/เลขไมล์มาใหม่ → อัปเดตให้เป็นค่าล่าสุด (เลขไมล์
      // เปลี่ยนทุกครั้งที่รถเข้า, สีเติมให้ถ้าเพิ่งบอกมา) ค่าที่ไม่ได้บอกไม่แตะ
      await conn.execute(
        'UPDATE vehicles SET color = COALESCE(?, color), mileage = COALESCE(?, mileage) WHERE id = ?',
        [parsed.color || null, parsed.mileage ?? null, vehicleId]
      );
    }
    if (!vehicleId && (parsed.brand || parsed.license_plate)) {
      // brand/model เป็น NOT NULL ใน schema — ข้อความไลน์อาจไม่บอกยี่ห้อ ใช้ '-' คั่นไว้
      const [result] = await conn.execute(
        `INSERT INTO vehicles (customer_id, brand, model, color, license_plate, mileage)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [customerId, parsed.brand || '-', parsed.model || '-', parsed.color || null, parsed.license_plate || null, parsed.mileage ?? 0]
      );
      vehicleId = result.insertId;
      wasNewVehicle = true;
    }

    // จับคู่แต่ละรายการกับแคตาล็อกก่อน insert/update quotation หลัก เพราะต้องใช้
    // ผลรวมราคามาเป็น total_amount และชื่อสินค้ามาเป็น product_summary — รายการที่
    // เป็น "ชุด" ขยายเป็นหลายแถว (ดู resolveQuotationItemRows) จึงต้อง flatten
    const resolvedItems = [];
    for (const item of parsed.items) {
      const rows = await resolveQuotationItemRows(conn, item);
      resolvedItems.push(...rows);
    }
    const total_amount = resolvedItems.reduce((sum, it) => sum + it.quantity * it.unit_price, 0);
    const product_summary = resolvedItems.map((it) => it.product_name).join(', ');
    const quotationDate = parsed.quotation_date || todayStr();

    // ใบเสนอราคาเดิมของลูกค้า+คิวเดียวกัน สร้างวันนี้ → แก้ไขใบนั้นแทนสร้างซ้ำ ไม่ว่า
    // จะยัง pending หรืออนุมัติไปแล้วก็ตาม (อนุมัติแล้วไม่ได้แปลว่าบิลจบ — พนักงานพิมพ์
    // แก้ไขรายการทางไลน์ได้เรื่อย ๆ จนกว่าจะมีคำว่า "ชำระเงินเรียบร้อย/แล้ว" ซึ่งกรอง
    // ข้อความทั้งข้อความทิ้งไปแล้วตั้งแต่ parseLineQueueMessage — ถ้าอนุมัติแล้วและมี
    // ใบเสร็จผูกอยู่ ด้านล่างจะ sync ใบเสร็จนั้นให้ตรงกันด้วย)
    let existing = null;
    if (parsed.queue_no) {
      const [rows] = await conn.execute(
        `SELECT id, quotation_no, status, converted_receipt_id FROM quotations
         WHERE customer_id = ? AND queue_no = ? AND quotation_date = ? AND status IN ('pending', 'approved')
         ORDER BY id DESC LIMIT 1`,
        [customerId, parsed.queue_no, quotationDate]
      );
      if (rows.length > 0) existing = rows[0];
    }

    let quotationId;
    let quotation_no;
    const isUpdate = Boolean(existing);
    if (isUpdate) {
      quotationId = existing.id;
      quotation_no = existing.quotation_no;
      await conn.execute(
        `UPDATE quotations SET vehicle_id = ?, mileage = COALESCE(?, mileage), remark = ?, product_summary = ?, total_amount = ?, symptom = ?
         WHERE id = ?`,
        [vehicleId, parsed.mileage ?? null, parsed.remark || null, product_summary, total_amount, parsed.symptom || null, quotationId]
      );
      await conn.execute('DELETE FROM quotation_items WHERE quotation_id = ?', [quotationId]);
    } else {
      quotation_no = await generateQuotationNo(conn);
      const [quotationResult] = await conn.execute(
        `INSERT INTO quotations (quotation_no, quotation_date, customer_id, vehicle_id, mileage, remark, product_summary, total_amount, queue_no, symptom)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [quotation_no, quotationDate, customerId, vehicleId, parsed.mileage ?? 0, parsed.remark || null, product_summary, total_amount, parsed.queue_no || null, parsed.symptom || null]
      );
      quotationId = quotationResult.insertId;
    }

    for (const item of resolvedItems) {
      await conn.execute(
        `INSERT INTO quotation_items (quotation_id, product_id, product_name, quantity, unit_price, warranty_name, warranty_year, warranty_month, warranty_km)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
        [quotationId, item.product_name, item.quantity, item.unit_price, item.warranty_name, item.warranty_year, item.warranty_month, item.warranty_km]
      );
    }

    // แก้ไขใบที่อนุมัติไปแล้ว (มีใบเสร็จผูกอยู่) → sync ใบเสร็จให้ตรงกันด้วยเลย
    // (เหมือน PUT /quotations/:id ฝั่งเว็บ) กันไม่ให้ต้องแก้ 2 ที่
    let syncedReceipt = false;
    if (isUpdate && existing.status === 'approved' && existing.converted_receipt_id) {
      const receiptId = existing.converted_receipt_id;
      await conn.execute(
        `UPDATE receipts SET customer_id = ?, vehicle_id = ?, mileage = COALESCE(?, mileage), remark = ?, total_amount = ? WHERE id = ?`,
        [customerId, vehicleId, parsed.mileage ?? null, parsed.remark || null, total_amount, receiptId]
      );
      await conn.execute('DELETE FROM receipt_items WHERE receipt_id = ?', [receiptId]);
      for (const item of resolvedItems) {
        await conn.execute(
          `INSERT INTO receipt_items (receipt_id, service_item_id, product_name_snapshot, qty, price, amount, warranty_name, warranty_year, warranty_month, warranty_km)
           VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [receiptId, item.product_name, item.quantity, item.unit_price, item.quantity * item.unit_price, item.warranty_name, item.warranty_year, item.warranty_month, item.warranty_km]
        );
      }
      syncedReceipt = true;
    }

    await conn.commit();
    return {
      quotation_no,
      quotationId,
      itemCount: resolvedItems.length,
      totalAmount: total_amount,
      hasNote: Boolean(parsed.remark),
      customerId,
      vehicleId,
      wasNewCustomer,
      wasNewVehicle,
      isUpdate,
      syncedReceipt,
    };
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackErr) { console.error('Rollback error:', rollbackErr); }
    }
    throw err;
  } finally {
    if (conn) conn.release();
  }
}

// ข้อความที่สร้างใบเสนอราคาแล้วถูกลบ/เรียกคืนทีหลัง (พิมพ์ผิด) → ลบใบเสนอราคา
// (cascade ลบ quotation_items ให้เองจาก FK) แล้วลองลบลูกค้า/รถที่เพิ่งสร้างใหม่
// จากข้อความนี้ — ลบแบบ "ลองแล้วปล่อยผ่านถ้าติด FK" เพราะถ้ามีอย่างอื่นมาอ้างอิง
// ลูกค้า/รถนี้ไปแล้ว (เช่นพิมพ์ข้อความใหม่ถูกก่อนลบอันเก่า) แปลว่าไม่ใช่ของทิ้งเปล่า
// อีกต่อไป ต้องเก็บไว้ — ถ้าใบเสนอราคาถูกอนุมัติไปแล้ว (มีใบแจ้งซ่อม/ใบเสร็จจริง
// ผูกอยู่) ไม่ลบ ปล่อยผ่านเงียบ ๆ กันข้อมูลจริงหายเพราะแค่เรียกคืนข้อความเก่า
async function deleteQuotationForMessage(info) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[quotation]] = await conn.query('SELECT status FROM quotations WHERE id = ?', [info.quotationId]);
    if (!quotation || quotation.status !== 'pending') {
      await conn.commit();
      return;
    }
    await conn.execute('DELETE FROM quotations WHERE id = ?', [info.quotationId]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  if (info.wasNewVehicle) {
    try {
      await pool.execute('DELETE FROM vehicles WHERE id = ?', [info.vehicleId]);
    } catch (err) {
      console.log('Vehicle still referenced elsewhere, keeping it:', info.vehicleId);
    }
  }
  if (info.wasNewCustomer) {
    try {
      await pool.execute('DELETE FROM customers WHERE id = ?', [info.customerId]);
    } catch (err) {
      console.log('Customer still referenced elsewhere, keeping it:', info.customerId);
    }
  }
}

// แยกเป็นฟังก์ชันล้วน (pure) ทดสอบได้โดยไม่ต้องยิง LINE API จริง — โดยเฉพาะ
// ส่วนเตือนยอดไม่ตรง (mismatchLine) ที่ไม่มีทางสังเกตได้จากเทสต์ end-to-end เลย
// เพราะ replyToLine คุยกับ LINE API ตรง ๆ ไม่มี side effect อื่นให้ตรวจสอบ
function buildSuccessReplyText(parsed, info) {
  const { quotation_no, itemCount, totalAmount, hasNote, isUpdate, syncedReceipt } = info;
  const itemLine = itemCount > 0
    ? `รายการ ${itemCount} ชิ้น รวม ${totalAmount.toLocaleString()} บาท`
    : 'ยังไม่มีรายการสินค้า (เพิ่มในแอปได้)';
  const noteLine = hasNote ? '\n📝 มีข้อความเพิ่มเติมที่ไม่ได้แยกเป็นรายการ ดูในหมายเหตุของใบเสนอราคา' : '';
  // ร้านบางทีก็แจ้งยอดรวมมาเองในข้อความ ("รวม 23000") — เทียบกับที่คำนวณจริง
  // แล้วเตือนถ้าไม่ตรง กันบิลผิดหลุดไปถึงลูกค้าโดยไม่มีใครสังเกต
  const mismatchLine = parsed.stated_total != null && parsed.stated_total !== totalAmount
    ? `\n⚠️ ยอดที่แจ้งในไลน์ (${parsed.stated_total.toLocaleString()} บาท) ไม่ตรงกับผลรวมรายการ (${totalAmount.toLocaleString()} บาท) กรุณาตรวจสอบ`
    : '';
  // แก้ไขใบที่อนุมัติไปแล้ว → ใบเสร็จที่สร้างไว้ก่อนหน้าก็ถูกแก้ตามด้วย ต้องเตือน
  // ให้พิมพ์ใหม่ ไม่งั้นใบที่พิมพ์ไปแล้วจะไม่ตรงกับข้อมูลในระบบ
  const syncedLine = syncedReceipt ? '\n🧾 ใบเสร็จที่อนุมัติไว้แล้วถูกแก้ตามด้วย กรุณาพิมพ์ใหม่' : '';
  const verb = isUpdate ? 'แก้ไขใบเสนอราคา' : 'สร้างใบเสนอราคา';
  return `✅ ${verb} ${quotation_no} แล้ว\nคิว ${parsed.queue_no || '-'} · ${parsed.customer_name}${parsed.license_plate ? ` · ${parsed.license_plate}` : ''}\n${itemLine}${noteLine}${mismatchLine}${syncedLine}`;
}

router.post('/webhook', async (req, res) => {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) {
    // ยังไม่ได้ตั้งค่า — ปฏิเสธไว้ก่อน ไม่เปิด endpoint ทิ้งไว้ให้ใครก็ยิงได้
    return res.status(503).json({ error: 'LINE webhook not configured' });
  }
  if (!verifySignature(req.rawBody, req.get('x-line-signature'), secret)) {
    return res.status(401).json({ error: 'invalid signature' });
  }

  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  const created = [];
  const deleted = [];

  for (const event of events) {
    // ผู้ใช้พิมพ์ผิดแล้วกด "เรียกคืน" ข้อความใน LINE — ถ้าข้อความนั้นเคยสร้าง
    // ใบเสนอราคาไว้ ให้ลบใบนั้นตาม (ไม่มี replyToken ในอีเวนต์นี้ ตอบกลับไม่ได้)
    if (event.type === 'unsend') {
      const messageId = event.unsend?.messageId;
      const info = messageId && messageQuotations.get(messageId);
      if (info) {
        messageQuotations.delete(messageId);
        try {
          await deleteQuotationForMessage(info);
          deleted.push(info.quotation_no);
        } catch (err) {
          console.error('Error deleting quotation after LINE unsend:', err);
        }
      }
      continue;
    }

    if (event.type !== 'message' || event.message?.type !== 'text') continue;

    const messageId = event.message.id;
    if (messageId && processedIds.has(messageId)) continue;

    const parsed = parseLineQueueMessage(event.message.text);
    if (!parsed) continue; // แชตทั่วไปในกลุ่ม — ข้ามเงียบ ๆ ไม่ตอบ ไม่รบกวน

    if (messageId) markProcessed(messageId);

    try {
      const info = await createQuotationFromQueue(parsed);
      created.push(info.quotation_no);
      // ติดตามไว้ลบตอน unsend เฉพาะข้อความที่ "เปิดใบใหม่" เท่านั้น — ข้อความที่ไป
      // แก้ไขใบเดิม (isUpdate) ไม่ติดตาม กันเรียกคืนข้อความล่าสุดแล้วลบใบที่มี
      // ข้อมูลจากข้อความก่อนหน้าอยู่ด้วยไปโดยไม่ตั้งใจ
      if (!info.isUpdate) {
        trackMessageQuotation(messageId, info);
      }
      await replyToLine(event.replyToken, buildSuccessReplyText(parsed, info));
    } catch (err) {
      console.error('Error creating quotation from LINE message:', err);
      await replyToLine(
        event.replyToken,
        `❌ สร้างใบเสนอราคาไม่สำเร็จ (คิว ${parsed.queue_no || '-'}) กรุณาสร้างเองในระบบ`
      );
    }
  }

  res.json({ success: true, created, deleted });
});

module.exports = router;
module.exports.buildSuccessReplyText = buildSuccessReplyText; // ให้เทสต์เรียกตรง ๆ ได้โดยไม่ต้องยิง LINE API จริง
