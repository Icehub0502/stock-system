// LINE Messaging API webhook — รับข้อความ "คิวรถเข้า" จากไลน์กลุ่มของร้าน
// แล้วสร้างใบเสนอราคาร่าง (ยังไม่มีรายการสินค้า — หน้างานมาเติมทีหลัง) ให้อัตโนมัติ
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
// แล้วไว้กันสร้างใบเสนอราคาซ้ำ เก็บในหน่วยความจำพอ เพราะแอปรันโปรเซสเดียวใน PM2
// และ retry มาภายในไม่กี่นาที
const processedIds = new Set();
const processedOrder = [];
const MAX_PROCESSED = 1000;
function markProcessed(id) {
  processedIds.add(id);
  processedOrder.push(id);
  if (processedOrder.length > MAX_PROCESSED) {
    processedIds.delete(processedOrder.shift());
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

async function generateRepairNoticeCode(conn) {
  const [rows] = await conn.execute(
    "SELECT MAX(CAST(SUBSTRING(code, 4) AS UNSIGNED)) AS maxNo FROM repair_notices WHERE code LIKE 'RN-%'"
  );
  const nextNumber = (rows[0]?.maxNo || 0) + 1;
  return `RN-${String(nextNumber).padStart(4, '0')}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// สร้าง ลูกค้า → รถ → ใบเสนอราคา → ใบแจ้งซ่อม ในทรานแซกชันเดียว ตาม flow
// เดียวกับ POST /quotations ทุกประการ ต่างแค่:
//   - จับคู่ลูกค้าเดิมด้วยเบอร์โทรก่อน (คนเดิมโทรมาซ้ำ ไม่สร้างลูกค้าใหม่ซ้อน)
//   - จับคู่รถเดิมด้วยทะเบียนใต้ลูกค้าคนนั้น
async function createQuotationFromQueue(parsed) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // ลูกค้า: เทียบเบอร์แบบตัดขีด/ช่องว่าง เพราะในฐานข้อมูลพิมพ์มาหลายรูปแบบ
    let customerId = null;
    if (parsed.phone) {
      const [rows] = await conn.execute(
        "SELECT id FROM customers WHERE REPLACE(REPLACE(COALESCE(phone,''), '-', ''), ' ', '') = ? LIMIT 1",
        [parsed.phone]
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
    }

    // รถ: มีทะเบียนตรงกันใต้ลูกค้าคนนี้ → ใช้คันเดิม, ไม่งั้นสร้างใหม่ถ้ามีข้อมูลพอ
    let vehicleId = null;
    if (parsed.license_plate) {
      const [rows] = await conn.execute(
        'SELECT id FROM vehicles WHERE customer_id = ? AND license_plate = ? LIMIT 1',
        [customerId, parsed.license_plate]
      );
      if (rows.length > 0) vehicleId = rows[0].id;
    }
    if (!vehicleId && (parsed.brand || parsed.license_plate)) {
      // brand/model เป็น NOT NULL ใน schema — ข้อความไลน์อาจไม่บอกยี่ห้อ ใช้ '-' คั่นไว้
      const [result] = await conn.execute(
        `INSERT INTO vehicles (customer_id, brand, model, color, license_plate, mileage)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [customerId, parsed.brand || '-', parsed.model || '-', null, parsed.license_plate || null, 0]
      );
      vehicleId = result.insertId;
    }

    const quotationDate = todayStr();
    const quotation_no = await generateQuotationNo(conn);
    const [quotationResult] = await conn.execute(
      `INSERT INTO quotations (quotation_no, quotation_date, customer_id, vehicle_id, mileage, remark, product_summary, total_amount, queue_no, symptom)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [quotation_no, quotationDate, customerId, vehicleId, 0, null, '', 0, parsed.queue_no || null, parsed.symptom || null]
    );
    const quotationId = quotationResult.insertId;

    // ใบแจ้งซ่อมเปล่าคู่กัน — เหมือน POST /quotations ที่สร้างให้ทันทีเพื่อให้รถ
    // โผล่ในหน้าใบแจ้งซ่อมโดยไม่ต้องรออนุมัติ
    if (vehicleId) {
      const rnCode = await generateRepairNoticeCode(conn);
      await conn.execute(
        `INSERT INTO repair_notices (code, customer_id, vehicle_id, quotation_id, notice_date, checklist)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [rnCode, customerId, vehicleId, quotationId, quotationDate, '{}']
      );
    }

    await conn.commit();
    return { quotation_no };
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackErr) { console.error('Rollback error:', rollbackErr); }
    }
    throw err;
  } finally {
    if (conn) conn.release();
  }
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

  for (const event of events) {
    if (event.type !== 'message' || event.message?.type !== 'text') continue;

    const messageId = event.message.id;
    if (messageId && processedIds.has(messageId)) continue;

    const parsed = parseLineQueueMessage(event.message.text);
    if (!parsed) continue; // แชตทั่วไปในกลุ่ม — ข้ามเงียบ ๆ ไม่ตอบ ไม่รบกวน

    if (messageId) markProcessed(messageId);

    try {
      const { quotation_no } = await createQuotationFromQueue(parsed);
      created.push(quotation_no);
      await replyToLine(
        event.replyToken,
        `✅ สร้างใบเสนอราคา ${quotation_no} แล้ว\nคิว ${parsed.queue_no || '-'} · ${parsed.customer_name}${parsed.license_plate ? ` · ${parsed.license_plate}` : ''}`
      );
    } catch (err) {
      console.error('Error creating quotation from LINE message:', err);
      await replyToLine(
        event.replyToken,
        `❌ สร้างใบเสนอราคาไม่สำเร็จ (คิว ${parsed.queue_no || '-'}) กรุณาสร้างเองในระบบ`
      );
    }
  }

  res.json({ success: true, created });
});

module.exports = router;
