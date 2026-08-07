// Webhook ของบอท 3 "Champpower ปิดบิล" — Phase E ของแผนงาน 3 บอท มี 2 หน้าที่ในกลุ่มนี้:
//
// 1) ตรวจยอด (read-only) — พนักงานคัดลอกเทมเพลตเต็มจากกลุ่ม "รายการ" (มีชื่อลูกค้า/รถ/
//    รายการครบ) มาวางในกลุ่มนี้ก่อนแจ้งลูกค้า ยังไม่ได้พิมพ์วลี "ชำระเงินเรียบร้อย" —
//    บอทรวมยอดจากรายการเอง (parsed.items) เทียบกับ "ยอดรวม:" ที่พนักงานกรอก
//    (parsed.stated_total) แล้วตอบว่ายอดตรง/ไม่ตรง/ยังไม่ได้กรอกยอด ไม่แตะ DB เลย
//    (ใช้ parseLineQueueMessage ตัวเดียวกับบอท 1 — ไม่ได้เขียนตัวพาร์สรายการซ้ำ)
// 2) ปิดบิลจริง — พิมพ์ "คิว N" + ช่องทางชำระ/ยอดที่ได้รับ + วลี "ชำระเงินเรียบร้อย"
//    (ดู PAID_PHRASE_RE ใน utils/parseLineQueueMessage.js) รับได้ทั้งข้อความสั้นแบบ
//    close_only (ไม่มีชื่อลูกค้า/รายการ) และแพทเทิร์นเต็มที่เติมช่องชำระเงิน+วลีปิดบิล
//    ต่อท้าย ใช้ closeQuotationByQueue ตัวเดียวกับบอท 1 (ดู lineWebhook.routes.js)
//    ไม่ได้เขียนตรรกะปิดบิล/สร้างใบเสร็จซ้ำ — ฟังก์ชันนั้นอ่านแค่ queue_no/
//    payment_method/paid_amount จาก parsed เท่านั้น ไม่แตะชื่อลูกค้า/รายการเลย
//
// .env ที่ต้องมี: LINE_BOT3_CHANNEL_SECRET, LINE_BOT3_CHANNEL_ACCESS_TOKEN (แยกจาก
// ของบอท 1 — คนละ LINE Official Account) เว้นว่างทั้งคู่ = ปิดฟีเจอร์ (webhook ตอบ 503)
const express = require('express');
const {
  verifySignature,
  setSetting,
  closeQuotationByQueue,
  replyWithToken,
} = require('./lineWebhook.routes');
const parseLineQueueMessage = require('../utils/parseLineQueueMessage');

const router = express.Router();

const SECRET_ENV = 'LINE_BOT3_CHANNEL_SECRET';
const TOKEN_ENV = 'LINE_BOT3_CHANNEL_ACCESS_TOKEN';
const GROUP_KEY = 'line_group_id_bot3';

// ยอดรวมจากรายการ — สูตรเดียวกับที่หน้าเว็บ/updateQuotationItemsByQueue ใช้คำนวณ
// total_amount: มี quantity/unit_price (แพทเทิร์น "จำนวนxราคาต่อหน่วย") ใช้คูณกัน
// ไม่งั้นใช้ price ตรง ๆ (ไม่มีราคาเลย = 0)
function computeItemsTotal(items) {
  return items.reduce((sum, it) => {
    const amount = it.unit_price != null ? Number(it.unit_price) * Number(it.quantity || 1) : Number(it.price || 0);
    return sum + amount;
  }, 0);
}

router.post('/webhook', async (req, res) => {
  const secret = process.env[SECRET_ENV];
  if (!secret) {
    return res.status(503).json({ error: 'LINE Bot3 webhook not configured' });
  }
  if (!verifySignature(req.rawBody, req.get('x-line-signature'), secret)) {
    return res.status(401).json({ error: 'invalid signature' });
  }

  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  const token = process.env[TOKEN_ENV];

  for (const event of events) {
    if (event.source?.groupId) {
      try {
        await setSetting(GROUP_KEY, event.source.groupId);
      } catch (err) {
        console.error('Error capturing bot3 group id:', err);
      }
    }

    if (event.type !== 'message' || event.message?.type !== 'text') continue;

    const parsed = parseLineQueueMessage(event.message.text);
    if (!parsed) continue; // แชตทั่วไปในกลุ่ม/ข้อความไม่ครบเทมเพลต — ข้ามเงียบ ๆ

    // ยังไม่พิมพ์วลีปิดบิล ("ชำระเงินเรียบร้อย" ฯลฯ) — ถ้ามีรายการมาด้วย ให้ตรวจยอด
    // ให้เฉย ๆ (read-only ไม่แตะ DB) ไม่มีรายการเลยก็ไม่ใช่ข้อความที่เกี่ยวกับกลุ่มนี้
    // เลย ข้ามเงียบ ๆ (close_only ไม่มีทางมาถึงจุดนี้ เพราะ close_only ต้อง
    // paid_confirmed=true เสมอ — ดู parseLineQueueMessage.js)
    if (!parsed.paid_confirmed) {
      if (!parsed.items || parsed.items.length === 0) continue;

      const computedTotal = computeItemsTotal(parsed.items);
      const headerLine = `คิว ${parsed.queue_no} · ${parsed.customer_name || '-'}`;

      if (parsed.stated_total == null) {
        await replyWithToken(
          token,
          event.replyToken,
          `⚠️ ${headerLine}\nยังไม่ได้กรอก "ยอดรวม:" ครับ ยอดที่คำนวณจากรายการได้ ${computedTotal.toLocaleString()} บาท กรุณาตรวจสอบและกรอกยอดรวมก่อนแจ้งลูกค้า`
        );
      } else if (computedTotal === Number(parsed.stated_total)) {
        await replyWithToken(
          token,
          event.replyToken,
          `✅ ${headerLine}\nยอดตรงกันครับ รวม ${computedTotal.toLocaleString()} บาท`
        );
      } else {
        await replyWithToken(
          token,
          event.replyToken,
          `❌ ${headerLine}\nยอดไม่ตรงกัน! รายการรวมได้ ${computedTotal.toLocaleString()} บาท แต่กรอก "ยอดรวม:" ไว้ ${Number(parsed.stated_total).toLocaleString()} บาท กรุณาตรวจสอบก่อนแจ้งลูกค้า`
        );
      }
      continue;
    }

    try {
      const result = await closeQuotationByQueue(parsed);
      if (result.matchCount === 0) {
        await replyWithToken(token, event.replyToken, `⚠️ ไม่พบบิลที่เปิดอยู่สำหรับคิว ${parsed.queue_no} กรุณาตรวจสอบเลขคิว`);
      } else if (result.matchCount > 1) {
        const list = result.candidates.map((c) => `- ${c.quotation_no} (${c.customer_name || 'ไม่ทราบชื่อ'})`).join('\n');
        await replyWithToken(
          token,
          event.replyToken,
          `⚠️ คิว ${parsed.queue_no} มีหลายบิลที่เปิดอยู่ ไม่แน่ใจว่าจะปิดใบไหน กรุณาปิดผ่านแอปแทน:\n${list}`
        );
      } else if (result.warning === 'no_vehicle') {
        await replyWithToken(token, event.replyToken, `⚠️ คิว ${parsed.queue_no} (${result.quotation_no}) ยังไม่มีข้อมูลรถ สร้างใบเสร็จไม่ได้ กรุณาเพิ่มข้อมูลรถก่อน`);
      } else if (result.warning === 'no_items') {
        await replyWithToken(token, event.replyToken, `⚠️ คิว ${parsed.queue_no} (${result.quotation_no}) ยังไม่มีรายการสินค้า สร้างใบเสร็จไม่ได้ กรุณาเพิ่มรายการก่อน`);
      } else {
        await replyWithToken(
          token,
          event.replyToken,
          `✅ ปิดบิล ${result.quotation_no} เรียบร้อยแล้วตรับ\nคิว ${parsed.queue_no} · ${result.customer_name || '-'}\n💰 รับชำระแล้ว (${parsed.payment_method || '-'} ${Number(result.amount).toLocaleString()} บาท) — ใบเสร็จ ${result.receiptNo}`
        );
      }
    } catch (err) {
      console.error('Error closing quotation by queue (bot3):', err);
      await replyWithToken(token, event.replyToken, `❌ ปิดบิลไม่สำเร็จ (คิว ${parsed.queue_no || '-'}) กรุณาปิดเองในระบบ`);
    }
  }

  res.json({ success: true });
});

module.exports = router;
