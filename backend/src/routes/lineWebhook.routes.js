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

// ส่งข้อความเข้ากลุ่มแบบ push (ไม่ต้องมี reply token — ยิงได้ทุกเมื่อ ต่างจาก
// replyToLine ที่ใช้ได้แค่ในหน้าต่างตอบกลับ webhook เดียวกันเท่านั้น) ใช้ตอนออฟฟิศ
// แก้ไขข้อมูลผ่านหน้าเว็บ (ใบเสนอราคา/รถ/ลูกค้า) แล้วต้องดันข้อมูลที่ถูกต้องกลับเข้า
// กลุ่มให้พนักงานเห็น (ดู pushQuotationUpdate ด้านล่าง) — best-effort เหมือน
// replyToLine ทุกประการ: ส่งไม่สำเร็จก็แค่ log ไว้ ไม่ throw ไม่ rollback อะไร
async function pushToLine(groupId, text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !groupId) return;
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to: groupId, messages: [{ type: 'text', text }] }),
    });
    if (!res.ok) console.error('LINE push failed:', res.status, await res.text());
  } catch (err) {
    console.error('LINE push error:', err.message);
  }
}

// ── เก็บ config ทั่วไปแบบ key-value ลงตาราง app_settings (ดู db/init.js) — ใช้
// เก็บ group id ของกลุ่มไลน์ร้าน เพื่อให้ quotations.routes.js/vehicles.routes.js/
// customers.routes.js (แก้ไขข้อมูลผ่านหน้าเว็บ) push ข้อความกลับเข้ากลุ่มได้เอง
// โดยไม่ต้องตั้งค่าอะไรเพิ่ม (ดักจับอัตโนมัติจากข้อความแรกที่กลุ่มส่งเข้ามา — ดู
// captureGroupId ด้านล่าง) ──
async function getSetting(key) {
  try {
    const [[row]] = await pool.query('SELECT value FROM app_settings WHERE `key` = ?', [key]);
    return row ? row.value : null;
  } catch (err) {
    console.error('Error reading app_settings:', err);
    return null;
  }
}

async function setSetting(key, value) {
  try {
    await pool.execute(
      'INSERT INTO app_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [key, value]
    );
  } catch (err) {
    console.error('Error writing app_settings:', err);
  }
}

// อ่าน group id ของกลุ่มไลน์ร้าน — ให้ route อื่น (quotations/vehicles/customers)
// import ไปเรียกใช้ตอนต้อง push ข้อมูลอัปเดตกลับเข้ากลุ่ม
async function getLineGroupId() {
  return getSetting('line_group_id');
}

// แคช group id ไว้ในหน่วยความจำ กันเขียนลง DB ซ้ำทุกข้อความที่กลุ่มส่งเข้ามา (เขียน
// ครั้งแรกพอ ต่อ process — restart ใหม่ค่อยเขียนซ้ำอีกครั้งตอนข้อความแรกเข้ามา ไม่มี
// ผลเสียอะไรเพราะเป็นค่าเดิม แค่เขียนทับซ้ำ)
let cachedGroupId = null;
async function captureGroupId(groupId) {
  if (!groupId || cachedGroupId === groupId) return;
  cachedGroupId = groupId;
  await setSetting('line_group_id', groupId);
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

// Mirrors quotations.routes.js's generateReceiptNo() — บอทไลน์ที่ได้รับวลีแจ้งจ่ายเงิน
// แล้ว (parsed.paid_confirmed) ต้องอนุมัติ+สร้างใบเสร็จเองตรงนี้ (ดู createQuotationFromQueue)
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
    'มัดจำ:',
    'วันที่มัดจำ:',
    'ยอดที่ต้องชำระ:',
    'หมายเหตุ:',
    '',
    '<--ลูกค้าชำระเงิน-->',
    'ช่องทางการชำระ (โอน/บัตรเครดิต/เงินสด/QRCode):',
    'ลูกค้าชำระเงิน (ยอดที่ได้รับจริง):',
  ].join('\n');
}

// แปลงวันที่ที่ได้จาก DB (YYYY-MM-DD สตริง — pool ตั้ง dateStrings: true ไว้แล้ว)
// เป็นรูปแบบไทย dd/mm/yy (พ.ศ.) แบบเดียวกับที่ parseThaiShortDate ใน
// parseLineQueueMessage.js อ่านกลับได้ — ไม่มีค่าคืนสตริงว่าง
function formatDbDateThai(dateStr) {
  if (!dateStr) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr));
  if (!m) return '';
  const buddhistYear = Number(m[1]) + 543;
  return `${m[3]}/${m[2]}/${String(buddhistYear).slice(-2)}`;
}

// เทมเพลตแบบ "กรอกข้อมูลจริงแล้ว" (ต่างจาก buildQueueTemplateText ด้านบนที่เป็น
// label ว่างให้กรอก) ใช้ตอน push ข้อมูลอัปเดตกลับเข้ากลุ่มหลังออฟฟิศแก้ไขใบเสนอราคา/
// รถ/ลูกค้าผ่านหน้าเว็บ (ดู pushQuotationUpdate ด้านล่าง) — ขึ้นต้นด้วยแบนเนอร์แจ้ง
// เตือนคั่นบรรทัดว่างแล้วตามด้วยเทมเพลตจริงที่ขึ้นต้นด้วย "คิว N" ครบทุกส่วนเหมือน
// เทมเพลตปกติทุกประการ (รวมยอดรวม/ยอดที่ต้องชำระ/ส่วนชำระเงิน) เพื่อให้พนักงาน
// คัดลอกทั้งก้อนไปใช้ต่อได้เลยไม่ว่าจะแก้ไขข้อมูลต่อหรือปิดบิลเลยก็ตาม (ยอดรวมคำนวณ
// จาก total_amount ที่บันทึกไว้จริงในใบเสนอราคา ไม่ใช่คำนวณจากรายการซ้ำ กันกรณี
// ออฟฟิศปรับยอดรวมเองไว้ในเว็บไม่ตรงกับผลรวมรายการเป๊ะ ๆ — ยอดที่ต้องชำระคำนวณสด
// จาก total_amount ลบมัดจำเสมอ ไม่ได้เก็บแยกไว้)
function buildFilledTemplateText(data) {
  const banner = `🔄 ข้อมูลอัปเดตแล้ว (คิว ${data.queue_no}) — คัดลอกไปใช้แทนของเดิมได้เลย`;
  const itemLines = (data.items || []).map((it) => {
    const amount = Number(it.quantity || 1) * Number(it.unit_price || 0);
    return `${it.product_name} ${amount}`;
  });
  const totalAmount = Number(data.total_amount || 0);
  const depositAmount = data.deposit_amount != null ? Number(data.deposit_amount) : 0;
  const remaining = totalAmount - depositAmount;
  const template = [
    `คิว ${data.queue_no}`,
    `ชื่อ:${data.customer_name || ''}`,
    `เบอโทรศัพท์:${data.phone || ''}`,
    `ยี่ห้อรถ:${data.brand || ''}`,
    `รุ่นรถ:${data.model || ''}`,
    `ทะเบียนรถ:${data.license_plate || ''}`,
    `สีรถ:${data.color || ''}`,
    `เลขไมค์:${data.mileage != null ? data.mileage : ''}`,
    `อาการ:${data.symptom || ''}`,
    'รายการ:',
    ...itemLines,
    '',
    '<--สิ้นสุดรายการ-->',
    `ยอดรวม:${totalAmount}`,
    `มัดจำ:${data.deposit_amount != null ? data.deposit_amount : ''}`,
    `วันที่มัดจำ:${formatDbDateThai(data.deposit_date)}`,
    `ยอดที่ต้องชำระ:${remaining}`,
    `หมายเหตุ:${data.remark || ''}`,
    '',
    '<--ลูกค้าชำระเงิน-->',
    'ช่องทางการชำระ (โอน/บัตรเครดิต/เงินสด/QRCode):',
    'ลูกค้าชำระเงิน (ยอดที่ได้รับจริง):',
  ].join('\n');
  return `${banner}\n\n${template}`;
}

// ดึงข้อมูลใบเสนอราคา+ลูกค้า+รถ+รายการ มาให้ครบพอสร้างข้อความ push (mirror ของ
// GET /quotations/:id ใน quotations.routes.js เท่าที่ต้องใช้ในเทมเพลต) คืน null
// ถ้าไม่พบใบเสนอราคานี้แล้ว (เช่นถูกลบไปแล้วระหว่างทาง)
async function fetchQuotationForPush(quotationId) {
  const [[q]] = await pool.query(
    `SELECT q.id, q.queue_no, q.closed_at, q.symptom, q.remark, q.deposit_amount, q.deposit_date, q.total_amount,
            c.customer_name, c.phone,
            v.brand, v.model, v.color, v.license_plate, v.mileage
     FROM quotations q
     LEFT JOIN customers c ON q.customer_id = c.id
     LEFT JOIN vehicles v ON q.vehicle_id = v.id
     WHERE q.id = ?`,
    [quotationId]
  );
  if (!q) return null;
  const [items] = await pool.query(
    'SELECT product_name, quantity, unit_price FROM quotation_items WHERE quotation_id = ? ORDER BY id ASC',
    [quotationId]
  );
  return { ...q, items };
}

// จุดรวมเดียวที่ quotations.routes.js/vehicles.routes.js/customers.routes.js เรียก
// หลังแก้ไขข้อมูลผ่านหน้าเว็บสำเร็จ — ตรวจเองว่าใบนี้ "มาจากไลน์และยังเปิดอยู่" จริง
// ไหม (queue_no IS NOT NULL AND closed_at IS NULL) ก่อนค่อย push กันผู้เรียกต้องเช็ค
// ซ้ำเอง best-effort ทุกชั้น (เหมือน pushToLine) — error จุดไหนก็แค่ log ไม่ throw
// ไม่กระทบ response ของ route ที่เรียกมา
async function pushQuotationUpdate(quotationId) {
  try {
    const groupId = await getLineGroupId();
    if (!groupId) return; // ยังไม่เคยมีข้อความจากกลุ่มไลน์เข้ามาเลย ไม่รู้จะ push ไปกลุ่มไหน
    const data = await fetchQuotationForPush(quotationId);
    if (!data || !data.queue_no || data.closed_at) return; // ไม่ใช่บิลจากไลน์ที่ยังเปิดอยู่
    await pushToLine(groupId, buildFilledTemplateText(data));
  } catch (err) {
    console.error('Error pushing quotation update to LINE:', err);
  }
}

// ── กติกาปิดบิลอัตโนมัติเมื่อพนักงานพิมพ์ "วลีแจ้งจ่ายเงินแล้ว" มา (parsed.paid_confirmed
// — ดู PAID_PHRASE_RE ใน parseLineQueueMessage.js) ไม่ใช่แค่กรอก "ลูกค้าชำระเงิน:" เฉย ๆ
// อีกต่อไป (ฟิลด์นั้นตอนนี้เป็นแค่ข้อมูลยอดที่จ่าย ใช้ประกอบการคำนวณยอดใบเสร็จเท่านั้น
// — ดู createQuotationFromQueue) ──

// ยอดที่ลงในใบเสร็จ: มัดจำที่เคยรับไว้ (ถ้ามี) + ยอดที่ลูกค้าชำระเงินครั้งนี้ (พิมพ์
// ตอนปิดบิล) — สูตรเดียวครอบคลุมทุกกรณีอัตโนมัติ ไม่ต้องแยกเงื่อนไขมีมัดจำ/ไม่มีมัดจำ
// อีกต่อไป: จ่ายเต็มไม่มีมัดจำ (deposit=0 + จ่ายเต็ม), มีมัดจำจ่ายส่วนที่เหลือปกติ
// (มัดจำ + ส่วนที่เหลือ = ยอดรวมพอดี), หรือจ่ายผ่านบัตรเครดิตที่มีค่าธรรมเนียมบวก
// เพิ่ม (พนักงานพิมพ์ยอดที่รูดจริงรวมค่าธรรมเนียมแล้วลง "ลูกค้าชำระเงิน" ตรง ๆ สูตร
// นี้จะบวกเข้ากับมัดจำให้ถูกต้องเอง ไม่ต้องมีช่องพิเศษสำหรับบัตร) — ไม่ได้พิมพ์ยอดที่
// จ่ายมาเลย (แค่วลีปิดบิลเฉย ๆ ไม่ได้กรอกยอด) ค่อย fallback เป็น fallbackTotal
// (ยอดรวมที่แจ้งไว้ หรือผลรวมรายการที่คำนวณเอง)
function computeReceiptAmount(depositAmount, paidAmount, fallbackTotal) {
  if (paidAmount != null) {
    return (depositAmount != null ? Number(depositAmount) : 0) + Number(paidAmount);
  }
  return fallbackTotal;
}

// เตือนถ้ายอดมัดจำ (deposit_amount — ฟิลด์ first-class จาก label "มัดจำ:" ใน
// parseLineQueueMessage.js ไม่ใช่การเดาจากข้อความในหมายเหตุอีกต่อไป) บวกยอดค้างที่
// แจ้งมาไม่เท่ากับยอดรวมที่แจ้งมา — เตือนเฉย ๆ ไม่บล็อกการสร้างบิล (พนักงานพิมพ์เลข
// ผิดกันได้ ให้เห็นแล้วไปแก้เองในแอป) รับ depositAmount แยกจาก parsed เพราะข้อความ
// resend อาจไม่ได้พิมพ์มัดจำซ้ำ (COALESCE เก็บค่าจากใบเดิมไว้ — ดูจุด UPDATE quotations
// ด้านบน) ต้องใช้ค่าที่จะถูกบันทึกจริงลงฐานข้อมูล ไม่ใช่แค่ค่าจากข้อความล่าสุด
function checkDepositMismatch(parsed, depositAmount) {
  if (parsed.stated_total == null || depositAmount == null) return null;
  // มัดจำมากกว่ายอดรวมทั้งบิล — เป็นไปได้ทางคณิตศาสตร์ (ยอดที่ต้องชำระจะติดลบ) แต่ใน
  // ทางปฏิบัติมักเกิดจากพิมพ์ผิด ต้องเตือนไว้เสมอไม่ว่าจะพิมพ์ "ยอดที่ต้องชำระ" มาด้วย
  // หรือไม่ก็ตาม (เดิมเช็คนี้ข้ามไปเงียบ ๆ ถ้าไม่มี remaining_balance เลย)
  if (depositAmount > parsed.stated_total) {
    return { depositAmount, actual: depositAmount, expected: parsed.stated_total };
  }
  // ไม่ได้พิมพ์ "ยอดที่ต้องชำระ" มาเลย ไม่มีอะไรให้เช็คต่อ (เดิมเงื่อนไขนี้ยังกรอง
  // remaining_balance <= 0 ทิ้งด้วย ทำให้เคสมัดจำเกินยอดรวม (ยอดที่ต้องชำระติดลบตาม
  // ความจริง) ไม่ถูกตรวจสอบเลย — เอาเงื่อนไข <= 0 ออก เหลือแค่เช็คว่ามีค่าให้ตรวจ)
  if (parsed.remaining_balance == null) return null;
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

    // แหล่งความจริงเดียวของวันที่ใบเสนอราคา — ใช้ทั้งเช็คบิลที่ปิดแล้วด้านล่างและ
    // ค้นหาใบเสนอราคาเดิม (existing) กันสองจุดคำนวณวันที่ไม่ตรงกันเอง
    const quotationDate = parsed.quotation_date || todayStr();

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
        [customerId, quotationDate, parsed.queue_no, parsed.queue_no]
      );
      if (closedRows.length > 0) {
        await conn.commit(); // ยังไม่ได้แก้อะไรเลยตอนนี้ (ลูกค้าอาจเพิ่งถูกสร้างใหม่ถ้าเป็นเบอร์ใหม่จริง ๆ) — commit เก็บไว้เฉย ๆ
        return { closedBillMatch: true, queue_no: closedRows[0].queue_no };
      }
    }

    // ใบเสนอราคาเดิมของลูกค้า+คิวเดียวกัน (ดูคำอธิบายเต็มที่จุด insert/update ด้านล่าง)
    // — ต้องหาก่อนไปแตะ vehicles เสมอ (บั๊กที่แก้: เดิมโค้ดนี้รันหลัง vehicle
    // resolution ทำให้ทุกข้อความ resend ไปค้นหา/สร้างรถใหม่จากข้อความโดยไม่รู้ว่า
    // มีรถผูกกับใบนี้อยู่แล้ว — ถ้าออฟฟิศเพิ่งแก้ทะเบียนที่พิมพ์ผิดผ่านหน้า Vehicle
    // Management (อัปเดตแถวเดิมในที่) แล้วพนักงานส่งข้อความเดิม (ทะเบียนเก่าที่ยัง
    // ผิดอยู่) มาเพิ่มรายการ จะหารถที่แก้แล้วไม่เจอ กลายเป็นสร้างรถใหม่/เปลี่ยนลิงก์
    // ใบเสนอราคาไปคันผิด ล้างการแก้ไขของออฟฟิศทิ้งซ้ำทุกครั้งที่ resend — ย้ายมาไว้
    // ก่อน vehicle resolution แล้วให้ vehicle resolution รู้ว่าเป็นการแก้ไขใบเดิมที่
    // มีรถผูกอยู่แล้วหรือไม่ ดู vehicleId ด้านล่าง)
    let existing = null;
    if (parsed.queue_no) {
      const [rows] = await conn.execute(
        `SELECT id, quotation_no, status, converted_receipt_id, vehicle_id, deposit_amount FROM quotations
         WHERE customer_id = ? AND quotation_date >= DATE_SUB(?, INTERVAL 14 DAY) AND status IN ('pending', 'approved')
         AND closed_at IS NULL
         AND (queue_no = ? OR requested_queue_no = ?)
         ORDER BY id DESC LIMIT 1`,
        [customerId, quotationDate, parsed.queue_no, parsed.queue_no]
      );
      if (rows.length > 0) existing = rows[0];
    }
    const isUpdate = Boolean(existing);

    // รถ: กำลังแก้ไขใบเดิมที่ผูกรถไว้แล้ว (isUpdate && existing.vehicle_id != null)
    // → ใช้รถเดิมตรง ๆ เสมอ ห้ามค้นหา/สร้างใหม่จากข้อความ resend (ดูเหตุผลเต็ม ๆ ที่
    // comment ของ existing lookup ด้านบน) นอกนั้น (เปิดใบใหม่ หรือแก้ไขใบเดิมที่ยัง
    // ไม่มีรถผูกไว้ — ไม่มีอะไรให้ป้องกัน) ค้นหาปกติ: มีทะเบียนตรงกันใต้ลูกค้าคนนี้ →
    // ใช้คันเดิม, ไม่มีทะเบียนในข้อความ → ลองเทียบยี่ห้อ+รุ่นแทน (ร้านบางทีไม่พิมพ์
    // ทะเบียน กันสร้างรถซ้ำทุกครั้งที่ส่งข้อความแก้ไข), ไม่เจอเลยค่อยสร้างใหม่ถ้ามี
    // ข้อมูลพอ
    let vehicleId = null;
    let wasNewVehicle = false;
    if (isUpdate && existing.vehicle_id != null) {
      vehicleId = existing.vehicle_id;
    } else if (parsed.license_plate) {
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
    if (vehicleId && parsed.mileage != null) {
      // เลขไมล์เปลี่ยนทุกครั้งที่รถเข้า (ข้อมูลการเข้าใช้บริการ ไม่ใช่ข้อมูลประจำตัวรถ)
      // จึงยังอัปเดตได้ปกติทุกครั้งที่ข้อความบอกมา ไม่ว่าจะเป็นข้อความแรกหรือ resend
      await conn.execute(
        'UPDATE vehicles SET mileage = ? WHERE id = ?',
        [parsed.mileage, vehicleId]
      );
    }
    if (vehicleId && !isUpdate && parsed.color) {
      // สี (เหมือนชื่อ/เบอร์โทร/ยี่ห้อ/รุ่น/ทะเบียน) ถือเป็นข้อมูลประจำตัวลูกค้า/รถ —
      // แก้ไขได้จากข้อความแรกที่สร้าง/เชื่อมรถเท่านั้น ข้อความ resend (isUpdate=true,
      // เช่นพนักงานก๊อปเทมเพลตเดิมส่งซ้ำเพื่อเพิ่มรายการ) ห้ามทับค่าที่อาจเคยแก้ไขถูก
      // ต้องแล้วในหน้าเว็บ — เจ้าของร้านสั่งให้แก้ข้อมูลประจำตัวได้ทางเว็บเท่านั้น
      await conn.execute(
        'UPDATE vehicles SET color = ? WHERE id = ?',
        [parsed.color, vehicleId]
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
    //
    // บรรทัด "-" (item.isSubItem) ที่ตามหลัง "ชุด" ทันที ให้ลองจับคู่ชื่อกับรายการย่อย
    // ที่ชุดนั้นขยายไว้แล้ว (เช่น "ลูกหมากคันชักนอก (555)" จับคู่กับ "ลูกหมากคันชักนอก
    // L+R" ที่ขยายมาจากชุด) แล้วแทนที่ชื่อ+บวกราคาเข้าไปแทนที่จะเพิ่มเป็นแถวใหม่แยก
    // ต่างหาก (เจ้าของร้านสั่งไว้ — กันรายการย่อยของชุดที่พิมพ์เพิ่มยี่ห้อเข้ามาแล้วกลาย
    // เป็นแถวซ้ำซ้อนกับที่ชุดขยายไว้อยู่แล้ว) ไม่เจอที่จับคู่ (ไม่มีชุดค้างอยู่ หรือชื่อไม่
    // ตรงกับรายการย่อยไหนเลย) ก็ตกไปเป็นรายการแยกตามปกติ
    // ชื่อรายการย่อยในแคตาล็อกจริงมักมี "- " นำหน้าฝังอยู่ในข้อความเลย (เช่น
    // "- ลูกหมากปีกนกล่าง L+R" ใน service_item_components) และมี "L+R" ต่อท้าย —
    // ต้องตัดทั้งสองฝั่งออกก่อนเทียบกับชื่อที่พนักงานพิมพ์มา (ซึ่งมักไม่มีทั้งคู่)
    const stripSetSuffix = (name) => name.replace(/^[-•·]\s*/, '').replace(/\s*L\+R\s*$/i, '').trim();
    const resolvedItems = [];
    let activeSetStart = null;
    let activeSetLength = 0;
    for (const item of parsed.items) {
      if (item.isSubItem && activeSetStart != null) {
        const subName = item.name.trim();
        let matchedIndex = -1;
        // รอบแรก: หาแบบชื่อตรงเป๊ะก่อน (แม่นยำสุด)
        for (let i = activeSetStart; i < activeSetStart + activeSetLength; i += 1) {
          if (stripSetSuffix(resolvedItems[i].product_name) === subName) {
            matchedIndex = i;
            break;
          }
        }
        // รอบสอง: ไม่เจอตรงเป๊ะ ค่อยหาแบบ substring แต่เลือกตัวที่ชื่อยาวที่สุด
        // (เจาะจงสุด) กันเผลอจับคู่ผิด เช่น "ปีกนกล่าง" ที่เป็นส่วนหนึ่งของ
        // "ลูกหมากปีกนกล่าง" อยู่แล้ว ไม่ควรถูกเลือกก่อนตัวที่ชื่อตรงกว่า
        if (matchedIndex === -1) {
          let bestLength = -1;
          for (let i = activeSetStart; i < activeSetStart + activeSetLength; i += 1) {
            const compBase = stripSetSuffix(resolvedItems[i].product_name);
            if (compBase && (subName.includes(compBase) || compBase.includes(subName)) && compBase.length > bestLength) {
              matchedIndex = i;
              bestLength = compBase.length;
            }
          }
        }
        if (matchedIndex !== -1) {
          resolvedItems[matchedIndex] = {
            ...resolvedItems[matchedIndex],
            product_name: item.name,
            unit_price: Number(resolvedItems[matchedIndex].unit_price || 0) + Number(item.price || 0),
          };
          continue;
        }
      }
      const rows = await resolveQuotationItemRows(conn, item);
      resolvedItems.push(...rows);
      if (!item.isSubItem && rows.length > 1) {
        activeSetStart = resolvedItems.length - rows.length;
        activeSetLength = rows.length;
      } else if (!item.isSubItem) {
        activeSetStart = null;
        activeSetLength = 0;
      }
    }
    const total_amount = resolvedItems.reduce((sum, it) => sum + it.quantity * it.unit_price, 0);
    const product_summary = resolvedItems.map((it) => it.product_name).join(', ');

    // ใบเสนอราคาเดิมของลูกค้า+คิวเดียวกัน (existing/isUpdate) หาไว้แล้วก่อน vehicle
    // resolution ด้านบน (ดูเหตุผลเต็ม ๆ ที่ comment ของจุดนั้น — ต้องหาก่อนแตะ
    // vehicles เสมอ กันข้อความ resend ไปสร้าง/เชื่อมรถผิดคัน) สรุปกติกาเดิม: ลูกค้า+
    // คิวเดียวกัน (จับคู่ queue_no หรือ requested_queue_no เผื่อเคยถูกเปลี่ยนเลข
    // อัตโนมัติจากการชนคิว) ที่ยัง pending/approved และ closed_at IS NULL ภายใน 14
    // วันย้อนหลัง (เผื่องานค้างข้ามวัน) → ถือเป็น "แก้ไขใบเดิม" ไม่ใช่เปิดใบใหม่
    //
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
    // isUpdate หาไว้แล้วก่อน vehicle resolution ด้านบน (ใช้ตัวแปรเดียวกันตลอดฟังก์ชัน)
    if (isUpdate) {
      quotationId = existing.id;
      quotation_no = existing.quotation_no;
      await conn.execute(
        `UPDATE quotations SET vehicle_id = ?, mileage = COALESCE(?, mileage), remark = ?, product_summary = ?, total_amount = ?, symptom = ?, deposit_amount = COALESCE(?, deposit_amount), deposit_date = COALESCE(?, deposit_date)
         WHERE id = ?`,
        [vehicleId, parsed.mileage ?? null, parsed.remark || null, product_summary, total_amount, parsed.symptom || null, parsed.deposit_amount ?? null, parsed.deposit_date || null, quotationId]
      );
      await conn.execute('DELETE FROM quotation_items WHERE quotation_id = ?', [quotationId]);
    } else {
      quotation_no = await generateQuotationNo(conn);
      const [quotationResult] = await conn.execute(
        `INSERT INTO quotations (quotation_no, quotation_date, customer_id, vehicle_id, mileage, remark, product_summary, total_amount, queue_no, requested_queue_no, symptom, deposit_amount, deposit_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [quotation_no, quotationDate, customerId, vehicleId, parsed.mileage ?? 0, parsed.remark || null, product_summary, total_amount, actualQueueNo || null, requestedQueueNo, parsed.symptom || null, parsed.deposit_amount ?? null, parsed.deposit_date || null]
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
      // deposit_amount/deposit_date: COALESCE เหมือน mileage ด้านบน (มัดจำมักพิมพ์
      // มาแค่ครั้งเดียวตอนต้น ข้อความแก้ไข/เพิ่มรายการทีหลังไม่จำเป็นต้องพิมพ์ซ้ำ —
      // ไม่งั้นจะหายไปทุกครั้งที่ resend แบบเดียวกับบั๊กรถที่แก้ไปแล้วด้านบน)
      await conn.execute(
        `UPDATE receipts SET customer_id = ?, vehicle_id = ?, mileage = COALESCE(?, mileage), remark = ?, total_amount = ?, deposit_amount = COALESCE(?, deposit_amount), deposit_date = COALESCE(?, deposit_date) WHERE id = ?`,
        [customerId, vehicleId, parsed.mileage ?? null, parsed.remark || null, total_amount, parsed.deposit_amount ?? null, parsed.deposit_date || null, receiptId]
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

    // parsed.paid_confirmed (เจอวลี "ชำระเงินเรียบร้อย"/"จ่ายเงินเรียบร้อย"/"...แล้ว"
    // ที่บรรทัดไหนก็ได้ — ดู PAID_PHRASE_RE) = สัญญาณปิดบิลจริง ไม่ใช่แค่กรอก
    // "ลูกค้าชำระเงิน:" เฉย ๆ อีกต่อไป — ต้องมีใบเสร็จอยู่ (ถ้ายังไม่มีก็อนุมัติ+
    // สร้างให้เองตรงนี้เลย เหมือนกดปุ่มอนุมัติบนเว็บ) แล้วเซ็ต payment_method/
    // total_amount ตามกติกา + ปิดบิล (closed_at) กันไม่ให้ใบนี้ถูก merge/ชนคิวกับ
    // ข้อความถัดไปอีก
    let paymentClosed = false;
    let paymentReceiptNo = null;
    let paymentAmount = null;
    let paymentWarning = null; // 'no_items' | 'no_vehicle'
    let depositMismatch = null;

    if (parsed.paid_confirmed) {
      if (resolvedItems.length === 0) {
        // ไม่มีรายการสินค้าเลย — สร้างใบเสร็จไม่ได้ (receipts ต้องมี receipt_items
        // อย่างน้อย 1 แถวเหมือนกติกาของ PATCH /quotations/:id/approve) เตือนแล้วปล่อย
        // ผ่าน ไม่ปิดบิล ไม่แตะ closed_at
        paymentWarning = 'no_items';
      } else {
        // ค่ามัดจำที่จะถูกบันทึกจริง (COALESCE เดียวกับจุด UPDATE quotations ด้านบน) —
        // ข้อความปิดบิลอาจไม่ได้พิมพ์ "มัดจำ:" ซ้ำ ต้องย้อนไปใช้ค่าที่เคยบันทึกไว้ในใบเดิม
        // ต้องคำนวณก่อน computeReceiptAmount เพราะสูตรใหม่ต้องใช้ค่านี้ตรง ๆ
        const effectiveDepositAmount = parsed.deposit_amount != null
          ? parsed.deposit_amount
          : (existing && existing.deposit_amount != null ? Number(existing.deposit_amount) : null);
        const fallbackTotal = parsed.stated_total != null ? parsed.stated_total : total_amount;
        paymentAmount = computeReceiptAmount(effectiveDepositAmount, parsed.paid_amount, fallbackTotal);
        depositMismatch = checkDepositMismatch(parsed, effectiveDepositAmount);

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
            `INSERT INTO receipts (receipt_no, receipt_date, customer_id, vehicle_id, mileage, remark, payment_method, total_amount, customer_signature, deposit_amount, deposit_date)
             VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [receipt_no, customerId, vehicleId, parsed.mileage ?? 0, parsed.remark || null, parsed.payment_method || null, paymentAmount, null, parsed.deposit_amount ?? null, parsed.deposit_date || null]
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

// ปิดบิลด้วยข้อความสั้น (parsed.close_only จาก parseLineQueueMessage.js — ไม่มีชื่อ
// ลูกค้า/รถ/รายการมาด้วยเลย อ้างอิงงานด้วยเลขคิวอย่างเดียว) — ต่างจาก paid_confirmed
// path ใน createQuotationFromQueue ตรงที่ไม่กรอง customer_id เลย (ข้อความไม่มีข้อมูล
// ลูกค้าให้กรอง) จึงต้องรับมือกับ "เจอมากกว่า 1 ใบ" ได้ด้วย (เลขคิวชนกันระหว่างลูกค้า
// คนละคนในหน้าต่าง 14 วัน) — ไม่เดาว่าจะปิดใบไหน ให้พนักงานไปปิดในแอปเอง มัดจำ
// (deposit_amount/deposit_date) สืบจากแถวใบเสนอราคาที่บันทึกไว้แล้วเสมอ ไม่ใช่จาก
// ข้อความ (ข้อความสั้นไม่มีฟิลด์นี้) ยอดใบเสร็จยังคงเป็นยอดรวมทั้งบิลของใบเสนอราคา
// เสมอ (มัดจำ+ยอดค้าง = ยอดรวม — กติกาเดียวกับ createQuotationFromQueue มัดจำเป็นแค่
// ข้อมูลติดตาม ไม่ลดยอดใบเสร็จ)
async function closeQuotationByQueue(parsed) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const quotationDate = todayStr();
    const [rows] = await conn.execute(
      `SELECT q.id, q.customer_id, q.quotation_no, q.converted_receipt_id, q.status, q.total_amount,
              q.deposit_amount, q.deposit_date, q.vehicle_id, c.customer_name
       FROM quotations q
       LEFT JOIN customers c ON q.customer_id = c.id
       WHERE (q.queue_no = ? OR q.requested_queue_no = ?) AND q.closed_at IS NULL
         AND q.status IN ('pending', 'approved') AND q.quotation_date >= DATE_SUB(?, INTERVAL 14 DAY)
       ORDER BY q.id DESC`,
      [parsed.queue_no, parsed.queue_no, quotationDate]
    );

    if (rows.length === 0) {
      await conn.commit(); // ยังไม่ได้แก้อะไรเลย — commit เก็บไว้เฉย ๆ
      return { matchCount: 0 };
    }
    if (rows.length > 1) {
      await conn.commit();
      return {
        matchCount: rows.length,
        candidates: rows.map((r) => ({ quotation_no: r.quotation_no, customer_name: r.customer_name })),
      };
    }

    const quotation = rows[0];

    if (!quotation.vehicle_id) {
      // Mirrors createQuotationFromQueue's paymentWarning 'no_vehicle'
      await conn.commit();
      return { matchCount: 1, warning: 'no_vehicle', quotation_no: quotation.quotation_no };
    }

    const [items] = await conn.execute('SELECT * FROM quotation_items WHERE quotation_id = ?', [quotation.id]);
    if (items.length === 0) {
      // Mirrors createQuotationFromQueue's paymentWarning 'no_items'
      await conn.commit();
      return { matchCount: 1, warning: 'no_items', quotation_no: quotation.quotation_no };
    }

    // มัดจำที่เคยรับไว้ (ถ้ามี) + ยอดที่ลูกค้าชำระเงินครั้งนี้ (parsed.paid_amount —
    // ข้อความปิดบิลสั้นมีช่องนี้อยู่แล้ว) — สูตรเดียวกับ computeReceiptAmount ใน
    // createQuotationFromQueue ครอบคลุมเคสจ่ายผ่านบัตรเครดิตที่มีค่าธรรมเนียมบวก
    // เพิ่มด้วย (พนักงานพิมพ์ยอดที่รูดจริงลง "ลูกค้าชำระเงิน" ตรง ๆ) ไม่ได้พิมพ์ยอดที่
    // จ่ายมาเลย (แค่วลีปิดบิลเฉย ๆ) ค่อย fallback เป็น total_amount ของใบเดิม
    const receiptAmount = computeReceiptAmount(quotation.deposit_amount, parsed.paid_amount, quotation.total_amount);

    let receiptId;
    let receipt_no;
    if (quotation.status === 'approved' && quotation.converted_receipt_id) {
      // อนุมัติ+มีใบเสร็จอยู่แล้ว — ทับด้วย payment_method + ยอด แล้วปิดบิล (เหมือน
      // จุด paid_confirmed ของ createQuotationFromQueue ที่ใบเสร็จมีอยู่แล้ว)
      receiptId = quotation.converted_receipt_id;
      await conn.execute(
        'UPDATE receipts SET payment_method = ?, total_amount = ?, deposit_amount = ?, deposit_date = ? WHERE id = ?',
        [parsed.payment_method || null, receiptAmount, quotation.deposit_amount, quotation.deposit_date, receiptId]
      );
      const [[receiptRow]] = await conn.query('SELECT receipt_no FROM receipts WHERE id = ?', [receiptId]);
      receipt_no = receiptRow ? receiptRow.receipt_no : null;
    } else {
      // ยัง pending → อนุมัติ+สร้างใบเสร็จเองในทรานแซกชันนี้เลย (mirror ของ
      // createQuotationFromQueue's paid_confirmed pending branch)
      receipt_no = await generateReceiptNo(conn);
      const [receiptResult] = await conn.execute(
        `INSERT INTO receipts (receipt_no, receipt_date, customer_id, vehicle_id, mileage, remark, payment_method, total_amount, customer_signature, deposit_amount, deposit_date)
         VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [receipt_no, quotation.customer_id, quotation.vehicle_id, 0, null, parsed.payment_method || null, receiptAmount, null, quotation.deposit_amount, quotation.deposit_date]
      );
      receiptId = receiptResult.insertId;
      for (const item of items) {
        await conn.execute(
          `INSERT INTO receipt_items (receipt_id, service_item_id, product_name_snapshot, qty, price, amount, warranty_name, warranty_year, warranty_month, warranty_km)
           VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [receiptId, item.product_name, item.quantity, item.unit_price, item.quantity * item.unit_price, item.warranty_name, item.warranty_year, item.warranty_month, item.warranty_km]
        );
      }
      await conn.execute(
        "UPDATE quotations SET status = 'approved', converted_receipt_id = ? WHERE id = ?",
        [receiptId, quotation.id]
      );
      // ใบแจ้งซ่อมคู่กัน เหมือนอนุมัติผ่านเว็บ/ผ่าน createQuotationFromQueue ทุกประการ
      const [existingNotice] = await conn.execute(
        'SELECT id FROM repair_notices WHERE quotation_id = ? LIMIT 1',
        [quotation.id]
      );
      if (existingNotice.length === 0) {
        const rnCode = await generateRepairNoticeCode(conn);
        await conn.execute(
          `INSERT INTO repair_notices (code, customer_id, vehicle_id, quotation_id, notice_date, checklist)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [rnCode, quotation.customer_id, quotation.vehicle_id, quotation.id, quotationDate, '{}']
        );
      }
    }

    await conn.execute('UPDATE quotations SET closed_at = NOW() WHERE id = ?', [quotation.id]);
    await conn.commit();

    return {
      matchCount: 1,
      quotation_no: quotation.quotation_no,
      customer_name: quotation.customer_name,
      receiptNo: receipt_no,
      amount: receiptAmount,
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
  // วลีแจ้งจ่ายเงินแล้วถูกพิมพ์มาแล้วปิดบิลสำเร็จ → แจ้งชัด ๆ ว่าปิดแล้ว พร้อมเลข
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
  // ยอดมัดจำ (deposit_amount) + ยอดค้างที่แจ้งมา ไม่เท่ากับยอดรวมที่แจ้งมา — เตือนเฉย ๆ
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
    // จับ group id ของกลุ่มไลน์ร้านไว้อัตโนมัติจากข้อความ/อีเวนต์แรกที่มาจากกลุ่มนั้น
    // (ดู captureGroupId ด้านบน) — ไม่ต้องตั้งค่าเอง ใช้ตอน push ข้อมูลอัปเดตกลับเข้า
    // กลุ่มจากหน้าเว็บ (ดู pushQuotationUpdate) best-effort ไม่ให้กระทบการประมวลผล
    // อีเวนต์อื่นถ้าเขียน DB พลาด
    if (event.source?.groupId) {
      try {
        await captureGroupId(event.source.groupId);
      } catch (err) {
        console.error('Error capturing LINE group id:', err);
      }
    }

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

    // ข้อความปิดบิลสั้น (close_only — ดู parseLineQueueMessage.js) ไม่มีข้อมูลลูกค้า/
    // รถ/รายการมาด้วยเลย ไม่เข้า createQuotationFromQueue (ฟังก์ชันนั้นคาดหวังข้อมูล
    // เต็มรูปแบบของงานที่เพิ่งเข้า) — แยกไปจัดการที่ closeQuotationByQueue แทน
    if (parsed.close_only) {
      try {
        const result = await closeQuotationByQueue(parsed);
        if (result.matchCount === 0) {
          await replyToLine(event.replyToken, `⚠️ ไม่พบบิลที่เปิดอยู่สำหรับคิว ${parsed.queue_no} กรุณาตรวจสอบเลขคิว`);
        } else if (result.matchCount > 1) {
          const list = result.candidates.map((c) => `- ${c.quotation_no} (${c.customer_name || 'ไม่ทราบชื่อ'})`).join('\n');
          await replyToLine(
            event.replyToken,
            `⚠️ คิว ${parsed.queue_no} มีหลายบิลที่เปิดอยู่ ไม่แน่ใจว่าจะปิดใบไหน กรุณาปิดผ่านแอปแทน:\n${list}`
          );
        } else if (result.warning === 'no_vehicle') {
          await replyToLine(event.replyToken, `⚠️ คิว ${parsed.queue_no} (${result.quotation_no}) ยังไม่มีข้อมูลรถ สร้างใบเสร็จไม่ได้ กรุณาเพิ่มข้อมูลรถก่อน`);
        } else if (result.warning === 'no_items') {
          await replyToLine(event.replyToken, `⚠️ คิว ${parsed.queue_no} (${result.quotation_no}) ยังไม่มีรายการสินค้า สร้างใบเสร็จไม่ได้ กรุณาเพิ่มรายการก่อน`);
        } else {
          await replyToLine(
            event.replyToken,
            `✅ ปิดบิล ${result.quotation_no} แล้ว\nคิว ${parsed.queue_no} · ${result.customer_name || '-'}\n💰 รับชำระแล้ว (${parsed.payment_method || '-'} ${Number(result.amount).toLocaleString()} บาท) — ใบเสร็จ ${result.receiptNo}`
          );
        }
      } catch (err) {
        console.error('Error closing quotation by queue (close_only):', err);
        await replyToLine(event.replyToken, `❌ ปิดบิลไม่สำเร็จ (คิว ${parsed.queue_no || '-'}) กรุณาปิดเองในระบบ`);
      }
      continue;
    }

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
module.exports.pushToLine = pushToLine; // ให้เทสต์ยืนยันพฤติกรรม best-effort (ไม่มี token/groupId ก็ไม่ throw) และให้ route อื่น ๆ เรียกตรง ๆ ได้ถ้าจำเป็น
module.exports.getLineGroupId = getLineGroupId; // ให้ quotations/vehicles/customers routes.js อ่าน group id ที่จับไว้ได้
module.exports.buildFilledTemplateText = buildFilledTemplateText; // ให้เทสต์ตรวจรูปแบบข้อความ push ได้โดยไม่ต้องยิง LINE API จริง
module.exports.pushQuotationUpdate = pushQuotationUpdate; // จุดรวมเดียวที่ quotations/vehicles/customers routes.js เรียกหลังแก้ไขข้อมูลสำเร็จ
