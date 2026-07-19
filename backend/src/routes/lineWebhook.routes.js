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
// กันเรียกคืนข้อความล่าสุดแล้วลบใบที่มีข้อมูลจากข้อความก่อนหน้าอยู่ด้วย
//
// เก็บลง DB จริง (ตาราง processed_line_messages ดู db/init.js) ไม่ใช่แค่หน่วยความจำ
// อีกต่อไป — เดิมใช้ Set/Map ล้วน ๆ ทำให้ทุกครั้งที่ PM2 restart/deploy ข้อมูลนี้
// หายหมด ถ้า LINE retry ข้อความเดิมมาหลัง restart พอดีจะสร้างใบเสนอราคาซ้ำได้ ยังคง
// แคช Set ไว้ในหน่วยความจำเป็นชั้นเร็ว ๆ ด้านหน้า (กัน query DB ทุกข้อความที่เข้ามา
// ซ้ำ ๆ ในช่วงสั้น ๆ) แต่ความถูกต้องจริง ๆ มาจาก DB เสมอ
const MAX_TRACKED = 1000;
const processedIds = new Set();
const processedOrder = [];

// message นี้เคยประมวลผลไปแล้วหรือยัง — เช็คแคชหน่วยความจำก่อน ไม่เจอค่อยถาม DB
// (กรณี process เพิ่ง restart แล้ว LINE retry ข้อความเก่ามา แคชในหน่วยความจำว่างเปล่า)
async function isProcessed(id) {
  if (processedIds.has(id)) return true;
  try {
    const [rows] = await pool.execute(
      'SELECT 1 FROM processed_line_messages WHERE message_id = ? LIMIT 1',
      [id]
    );
    if (rows.length > 0) {
      cacheProcessed(id);
      return true;
    }
  } catch (err) {
    console.error('Error checking processed LINE message id:', err);
  }
  return false;
}

function cacheProcessed(id) {
  processedIds.add(id);
  processedOrder.push(id);
  if (processedOrder.length > MAX_TRACKED) {
    processedIds.delete(processedOrder.shift());
  }
}

// บันทึกว่าประมวลผลข้อความนี้แล้ว (ไม่ว่าจะสร้างใบเสนอราคาสำเร็จหรือไม่ก็ตาม —
// กัน retry จาก LINE มาลองใหม่ซ้ำ ๆ กับข้อความที่ error อยู่แล้วด้วย) ON DUPLICATE
// KEY เผื่อ retry มาถึงเกือบพร้อมกันสองคำขอ (unique key ที่ message_id กันซ้ำอยู่แล้ว)
async function markProcessed(id) {
  cacheProcessed(id);
  try {
    await pool.execute(
      'INSERT INTO processed_line_messages (message_id) VALUES (?) ON DUPLICATE KEY UPDATE message_id = message_id',
      [id]
    );
  } catch (err) {
    console.error('Error persisting processed LINE message id:', err);
  }
}

// เติมข้อมูลใบเสนอราคาที่สร้างจากข้อความนี้ลงแถวเดิม (insert ไว้แล้วจาก
// markProcessed ด้านบน) — เฉพาะข้อความที่ "เปิดใบใหม่" เท่านั้นที่ถูกเรียก
async function trackMessageQuotation(messageId, info) {
  if (!messageId) return;
  try {
    await pool.execute(
      `UPDATE processed_line_messages
       SET quotation_id = ?, quotation_no = ?, customer_id = ?, vehicle_id = ?, was_new_customer = ?, was_new_vehicle = ?
       WHERE message_id = ?`,
      [
        info.quotationId,
        info.quotation_no,
        info.customerId,
        info.vehicleId,
        info.wasNewCustomer ? 1 : 0,
        info.wasNewVehicle ? 1 : 0,
        messageId,
      ]
    );
  } catch (err) {
    console.error('Error persisting LINE message quotation link:', err);
  }
}

// หาใบเสนอราคาที่ข้อความนี้เคยสร้างไว้ (ใช้ตอน unsend) — คืน null ถ้าไม่เคยสร้าง
// หรือเคยแต่ถูกเคลียร์ลิงก์ไปแล้ว (unsend ไปแล้วครั้งหนึ่ง)
async function getTrackedQuotation(messageId) {
  if (!messageId) return null;
  const [rows] = await pool.execute(
    `SELECT quotation_id, quotation_no, customer_id, vehicle_id, was_new_customer, was_new_vehicle
     FROM processed_line_messages WHERE message_id = ? AND quotation_id IS NOT NULL LIMIT 1`,
    [messageId]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    quotationId: r.quotation_id,
    quotation_no: r.quotation_no,
    customerId: r.customer_id,
    vehicleId: r.vehicle_id,
    wasNewCustomer: Boolean(r.was_new_customer),
    wasNewVehicle: Boolean(r.was_new_vehicle),
  };
}

// เคลียร์ลิงก์ใบเสนอราคาออกจากแถวหลัง unsend แล้ว (กันเรียกคืนข้อความเดิมซ้ำแล้ว
// พยายามลบใบเดิมอีกรอบ — message_id ยังอยู่ในตาราง แค่ไม่ผูกกับใบไหนแล้ว)
async function clearTrackedQuotation(messageId) {
  try {
    await pool.execute(
      'UPDATE processed_line_messages SET quotation_id = NULL WHERE message_id = ?',
      [messageId]
    );
  } catch (err) {
    console.error('Error clearing LINE message quotation link:', err);
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
  // FOR UPDATE ล็อกแถวที่อ่านไว้จนกว่า transaction นี้จะ commit — กัน 2 ข้อความ
  // ไลน์ที่มาถึงพร้อมกันอ่าน MAX เดิมแล้วได้เลขใบเสนอราคาซ้ำกัน (แบบเดียวกับที่
  // ล็อก queue_no ไว้ด้านบนใน createQuotationFromQueue)
  const [rows] = await conn.execute(
    'SELECT MAX(CAST(SUBSTRING(quotation_no, -3) AS UNSIGNED)) as maxNo FROM quotations WHERE quotation_no LIKE ? FOR UPDATE',
    [`IV${dateStr}%`]
  );
  const nextNumber = (rows[0]?.maxNo || 0) + 1;
  return `IV${dateStr}${String(nextNumber).padStart(3, '0')}`;
}

async function generateCustomerCode(conn) {
  // เหตุผลเดียวกับ generateQuotationNo ด้านบน
  const [rows] = await conn.execute(
    "SELECT MAX(CAST(SUBSTRING(customer_code, 5) AS UNSIGNED)) AS maxCode FROM customers WHERE customer_code LIKE 'CMM-%' FOR UPDATE"
  );
  const nextNumber = (rows[0]?.maxCode || 0) + 1;
  return `CMM-${String(nextNumber).padStart(4, '0')}`;
}

// Mirrors quotations.routes.js's generateReceiptNo() — บอทไลน์ที่ได้รับข้อความ
// "ลูกค้าชำระเงิน:" ต้องอนุมัติ+สร้างใบเสร็จเองตรงนี้ (ดู createQuotationFromQueue)
// จึงต้องใช้เลขบิลรูปแบบเดียวกัน (RC + วันที่พ.ศ. + เลขรัน 3 หลัก)
function formatReceiptDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear() + 543).slice(-2);
  return `${yy}${mm}${dd}`;
}

async function generateReceiptNo(conn) {
  const dateStr = formatReceiptDate(new Date());
  // FOR UPDATE เหตุผลเดียวกับตัวสร้างเลขเอกสารด้านบน
  const [rows] = await conn.execute(
    'SELECT MAX(CAST(SUBSTRING(receipt_no, -3) AS UNSIGNED)) AS maxNo FROM receipts WHERE receipt_no LIKE ? FOR UPDATE',
    [`RC${dateStr}%`]
  );
  const nextNumber = (rows[0]?.maxNo || 0) + 1;
  return `RC${dateStr}${String(nextNumber).padStart(3, '0')}`;
}

// Mirrors quotations.routes.js's generateRepairNoticeCode() — ใบเสนอราคาที่บอท
// อนุมัติเองต้องได้ใบแจ้งซ่อมคู่กันเหมือนอนุมัติผ่านหน้าเว็บทุกประการ
async function generateRepairNoticeCode(conn) {
  const [rows] = await conn.execute(
    "SELECT MAX(CAST(SUBSTRING(code, 4) AS UNSIGNED)) AS maxNo FROM repair_notices WHERE code LIKE 'RN-%' FOR UPDATE"
  );
  const nextNumber = (rows[0]?.maxNo || 0) + 1;
  return `RN-${String(nextNumber).padStart(4, '0')}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── เทมเพลตตอบกลับเมื่อพนักงานพิมพ์ "คิว" เดี่ยว ๆ (ดู router.post('/webhook')) ──

// พรีวิวเลขคิวถัดไปของวันนี้เฉย ๆ ไม่ได้ "จอง" เลขไว้ — จงใจไม่ใช้ transaction/FOR
// UPDATE เหมือน generateQuotationNo เพราะยังไม่มีการ insert อะไรจริง (แค่ทายเลขให้
// พนักงานเห็นในเทมเพลต) พิมพ์ "คิว" สองครั้งติดกันอาจได้เลขเดิมซ้ำได้ — ไม่เป็นไร
// เพราะตอนส่งเทมเพลตจริงเข้ามา กลไกชนคิว/เปลี่ยนเลขอัตโนมัติที่มีอยู่แล้ว
// (createQuotationFromQueue ด้านล่าง) จะจัดการให้เอง ไม่ต้องสร้างระบบจองคิวใหม่
async function getNextQueueNoPreview() {
  const [rows] = await pool.execute(
    `SELECT MAX(CAST(queue_no AS UNSIGNED)) AS maxQueue FROM quotations WHERE quotation_date = ? AND queue_no REGEXP '^[0-9]+$'`,
    [todayStr()]
  );
  const maxQueue = rows[0]?.maxQueue || 0;
  return String(maxQueue + 1);
}

// วันที่แบบไทย dd/mm/yy (พ.ศ.) ใช้แปะบนเทมเพลตให้พนักงานเห็นวันที่วันนี้ตรง ๆ
function formatThaiShortDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear() + 543).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

// เทมเพลตข้อความที่ตอบกลับตายตัว (รูปแบบตกลงกับเจ้าของร้านแล้ว) — เติมแค่เลขคิว
// ถัดไปกับวันที่วันนี้ ที่เหลือเป็น label ว่างให้พนักงานกรอกทับแล้วส่งกลับมา
function buildQueueTemplateText(nextQueueNo) {
  const dateStr = formatThaiShortDate(new Date());
  return [
    `คิว ${nextQueueNo}`,
    dateStr,
    'ชื่อ:',
    'เบอโทรศัพท์:',
    'ยี่ห้อรถ:',
    'รุ่นรถ:',
    'ทะเบียนรถ:',
    'สีรถ:',
    'เลขไมค์:',
    'อาการ:',
    'รายการ:',
    '',
    '<--สิ้นสุดรายการ-->',
    'ยอดรวม:',
    'หมายเหตุ:',
    'ยอดที่ต้องชำระ:',
    'ช่องทางการชำระ:',
    'ลูกค้าชำระเงิน:',
  ].join('\n');
}

// ── กติกาปิดบิลอัตโนมัติเมื่อ "ลูกค้าชำระเงิน:" ถูกกรอกมา (ดู createQuotationFromQueue) ──

// ยอดที่ลงในใบเสร็จ: มีมัดจำ+ยอดค้าง (remaining_balance > 0) ใช้ยอดรวมทั้งบิลเป็นยอด
// ใบเสร็จ (เจ้าของร้านยืนยันกติกา: มัดจำ + ยอดค้าง = ยอดรวม) ไม่งั้นใช้ยอดที่ลูกค้า
// จ่ายจริงตรง ๆ — ไม่มีตัวไหนระบุมาเลยค่อย fallback เป็นผลรวมรายการที่คำนวณเอง
function computeReceiptAmount(parsed, itemSumTotal) {
  if (parsed.remaining_balance != null && parsed.remaining_balance > 0) {
    return parsed.stated_total != null ? parsed.stated_total : itemSumTotal;
  }
  return parsed.paid_amount != null ? parsed.paid_amount : itemSumTotal;
}

// เตือนถ้ายอด "มัดจำ <N>" ที่ปนอยู่ในหมายเหตุ (จาก parser เดิม ดู PAID_REMARK_LINE_RE/
// มัดจำ ใน parseLineQueueMessage.js) บวกยอดค้างแล้วไม่เท่ากับยอดรวมที่แจ้งมา — เตือน
// เฉย ๆ ไม่บล็อกการสร้างบิล (พนักงานพิมพ์เลขผิดกันได้ ให้เห็นแล้วไปแก้เองในแอป)
function checkDepositMismatch(parsed) {
  if (parsed.remaining_balance == null || parsed.remaining_balance <= 0) return null;
  if (parsed.stated_total == null || !parsed.remark) return null;
  const depositMatch = /มัดจำ\s*([\d,]+)/.exec(parsed.remark);
  if (!depositMatch) return null;
  const depositAmount = Number(depositMatch[1].replace(/,/g, ''));
  const actual = depositAmount + parsed.remaining_balance;
  if (actual === parsed.stated_total) return null;
  return { depositAmount, actual, expected: parsed.stated_total };
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
  // รายการแบบ "1700*2" พาร์สจำนวน+ราคาต่อหน่วยมาให้แล้ว — ไม่มีก็ถือเป็น 1 ชิ้น
  // ราคาที่พิมพ์มาคือราคาต่อหน่วยไปเลย
  const quantity = Number(item.quantity) >= 1 ? Number(item.quantity) : 1;
  const unitPrice = item.unit_price != null ? item.unit_price : price;

  if (!match) {
    return [{ product_name: item.name, quantity, unit_price: unitPrice, warranty_name: null, warranty_year: 0, warranty_month: 0, warranty_km: 0 }];
  }

  const warranty = {
    warranty_name: match.warranty_name || null,
    warranty_year: match.warranty_year || 0,
    warranty_month: match.warranty_month || 0,
    warranty_km: match.warranty_km || 0,
  };

  if (!match.is_set) {
    return [{ product_name: match.product_name, quantity, unit_price: unitPrice, ...warranty }];
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

    // ลูกค้า: parsed.phone ผ่าน formatPhone มาแล้วเสมอ (รูปแบบ XXX-XXX-XXXX คงที่ —
    // ดู formatPhone ใน parseLineQueueMessage.js) จึงเทียบตรง ๆ กับคอลัมน์ phone ได้
    // เลย ไม่ต้อง REPLACE() ตัดขีด/ช่องว่างออกจากทั้งสองฝั่งเหมือนเดิม (REPLACE() บน
    // คอลัมน์ทำให้ index บน phone ใช้ไม่ได้ กลายเป็น full scan ทุกครั้ง) — จุดนี้ทำงาน
    // ถูกต้องเพราะทุกจุดที่เขียนคอลัมน์ phone ของ customers ตอนนี้ normalize ผ่าน
    // formatPhone เดียวกันแล้วทั้งหมด (customers.routes.js,
    // quotation-customers.routes.js, และจุดสร้างลูกค้าใหม่แบบฝังในฟอร์มใบเสนอราคา/
    // ใบเสร็จของ quotations.routes.js กับ receipts.routes.js) เบอร์ที่พิมพ์ผ่าน
    // หน้าเว็บแบบไม่มีขีดจะถูกแปลงเป็นรูปแบบเดียวกันก่อนบันทึกเสมอ ไม่มีเบอร์รูปแบบ
    // อื่นหลุดเข้ามาปนอีกต่อไป
    // (ลูกค้าเดิมที่ถูกสร้างไว้ก่อนหน้านี้แบบไม่มีขีดยังไม่ถูก backfill อัตโนมัติ —
    // ดูรายละเอียดในรายงานส่งมอบงาน)
    let customerId = null;
    let wasNewCustomer = false;
    if (parsed.phone) {
      const [rows] = await conn.execute(
        'SELECT id FROM customers WHERE phone = ? LIMIT 1',
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
      wasNewCustomer = true;
    }

    // บิลที่ "ปิดแล้ว" (ลูกค้าชำระเงินครบผ่านเทมเพลตไลน์ — ดูส่วนปิดบิลด้านล่าง) ของ
    // ลูกค้า+คิวเดียวกันนี้ ภายใน 14 วันย้อนหลัง (หน้าต่างเดียวกับ existing lookup
        // ด้านล่าง) → ไม่ใช่ "แก้ไขใบเดิม" อีกต่อไป เพราะบิลจบงานไปแล้ว พนักงานพิมพ์เลข
    // คิวเดิมซ้ำมักมาจากพิมพ์ผิด/ทดสอบ ไม่ใช่งานใหม่จริง ๆ — เตือนแล้วข้าม ไม่สร้าง
    // ใบเสนอราคาซ้อนเงียบ ๆ (เช็คตรงนี้ก่อนไปแตะ vehicles กันสร้าง/แก้รถของบิลที่ปิด
    // ไปแล้วโดยไม่จำเป็น)
    if (parsed.queue_no) {
      const [closedRows] = await conn.execute(
        `SELECT id, quotation_no, queue_no FROM quotations
         WHERE customer_id = ? AND quotation_date >= DATE_SUB(?, INTERVAL 14 DAY) AND closed_at IS NOT NULL
         AND (queue_no = ? OR requested_queue_no = ?)
         ORDER BY id DESC LIMIT 1`,
        [customerId, parsed.quotation_date || todayStr(), parsed.queue_no, parsed.queue_no]
      );
      if (closedRows.length > 0) {
        await conn.commit(); // ยังไม่ได้แก้อะไรเลยตอนนี้ (ลูกค้าอาจเพิ่งถูกสร้างใหม่ถ้าเป็นเบอร์ใหม่จริง ๆ) — commit เก็บไว้เฉย ๆ
        return { closedBillMatch: true, queue_no: closedRows[0].queue_no };
      }
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
    // เพิ่มเติม: ถ้าเลขคิวที่พิมพ์มาเคย "ถูกเปลี่ยนอัตโนมัติ" ไปแล้วจากการชนกับลูกค้า
    // คนอื่นในวันเดียวกัน (ดูด้านล่าง) ใบเสนอราคานั้นจะเก็บเลขที่พิมพ์มาครั้งแรกไว้ใน
    // requested_queue_no ควบคู่กับ queue_no จริงที่ใช้อยู่ — ลูกค้าคนเดิมพิมพ์เลขคิวเดิม
    // ซ้ำอีกครั้ง (หมายถึงแก้ไขใบเดิม) จึงต้องจับคู่ด้วยทั้งสองคอลัมน์ ไม่ใช่แค่ queue_no
    // หมายเหตุ: งานบางคันค้างข้ามวัน (รถซ่อมไม่เสร็จวันเดียว) พนักงานพิมพ์เลขคิวเดิมซ้ำ
    // ในวันถัดไปเพื่อเพิ่ม/แก้รายการในใบเดิม จึงห้ามล็อก quotation_date = วันนี้ตรง ๆ
    // ต้องมองย้อนหลังไปด้วย (14 วัน) เพื่อยังเจอใบเดิมของลูกค้าคนนี้ที่ยัง pending/approved
    // อยู่ — จำกัดด้วย customer_id อยู่แล้วจึงไม่มีทางไปรวมกับใบของลูกค้าคนอื่น ส่วนใบเก่า
    // เกิน 14 วันที่ถูกลืมไปแล้วจะไม่ถูกดึงกลับมาโดยไม่ตั้งใจ
    // AND closed_at IS NULL: บิลที่ปิดแล้ว (ชำระเงินครบผ่านเทมเพลตไลน์) จบงานไปแล้ว
    // ไม่ถือเป็น "ใบเดิมที่ยังแก้ไขได้" อีก (เช็ค closedBillMatch ไว้แล้วด้านบน ก่อน
    // จะมาถึงจุดนี้ได้แปลว่าไม่ตรงกับบิลที่ปิดไปแล้ว จึงปลอดภัยที่จะกันซ้ำอีกชั้นตรงนี้)
    let existing = null;
    if (parsed.queue_no) {
      const [rows] = await conn.execute(
        `SELECT id, quotation_no, status, converted_receipt_id FROM quotations
         WHERE customer_id = ? AND quotation_date >= DATE_SUB(?, INTERVAL 14 DAY) AND status IN ('pending', 'approved')
         AND closed_at IS NULL
         AND (queue_no = ? OR requested_queue_no = ?)
         ORDER BY id DESC LIMIT 1`,
        [customerId, quotationDate, parsed.queue_no, parsed.queue_no]
      );
      if (rows.length > 0) existing = rows[0];
    }

    // กำลังจะเปิดใบใหม่ (ไม่เจอใบเดิมของลูกค้าคนนี้) แต่เลขคิวที่พิมพ์มาซ้ำกับของ
    // ลูกค้าคนอื่นที่ยังไม่เสร็จงานในวันเดียวกัน → เปลี่ยนเลขคิวให้อัตโนมัติเป็นเลข
    // ถัดไปที่ว่าง (กันหน้างานสับสนว่าใบไหนของใคร) เฉพาะกรณีเลขคิวเป็นตัวเลขล้วน
    // เท่านั้น (ร้านพิมพ์เป็นตัวเลขเสมอในทางปฏิบัติ — ไม่ใช่ตัวเลขก็ข้ามไป ไม่พยายาม
    // ตีความ/เรียงลำดับแทน)
    let actualQueueNo = parsed.queue_no;
    let requestedQueueNo = null;
    let reassignedFrom = null;
    if (!existing && parsed.queue_no && /^\d+$/.test(parsed.queue_no)) {
      // FOR UPDATE ล็อกแถวคิววันนี้ทั้งหมดไว้จนกว่า transaction นี้จะ commit —
      // กันสองข้อความที่ชนคิวเดียวกันมาถึงพร้อมกัน (เช่นพนักงานพิมพ์ต่อกันเร็ว ๆ)
      // อ่าน MAX เดียวกันแล้วเลื่อนไปชนเลขเดียวกันซ้ำ ต้องรอให้อีกฝั่ง insert เสร็จ
      // ก่อนถึงจะอ่านเห็นเลขล่าสุดจริง ๆ
      const [todayQueueRows] = await conn.execute(
        `SELECT queue_no FROM quotations WHERE quotation_date = ? AND queue_no REGEXP '^[0-9]+$' FOR UPDATE`,
        [quotationDate]
      );
      // AND closed_at IS NULL: บิลที่ปิดแล้วปล่อยเลขคิวของมันคืนให้ลูกค้าคนใหม่ใช้ได้
      // เลย ไม่ถือว่า "ชน" อีกต่อไป (งานจบแล้วจริง ๆ)
      const [takenByOther] = await conn.execute(
        `SELECT id FROM quotations WHERE quotation_date = ? AND queue_no = ? AND customer_id != ? AND status IN ('pending', 'approved') AND closed_at IS NULL LIMIT 1`,
        [quotationDate, parsed.queue_no, customerId]
      );
      if (takenByOther.length > 0) {
        const maxQueue = todayQueueRows.reduce((max, r) => Math.max(max, Number(r.queue_no)), 0);
        reassignedFrom = parsed.queue_no;
        actualQueueNo = String(maxQueue + 1);
        requestedQueueNo = parsed.queue_no;
      }
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
        `INSERT INTO quotations (quotation_no, quotation_date, customer_id, vehicle_id, mileage, remark, product_summary, total_amount, queue_no, requested_queue_no, symptom)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [quotation_no, quotationDate, customerId, vehicleId, parsed.mileage ?? 0, parsed.remark || null, product_summary, total_amount, actualQueueNo || null, requestedQueueNo, parsed.symptom || null]
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

    // "ลูกค้าชำระเงิน:" ถูกกรอกมา (ไม่ว่างเปล่า) = สัญญาณปิดบิล — ต้องมีใบเสร็จอยู่
    // (ถ้ายังไม่มีก็อนุมัติ+สร้างให้เองตรงนี้เลย เหมือนกดปุ่มอนุมัติบนเว็บ) แล้วเซ็ต
    // payment_method/total_amount ตามกติกา + ปิดบิล (closed_at) กันไม่ให้ใบนี้ถูก
    // merge/ชนคิวกับข้อความถัดไปอีก
    let paymentClosed = false;
    let paymentReceiptNo = null;
    let paymentAmount = null;
    let paymentWarning = null; // 'no_items' | 'no_vehicle'
    let depositMismatch = null;

    if (parsed.paid_amount != null) {
      if (resolvedItems.length === 0) {
        // ไม่มีรายการสินค้าเลย — สร้างใบเสร็จไม่ได้ (receipts ต้องมี receipt_items
        // อย่างน้อย 1 แถวเหมือนกติกาของ PATCH /quotations/:id/approve) เตือนแล้วปล่อย
        // ผ่าน ไม่ปิดบิล ไม่แตะ closed_at
        paymentWarning = 'no_items';
      } else {
        paymentAmount = computeReceiptAmount(parsed, total_amount);
        depositMismatch = checkDepositMismatch(parsed);

        if (isUpdate && existing.status === 'approved' && existing.converted_receipt_id) {
          // ใบเสร็จมีอยู่แล้ว (syncedReceipt ด้านบน sync รายการ+ยอดรวมตาม total_amount
          // ไปแล้ว) — ทับด้วย payment_method + ยอดตามกติกาปิดบิล (อาจต่างจาก total_amount
          // เช่นกรณีมัดจำ) แล้วปิดบิล
          const receiptId = existing.converted_receipt_id;
          await conn.execute(
            'UPDATE receipts SET payment_method = ?, total_amount = ? WHERE id = ?',
            [parsed.payment_method || null, paymentAmount, receiptId]
          );
          const [[receiptRow]] = await conn.query('SELECT receipt_no FROM receipts WHERE id = ?', [receiptId]);
          paymentReceiptNo = receiptRow ? receiptRow.receipt_no : null;
          await conn.execute('UPDATE quotations SET closed_at = NOW() WHERE id = ?', [quotationId]);
          paymentClosed = true;
        } else if (!vehicleId) {
          // Mirrors PATCH /quotations/:id/approve's vehicle_id requirement — ไม่มี
          // ข้อมูลรถพอจะสร้างใบเสร็จไม่ได้ เตือนแล้วปล่อยผ่าน ไม่ปิดบิล
          paymentWarning = 'no_vehicle';
        } else {
          // ยัง pending (หรือเพิ่งสร้างใหม่) → อนุมัติ+สร้างใบเสร็จเองในทรานแซกชันนี้
          // เลย (mirror ของ PATCH /quotations/:id/approve ใน quotations.routes.js —
          // ดูเหตุผลที่ mirror แทนเรียกข้ามไฟล์ในหมายเหตุหัวไฟล์ generateReceiptNo ด้านบน)
          const receipt_no = await generateReceiptNo(conn);
          const [receiptResult] = await conn.execute(
            `INSERT INTO receipts (receipt_no, receipt_date, customer_id, vehicle_id, mileage, remark, payment_method, total_amount, customer_signature)
             VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?)`,
            [receipt_no, customerId, vehicleId, parsed.mileage ?? 0, parsed.remark || null, parsed.payment_method || null, paymentAmount, null]
          );
          const receiptId = receiptResult.insertId;
          for (const item of resolvedItems) {
            await conn.execute(
              `INSERT INTO receipt_items (receipt_id, service_item_id, product_name_snapshot, qty, price, amount, warranty_name, warranty_year, warranty_month, warranty_km)
               VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [receiptId, item.product_name, item.quantity, item.unit_price, item.quantity * item.unit_price, item.warranty_name, item.warranty_year, item.warranty_month, item.warranty_km]
            );
          }
          await conn.execute(
            "UPDATE quotations SET status = 'approved', converted_receipt_id = ?, closed_at = NOW() WHERE id = ?",
            [receiptId, quotationId]
          );
          // ใบเสนอราคาปกติที่สร้างจากหน้าเว็บมีใบแจ้งซ่อมคู่กันมาตั้งแต่ตอนสร้างแล้ว
          // แต่ใบที่บอทไลน์สร้างไม่มี (รอถึงตอนอนุมัติ) — อนุมัติเองตรงนี้ก็ต้องสร้าง
          // ใบแจ้งซ่อมให้ครบเหมือนอนุมัติผ่านเว็บทุกประการ
          const [existingNotice] = await conn.execute(
            'SELECT id FROM repair_notices WHERE quotation_id = ? LIMIT 1',
            [quotationId]
          );
          if (existingNotice.length === 0) {
            const rnCode = await generateRepairNoticeCode(conn);
            await conn.execute(
              `INSERT INTO repair_notices (code, customer_id, vehicle_id, quotation_id, notice_date, checklist)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [rnCode, customerId, vehicleId, quotationId, quotationDate, '{}']
            );
          }
          paymentReceiptNo = receipt_no;
          paymentClosed = true;
        }
      }
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
      paymentClosed,
      paymentReceiptNo,
      paymentAmount,
      paymentWarning,
      depositMismatch,
      syncedReceipt,
      reassignedFrom, // เลขคิวเดิมที่พิมพ์มา (มีค่าเฉพาะตอนถูกเปลี่ยนอัตโนมัติ)
      reassignedTo: reassignedFrom ? actualQueueNo : null,
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
  const {
    quotation_no, itemCount, totalAmount, hasNote, isUpdate, syncedReceipt, reassignedFrom, reassignedTo,
    paymentClosed, paymentReceiptNo, paymentAmount, paymentWarning, depositMismatch,
  } = info;
  const itemLine = itemCount > 0
    ? `รายการ ${itemCount} ชิ้น รวม ${totalAmount.toLocaleString()} บาท`
    : 'ยังไม่มีรายการสินค้า (เพิ่มในแอปได้)';
  const noteLine = hasNote ? '\n📝 มีข้อความเพิ่มเติมที่ไม่ได้แยกเป็นรายการ ดูในหมายเหตุของใบเสนอราคา' : '';
  // ร้านบางทีก็แจ้งยอดรวมมาเองในข้อความ ("รวม 23000") — เทียบกับที่คำนวณจริง
  // แล้วเตือนถ้าไม่ตรง กันบิลผิดหลุดไปถึงลูกค้าโดยไม่มีใครสังเกต
  const mismatchLine = parsed.stated_total != null && parsed.stated_total !== totalAmount
    ? `\n⚠️ ยอดที่แจ้งในไลน์ (${parsed.stated_total.toLocaleString()} บาท) ไม่ตรงกับผลรวมรายการ (${totalAmount.toLocaleString()} บาท) กรุณาตรวจสอบ`
    : '';
  // เลขคิวที่พิมพ์มาชนกับของลูกค้าคนอื่นวันนี้ → ถูกเปลี่ยนอัตโนมัติ ต้องแจ้งให้รู้
  // ชัด ๆ ไม่งั้นหน้างานเรียกคิวผิดคน
  const reassignLine = reassignedFrom
    ? `\n⚠️ คิวที่ ${reassignedFrom} มีแล้ววันนี้ เปลี่ยนเป็นคิว ${reassignedTo} ให้อัตโนมัติ`
    : '';
  // แก้ไขใบที่อนุมัติไปแล้ว → ใบเสร็จที่สร้างไว้ก่อนหน้าก็ถูกแก้ตามด้วย ต้องเตือน
  // ให้พิมพ์ใหม่ ไม่งั้นใบที่พิมพ์ไปแล้วจะไม่ตรงกับข้อมูลในระบบ
  const syncedLine = syncedReceipt ? '\n🧾 ใบเสร็จที่อนุมัติไว้แล้วถูกแก้ตามด้วย กรุณาพิมพ์ใหม่' : '';
  // "ลูกค้าชำระเงิน:" ถูกกรอกมาแล้วปิดบิลสำเร็จ → แจ้งชัด ๆ ว่าปิดแล้ว พร้อมเลข
  // ใบเสร็จที่สร้าง/แก้ให้ (กันหน้างานพิมพ์คิวเดิมซ้ำแล้วงงว่าทำไมแก้ไม่ได้อีก)
  const paymentLine = paymentClosed
    ? `\n💰 รับชำระแล้ว (${parsed.payment_method || '-'} ${Number(paymentAmount).toLocaleString()} บาท) — ปิดบิล ใบเสร็จ ${paymentReceiptNo}`
    : '';
  // แจ้งเงินมาแล้วแต่ปิดบิลไม่ได้ (ไม่มีรายการ/ไม่มีข้อมูลรถ) — ต้องเตือนชัด ๆ ไม่งั้น
  // หน้างานเข้าใจผิดว่าบิลปิดแล้วทั้งที่จริงยังไม่มีใบเสร็จ
  const paymentWarningLine = paymentWarning === 'no_items'
    ? '\n⚠️ แจ้งชำระเงินมาแล้วแต่ยังไม่มีรายการสินค้า สร้างใบเสร็จไม่ได้ กรุณาเพิ่มรายการก่อน'
    : paymentWarning === 'no_vehicle'
      ? '\n⚠️ แจ้งชำระเงินมาแล้วแต่ยังไม่มีข้อมูลรถ สร้างใบเสร็จไม่ได้ กรุณาเพิ่มข้อมูลรถก่อน'
      : '';
  // ยอดมัดจำ (จากหมายเหตุ) + ยอดค้างที่แจ้งมา ไม่เท่ากับยอดรวมที่แจ้งมา — เตือนเฉย ๆ
  // ไม่บล็อกการปิดบิล (ดู checkDepositMismatch)
  const depositMismatchLine = depositMismatch
    ? `\n⚠️ ยอดมัดจำ (${depositMismatch.depositAmount.toLocaleString()} บาท) + ยอดค้าง ไม่เท่ากับยอดรวมที่แจ้ง (คำนวณได้ ${depositMismatch.actual.toLocaleString()} บาท แต่แจ้งยอดรวม ${depositMismatch.expected.toLocaleString()} บาท) กรุณาตรวจสอบ`
    : '';
  const verb = isUpdate ? 'แก้ไขใบเสนอราคา' : 'สร้างใบเสนอราคา';
  const displayQueueNo = reassignedTo || parsed.queue_no || '-';
  return `✅ ${verb} ${quotation_no} แล้ว\nคิว ${displayQueueNo} · ${parsed.customer_name}${parsed.license_plate ? ` · ${parsed.license_plate}` : ''}\n${itemLine}${noteLine}${mismatchLine}${reassignLine}${syncedLine}${paymentLine}${paymentWarningLine}${depositMismatchLine}`;
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
      const info = messageId ? await getTrackedQuotation(messageId) : null;
      if (info) {
        await clearTrackedQuotation(messageId);
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
    if (messageId && (await isProcessed(messageId))) continue;

    // พนักงานพิมพ์คำว่า "คิว" เดี่ยว ๆ (ตัด whitespace แล้วต้องตรงเป๊ะ ไม่ใช่แค่ขึ้นต้น
    // ด้วย "คิว" แบบ Pattern อื่น) → ตอบกลับเทมเพลตให้กรอกต่อ ไม่สร้างใบเสนอราคาอะไร
    // เลย (แค่พรีวิวเลขคิวถัดไปให้ดู ไม่ได้จอง — ดู getNextQueueNoPreview)
    if (event.message.text.trim() === 'คิว') {
      // try/catch กัน error (เช่น DB สะดุดตอนพรีวิวเลขคิว) หลุดออกไปล้ม event
      // อื่นในชุดเดียวกัน — ตอบไม่ได้ก็ปล่อยผ่าน ไม่ mark processed ให้ LINE
      // retry มาลองใหม่ได้
      try {
        const nextQueueNo = await getNextQueueNoPreview();
        await replyToLine(event.replyToken, buildQueueTemplateText(nextQueueNo));
        if (messageId) await markProcessed(messageId);
      } catch (err) {
        console.error('Error replying queue template:', err);
      }
      continue;
    }

    const parsed = parseLineQueueMessage(event.message.text);
    if (!parsed) continue; // แชตทั่วไปในกลุ่ม — ข้ามเงียบ ๆ ไม่ตอบ ไม่รบกวน

    if (messageId) await markProcessed(messageId);

    try {
      const info = await createQuotationFromQueue(parsed);

      // เลขคิวนี้ตรงกับบิลที่ปิดไปแล้วของลูกค้าคนนี้ — ไม่สร้าง/แก้ไขอะไร แค่เตือน
      // ให้พิมพ์ "คิว" ขอเลขใหม่ถ้าเป็นงานใหม่จริง ๆ (ดู createQuotationFromQueue)
      if (info.closedBillMatch) {
        await replyToLine(
          event.replyToken,
          `⚠️ บิลนี้ปิดแล้ว (คิว ${info.queue_no} ของ ${parsed.customer_name}) หากเป็นงานใหม่กรุณาขอเลขคิวใหม่ด้วยการพิมพ์ "คิว"`
        );
        continue;
      }

      created.push(info.quotation_no);
      // ติดตามไว้ลบตอน unsend เฉพาะข้อความที่ "เปิดใบใหม่" เท่านั้น — ข้อความที่ไป
      // แก้ไขใบเดิม (isUpdate) ไม่ติดตาม กันเรียกคืนข้อความล่าสุดแล้วลบใบที่มี
      // ข้อมูลจากข้อความก่อนหน้าอยู่ด้วยไปโดยไม่ตั้งใจ
      if (!info.isUpdate) {
        await trackMessageQuotation(messageId, info);
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
module.exports.buildQueueTemplateText = buildQueueTemplateText; // ให้เทสต์ตรวจเนื้อหาเทมเพลตตอบกลับ "คิว" ได้โดยไม่ต้องยิง LINE API จริง
module.exports.checkDepositMismatch = checkDepositMismatch; // ให้เทสต์ตรวจกติกาเตือนยอดมัดจำไม่ตรงแยกจาก integration test ได้
module.exports.computeReceiptAmount = computeReceiptAmount; // ให้เทสต์ตรวจกติกายอดใบเสร็จ (มัดจำ vs จ่ายเต็ม) แยกจาก integration test ได้
