// Webhook ของบอท 3 "Champpower ปิดบิล" — Phase E ของแผนงาน 3 บอท รับข้อความปิดบิล
// แบบเดียวกับที่บอท 1 เคยรองรับทุกประการ (พิมพ์ "คิว N" + ช่องทางชำระ/ยอดที่ได้รับ +
// วลี "ชำระเงินเรียบร้อย" — ดู PAID_PHRASE_RE ใน utils/parseLineQueueMessage.js) รับได้
// ทั้งข้อความสั้นแบบ close_only (ไม่มีชื่อลูกค้า/รายการ) และแพทเทิร์นเต็มที่พนักงาน
// คัดลอกมาจากบอท 2 (มีชื่อลูกค้า/รถ/รายการครบ) แล้วเติมช่องชำระเงิน+วลีปิดบิลต่อท้าย
// เอง — เช็คแค่ parsed.paid_confirmed (true ได้ทั้งสองแบบ) ไม่บังคับ close_only เพราะ
// กลุ่มบอท 3 ได้รับแพทเทิร์นเต็มเป็นปกติอยู่แล้ว (ดู buildQueueSummaryText ที่บอท 2
// push มาให้) ใช้ closeQuotationByQueue ตัวเดียวกับบอท 1 (ดู lineWebhook.routes.js)
// ไม่ได้เขียนตรรกะปิดบิล/สร้างใบเสร็จซ้ำ — ฟังก์ชันนั้นอ่านแค่ queue_no/payment_method/
// paid_amount จาก parsed เท่านั้น ไม่แตะชื่อลูกค้า/รายการที่อาจติดมาในแพทเทิร์นเต็มเลย
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
    if (!parsed || !parsed.paid_confirmed) continue; // ไม่มีวลีแจ้งจ่ายเงินแล้ว — ไม่ใช่คำสั่งปิดบิล ข้ามเงียบ ๆ

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
          `✅ ปิดบิล ${result.quotation_no} แล้ว\nคิว ${parsed.queue_no} · ${result.customer_name || '-'}\n💰 รับชำระแล้ว (${parsed.payment_method || '-'} ${Number(result.amount).toLocaleString()} บาท) — ใบเสร็จ ${result.receiptNo}`
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
