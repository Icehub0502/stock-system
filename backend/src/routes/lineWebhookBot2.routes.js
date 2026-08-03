// Webhook ของบอท 2 "Champpower รับรายการ" — Phase D ของแผนงาน 3 บอท พนักงานพิมพ์
// "คิว N" ตามด้วยรายการอะไหล่+ราคา (บรรทัดละ 1 รายการ) ในกลุ่มนี้ บอทจับคู่แคตาล็อก/
// ขยายชุดด้วยตรรกะเดียวกับบอท 1 (updateQuotationItemsByQueue ใน lineWebhook.routes.js
// — ไม่ได้เขียนตรรกะจับคู่/บันทึกรายการซ้ำ) แล้วบันทึกทับ quotation_items ของใบเสนอ
// ราคาที่ตรงเลขคิว จากนั้น push สรุปยอดรวมต่อให้กลุ่มบอท 3 ให้พร้อมปิดบิล
//
// .env ที่ต้องมี: LINE_BOT2_CHANNEL_SECRET, LINE_BOT2_CHANNEL_ACCESS_TOKEN (แยกจาก
// ของบอท 1 — คนละ LINE Official Account) เว้นว่างทั้งคู่ = ปิดฟีเจอร์ (webhook ตอบ 503)
const express = require('express');
const {
  verifySignature,
  getSetting,
  setSetting,
  updateQuotationItemsByQueue,
  fetchQuotationForPush,
  buildQueueSummaryText,
  replyWithToken,
  pushWithToken,
} = require('./lineWebhook.routes');

const router = express.Router();

const SECRET_ENV = 'LINE_BOT2_CHANNEL_SECRET';
const TOKEN_ENV = 'LINE_BOT2_CHANNEL_ACCESS_TOKEN';
const GROUP_KEY = 'line_group_id_bot2';

router.post('/webhook', async (req, res) => {
  const secret = process.env[SECRET_ENV];
  if (!secret) {
    return res.status(503).json({ error: 'LINE Bot2 webhook not configured' });
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
        console.error('Error capturing bot2 group id:', err);
      }
    }

    if (event.type !== 'message' || event.message?.type !== 'text') continue;

    const lines = event.message.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const queueMatch = lines.length > 0 ? /^คิว(?:ที่)?\s*:*\s*(\S+)/.exec(lines[0]) : null;
    if (!queueMatch) continue; // แชตทั่วไปในกลุ่ม ไม่ได้ขึ้นต้นด้วย "คิว N" — ข้ามเงียบ ๆ

    const queueNo = queueMatch[1];
    // พนักงานพิมพ์รายการเปล่า ๆ ต่อจาก "คิว N" ก็ได้ (บรรทัดละ 1 รายการตรง ๆ) หรือจะ
    // คัดลอกเทมเพลตเต็มที่บอทส่งมาก่อนหน้า (มีหัวข้อลูกค้า/รถ + "รายการ:" + เครื่องหมาย
    // จบรายการ) มาแก้เพิ่มรายการเข้าไปก็ได้เหมือนกัน — เจอบรรทัด "รายการ:" เมื่อไหร่ถือว่า
    // ทุกอย่างก่อนหน้านั้น (หัวข้อลูกค้า/รถ/อาการ) ไม่ใช่รายการอะไหล่ ตัดทิ้งไปก่อนส่งเข้า
    // ตัวพาร์ส กันบรรทัดแบบ "เบอร์โทรศัพท์:096-475-4782" ที่ลงท้ายด้วยตัวเลขถูกเข้าใจผิด
    // เป็นชื่อ+ราคาอะไหล่ — ไม่มีบรรทัด "รายการ:" เลยก็ตกกลับไปใช้ทุกบรรทัดหลัง "คิว N"
    // ตรง ๆ เหมือนเดิม (ตัดบรรทัดวันที่เดี่ยว ๆ ทิ้งด้วยถ้ามี เผื่อคัดลอกมาทั้งบรรทัดวันที่)
    const triggerIndex = lines.findIndex((l, idx) => idx > 0 && /^รายการ\s*:*\s*$/.test(l));
    const itemLines = triggerIndex >= 0
      ? lines.slice(triggerIndex + 1)
      : lines.slice(1).filter((l) => !/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(l));

    try {
      const result = await updateQuotationItemsByQueue(queueNo, itemLines);

      if (result.noItems) {
        await replyWithToken(token, event.replyToken, '⚠️ ไม่พบรายการอะไหล่ในข้อความ กรุณาพิมพ์ชื่อ+ราคาต่อบรรทัดใต้เลขคิว');
        continue;
      }
      if (result.matchCount === 0) {
        await replyWithToken(token, event.replyToken, `⚠️ ไม่พบใบเสนอราคาที่เปิดอยู่สำหรับคิว ${queueNo} กรุณาตรวจสอบเลขคิว`);
        continue;
      }
      if (result.matchCount > 1) {
        await replyWithToken(token, event.replyToken, `⚠️ คิว ${queueNo} มีหลายใบที่เปิดอยู่พร้อมกัน ไม่แน่ใจว่าจะลงใบไหน กรุณาลงรายการผ่านแอปแทน`);
        continue;
      }

      // ตอบกลับกลุ่มบอท 2 ด้วยเทมเพลตเต็ม (เหมือนของเดิมที่พิมพ์เข้าบอท 1 ทุกประการ
      // แต่ตอนนี้มีรายการ+ยอดรวมกรอกให้แล้ว) แล้ว push ข้อความเดียวกันเป๊ะ ๆ ต่อให้
      // กลุ่มบอท 3 เพื่อรอปิดบิล (ดู buildQueueSummaryText ใน lineWebhook.routes.js)
      const data = await fetchQuotationForPush(result.quotationId);
      const summaryText = data
        ? buildQueueSummaryText(data)
        : `✅ บันทึกรายการแล้ว คิว ${queueNo} · ${result.itemCount} รายการ รวม ${result.totalAmount.toLocaleString()} บาท`;
      await replyWithToken(token, event.replyToken, summaryText);

      // ส่งต่อให้กลุ่มบอท 3 — best-effort เหมือนจุดอื่น ๆ ทั้งหมด (ไม่มี token/
      // group id ของบอท 3 ก็แค่ข้าม ไม่กระทบการตอบกลับกลุ่มบอท 2 ด้านบน)
      const bot3Token = process.env.LINE_BOT3_CHANNEL_ACCESS_TOKEN;
      const bot3GroupId = await getSetting('line_group_id_bot3');
      if (data && bot3Token && bot3GroupId) {
        await pushWithToken(bot3Token, bot3GroupId, summaryText);
      }
    } catch (err) {
      console.error('Error updating quotation items from bot2 message:', err);
      await replyWithToken(token, event.replyToken, `❌ บันทึกรายการไม่สำเร็จ (คิว ${queueNo}) กรุณาลงรายการผ่านแอปแทน`);
    }
  }

  res.json({ success: true });
});

module.exports = router;
