// Webhook ของบอท 2 "Champpower รับรายการ" — Phase D ของแผนงาน 3 บอท พนักงานพิมพ์
// "คิว N" ตามด้วยรายการอะไหล่+ราคา (บรรทัดละ 1 รายการ) ในกลุ่มนี้ บอทจับคู่แคตาล็อก/
// ขยายชุดด้วยตรรกะเดียวกับบอท 1 (updateQuotationItemsByQueue ใน lineWebhook.routes.js
// — ไม่ได้เขียนตรรกะจับคู่/บันทึกรายการซ้ำ) แล้วบันทึกทับ quotation_items ของใบเสนอ
// ราคาที่ตรงเลขคิว ตอบกลับในกลุ่มนี้เท่านั้น (เจ้าของร้านสั่งตัดการ push ข้ามกลุ่ม
// อัตโนมัติออกแล้ว — พนักงานคัดลอกข้อความไปกลุ่ม "สรุปบิล" เองด้วยมือ กันใช้โควต้า
// push ของ LINE โดยไม่จำเป็น)
//
// .env ที่ต้องมี: LINE_BOT2_CHANNEL_SECRET, LINE_BOT2_CHANNEL_ACCESS_TOKEN (แยกจาก
// ของบอท 1 — คนละ LINE Official Account) เว้นว่างทั้งคู่ = ปิดฟีเจอร์ (webhook ตอบ 503)
const express = require('express');
const {
  verifySignature,
  setSetting,
  updateQuotationItemsByQueue,
  replyWithToken,
  getMessageTemplate,
  renderTemplate,
} = require('./lineWebhook.routes');
const { parseThaiShortDate } = require('../utils/parseLineQueueMessage');

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
    // บรรทัดที่ 2 (ต่อจาก "คิว N") มักเป็นวันที่ dd/mm/yy (พ.ศ.) ของใบที่พนักงานคัดลอก
    // เทมเพลตมา — ต้องดึงมาใช้จับคู่ใบให้ตรงวันจริง ๆ (ไม่ใช่วันนี้เสมอ) เพราะบางที
    // พนักงานลงรายการของบิลเก่าที่ค้างอยู่ (รถซ่อมข้ามวัน ลูกค้ายังไม่มารับ) เลขคิว
    // เดียวกันแต่คนละวันเกิดขึ้นได้ ถ้าไม่ดูวันที่จะไปแก้ใบของลูกค้าอีกคนที่ใช้เลขคิว
    // เดียวกันในวันอื่นแทน (ดู updateQuotationItemsByQueue ใน lineWebhook.routes.js)
    const explicitDate = lines[1] && /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(lines[1])
      ? parseThaiShortDate(lines[1])
      : null;

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
      const result = await updateQuotationItemsByQueue(queueNo, itemLines, explicitDate);

      if (result.matchCount === 0) {
        await replyWithToken(token, event.replyToken, renderTemplate(await getMessageTemplate('bot2_not_found'), { queue_no: queueNo }));
        continue;
      }

      const headerLine = `คิว ${queueNo} · ${result.customer_name || '-'}${result.license_plate ? ` · ${result.license_plate}` : ''}`;

      if (result.noItems) {
        await replyWithToken(token, event.replyToken, renderTemplate(await getMessageTemplate('bot2_no_items_yet'), { header: headerLine }));
        continue;
      }

      // เพิ่งลงรายการครั้งแรก (wasEmpty) กับแก้ไขรายการที่มีอยู่แล้วใช้คำตอบต่างกัน
      // ตามที่เจ้าของร้านสั่ง — ให้พนักงานรู้ชัดว่ากำลังเพิ่มใหม่หรือแก้ของเดิม
      const [verb, syncedLine, savedTpl] = await Promise.all([
        getMessageTemplate(result.wasEmpty ? 'bot2_saved_verb_new' : 'bot2_saved_verb_edit'),
        result.syncedReceipt ? getMessageTemplate('bot2_saved_synced_receipt') : '',
        getMessageTemplate('bot2_saved'),
      ]);
      const replyText = renderTemplate(savedTpl, {
        verb,
        header: headerLine,
        item_count: result.itemCount,
        total: result.totalAmount.toLocaleString(),
        synced_receipt_line: syncedLine,
      });
      await replyWithToken(token, event.replyToken, replyText);
    } catch (err) {
      console.error('Error updating quotation items from bot2 message:', err);
      await replyWithToken(token, event.replyToken, renderTemplate(await getMessageTemplate('bot2_save_failed'), { queue_no: queueNo }));
    }
  }

  res.json({ success: true });
});

module.exports = router;
