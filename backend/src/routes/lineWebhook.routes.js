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

// เลือกใช้เฉพาะตอนชื่อที่พิมพ์มาตรงกับสินค้าในแคตาล็อกแบบไม่มีข้อโต้แย้ง (ตัดช่องว่าง
// แล้วตรงกันเป๊ะ 1 รายการ) — ตั้งใจไม่ใช้ LIKE คลุมเครือ (เช่น "แร็ค" ตรงกับ "แร็ค OEM"/
// "แร็คบิ้ว"/"แร็คมือสอง" หลายรายการพร้อมกัน) เพราะเดาผิดจะได้ชื่อ/ประกันผิดในใบเสนอราคา
// ไม่ match ก็ยังเป็นรายการได้ปกติ แค่ไม่ได้ผูกหมวดหมู่/ประกันให้เท่านั้น รวม "ชุด"
// (is_set=1 เช่น ชุดโปรช่วงล่างเก๋ง/กระบะ) ไว้ด้วย — บรรทัดในเซคชัน "รายการ:" ถือว่า
// ตั้งใจคิดราคาจริงแล้ว จึงดึง set_price ของแคตาล็อกมาใช้ได้เมื่อข้อความไม่ได้ระบุราคาเอง
async function matchServiceItem(conn, name) {
  const normalized = name.replace(/\s+/g, '');
  const [rows] = await conn.execute(
    `SELECT si.product_name, si.category, si.is_set, si.set_price,
            w.warranty_name, w.warranty_year, w.warranty_month, w.warranty_km
     FROM service_items si
     LEFT JOIN warranties w ON si.warranty_id = w.id
     WHERE si.is_active = 1 AND REPLACE(si.product_name, ' ', '') = ?
     LIMIT 2`,
    [normalized]
  );
  return rows.length === 1 ? rows[0] : null;
}

// สร้าง ลูกค้า → รถ → ใบเสนอราคา → ใบแจ้งซ่อม ในทรานแซกชันเดียว ตาม flow
// เดียวกับ POST /quotations ทุกประการ ต่างแค่:
//   - จับคู่ลูกค้าเดิมด้วยเบอร์โทรก่อน (คนเดิมโทรมาซ้ำ ไม่สร้างลูกค้าใหม่ซ้อน)
//   - จับคู่รถเดิมด้วยทะเบียนใต้ลูกค้าคนนั้น
//   - รายการสินค้าที่พาร์สได้ (ชื่อ+ราคาบรรทัดเดียวกัน) จะพยายามจับคู่กับแคตาล็อก
//     รายการสินค้า/บริการ เพื่อดึงชื่อมาตรฐาน+ประกันมาใส่ให้ ถ้าจับคู่ไม่ได้ก็ยัง
//     ใส่เป็นรายการด้วยชื่อที่พิมพ์มาตามเดิม
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

    // จับคู่แต่ละรายการกับแคตาล็อกก่อน insert quotation หลัก เพราะต้องใช้ผลรวม
    // ราคามาเป็น total_amount และชื่อสินค้ามาเป็น product_summary
    const resolvedItems = [];
    for (const item of parsed.items) {
      const match = await matchServiceItem(conn, item.name);
      // item.price === null คือไม่มีราคาในข้อความ (เช่น "ชุดโปรช่วงล่าง เก๋ง") —
      // ใช้ set_price ของแคตาล็อกถ้า match เป็นชุด ไม่งั้น 0 ให้หน้างานกรอกเอง
      const unit_price = item.price != null ? item.price : Number(match?.set_price || 0);
      resolvedItems.push({
        product_name: match ? match.product_name : item.name,
        quantity: 1,
        unit_price,
        warranty_name: match?.warranty_name || null,
        warranty_year: match?.warranty_year || 0,
        warranty_month: match?.warranty_month || 0,
        warranty_km: match?.warranty_km || 0,
      });
    }
    const total_amount = resolvedItems.reduce((sum, it) => sum + it.quantity * it.unit_price, 0);
    const product_summary = resolvedItems.map((it) => it.product_name).join(', ');

    const quotationDate = parsed.quotation_date || todayStr();
    const quotation_no = await generateQuotationNo(conn);
    const [quotationResult] = await conn.execute(
      `INSERT INTO quotations (quotation_no, quotation_date, customer_id, vehicle_id, mileage, remark, product_summary, total_amount, queue_no, symptom)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [quotation_no, quotationDate, customerId, vehicleId, 0, parsed.remark || null, product_summary, total_amount, parsed.queue_no || null, parsed.symptom || null]
    );
    const quotationId = quotationResult.insertId;

    for (const item of resolvedItems) {
      await conn.execute(
        `INSERT INTO quotation_items (quotation_id, product_id, product_name, quantity, unit_price, warranty_name, warranty_year, warranty_month, warranty_km)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
        [quotationId, item.product_name, item.quantity, item.unit_price, item.warranty_name, item.warranty_year, item.warranty_month, item.warranty_km]
      );
    }

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
    return { quotation_no, itemCount: resolvedItems.length, totalAmount: total_amount, hasNote: Boolean(parsed.remark) };
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
      const { quotation_no, itemCount, totalAmount, hasNote } = await createQuotationFromQueue(parsed);
      created.push(quotation_no);
      const itemLine = itemCount > 0
        ? `รายการ ${itemCount} ชิ้น รวม ${totalAmount.toLocaleString()} บาท`
        : 'ยังไม่มีรายการสินค้า (เพิ่มในแอปได้)';
      const noteLine = hasNote ? '\n📝 มีข้อความเพิ่มเติมที่ไม่ได้แยกเป็นรายการ ดูในหมายเหตุของใบเสนอราคา' : '';
      await replyToLine(
        event.replyToken,
        `✅ สร้างใบเสนอราคา ${quotation_no} แล้ว\nคิว ${parsed.queue_no || '-'} · ${parsed.customer_name}${parsed.license_plate ? ` · ${parsed.license_plate}` : ''}\n${itemLine}${noteLine}`
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
