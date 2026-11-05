// Webhook ของบอท 3 "Champpower ปิดบิล" — บอทตัวเดียวใช้ได้ทุกสาขา กลุ่มที่ข้อความเข้ามาเป็นตัวบอกว่าเป็นสาขาไหน
// (ดู utils/lineBot3Groups.js) กลุ่มที่ยังไม่ได้ผูกทำอะไรกับบิลไม่ได้เลย มี 3 หน้าที่:
//
// 1) ผูกกลุ่ม — ผู้จัดการสร้างรหัสที่หน้าตั้งค่า แล้วพิมพ์ "ผูกกลุ่มปิดบิล <รหัส>" ในกลุ่มของสาขานั้น
// 2) ตรวจยอด (read-only) — พนักงานคัดลอกเทมเพลตเต็มจากกลุ่ม "รายการ" (มีชื่อลูกค้า/รถ/
//    รายการครบ) มาวางในกลุ่มนี้ก่อนแจ้งลูกค้า ยังไม่ได้พิมพ์วลี "ชำระเงินเรียบร้อย" —
//    บอทรวมยอดจากรายการเอง (parsed.items) เทียบกับ "ยอดรวม:" ที่พนักงานกรอก
//    (parsed.stated_total) แล้วตอบว่ายอดตรง/ไม่ตรง/ยังไม่ได้กรอกยอด ไม่แตะ DB เลย
//    (ใช้ parseLineQueueMessage ตัวเดียวกับบอท 1 — ไม่ได้เขียนตัวพาร์สรายการซ้ำ)
// 3) ปิดบิลจริง — พิมพ์ "คิว N" + ช่องทางชำระ/ยอดที่ได้รับ + วลี "ชำระเงินเรียบร้อย"
//    (ดู PAID_PHRASE_RE ใน utils/parseLineQueueMessage.js) รับได้ทั้งข้อความสั้นแบบ
//    close_only (ไม่มีชื่อลูกค้า/รายการ) และแพทเทิร์นเต็มที่เติมช่องชำระเงิน+วลีปิดบิล
//    ต่อท้าย ใช้ closeQuotationByQueue ตัวเดียวกับบอท 1 (ดู lineWebhook.routes.js)
//    แบบ exactDate: หาเฉพาะบิลของวันที่พิมพ์มา (ไม่พิมพ์ = วันนี้) ไม่ค้นย้อนหลัง เพราะเลขคิวเริ่มใหม่ทุกวัน
//    ส่งซ้ำแล้วไปเจอคิวเลขเดียวกันของวันก่อนจะเขียนทับใบเสร็จของลูกค้าอีกคน
//
// .env ที่ต้องมี: LINE_BOT3_CHANNEL_SECRET, LINE_BOT3_CHANNEL_ACCESS_TOKEN (แยกจาก
// ของบอท 1 — คนละ LINE Official Account) เว้นว่างทั้งคู่ = ปิดฟีเจอร์ (webhook ตอบ 503)
const express = require('express');
const {
  verifySignature,
  isProcessed,
  markProcessed,
  closeQuotationByQueue,
  replyWithToken,
  getMessageTemplate,
  renderTemplate,
} = require('./lineWebhook.routes');
const parseLineQueueMessage = require('../utils/parseLineQueueMessage');
const { shopOfGroup, bindGroup } = require('../utils/lineBot3Groups');

const router = express.Router();

const SECRET_ENV = 'LINE_BOT3_CHANNEL_SECRET';
const TOKEN_ENV = 'LINE_BOT3_CHANNEL_ACCESS_TOKEN';
const BIND_COMMAND_RE = /^ผูกกลุ่มปิดบิล\s*(\d{6})$/;

// ยอดรวมจากรายการ — สูตรเดียวกับที่หน้าเว็บ/updateQuotationItemsByQueue ใช้คำนวณ
// total_amount: มี quantity/unit_price (แพทเทิร์น "จำนวนxราคาต่อหน่วย") ใช้คูณกัน
// ไม่งั้นใช้ price ตรง ๆ (ไม่มีราคาเลย = 0)
function computeItemsTotal(items) {
  return items.reduce((sum, it) => {
    const amount = it.unit_price != null ? Number(it.unit_price) * Number(it.quantity || 1) : Number(it.price || 0);
    return sum + amount;
  }, 0);
}

// yyyy-mm-dd → dd/mm/yy (พ.ศ.) รูปแบบเดียวกับบรรทัดวันที่ที่พนักงานพิมพ์
function thaiShortDate(isoDate) {
  const [year, month, day] = String(isoDate).split('-');
  return `${day}/${month}/${String(Number(year) + 543).slice(-2)}`;
}

async function handleBindCommand(token, event, code) {
  try {
    const bound = await bindGroup(event.source.groupId, code);
    const reply = bound
      ? renderTemplate(await getMessageTemplate('bot3_bind_success', bound.shopId), { shop_name: bound.shopName })
      : await getMessageTemplate('bot3_bind_invalid');
    await replyWithToken(token, event.replyToken, reply);
  } catch (err) {
    console.error('Error binding bot3 group:', err);
    await replyWithToken(token, event.replyToken, await getMessageTemplate('bot3_bind_invalid'));
  }
}

async function handleAmountCheck(token, event, parsed, shopId) {
  const computedTotal = computeItemsTotal(parsed.items);
  const headerLine = `คิว ${parsed.queue_no} · ${parsed.customer_name || '-'}`;

  if (parsed.stated_total == null) {
    await replyWithToken(token, event.replyToken, renderTemplate(await getMessageTemplate('bot3_amount_missing', shopId), {
      header: headerLine, computed_total: computedTotal.toLocaleString(),
    }));
  } else if (computedTotal === Number(parsed.stated_total)) {
    await replyWithToken(token, event.replyToken, renderTemplate(await getMessageTemplate('bot3_amount_match', shopId), {
      header: headerLine, computed_total: computedTotal.toLocaleString(),
    }));
  } else {
    await replyWithToken(token, event.replyToken, renderTemplate(await getMessageTemplate('bot3_amount_mismatch', shopId), {
      header: headerLine, computed_total: computedTotal.toLocaleString(), stated_total: Number(parsed.stated_total).toLocaleString(),
    }));
  }
}

async function handleClose(token, event, parsed, shopId) {
  const queueNo = parsed.queue_no || '-';
  const reply = async (key, vars) => replyWithToken(token, event.replyToken, renderTemplate(await getMessageTemplate(key, shopId), vars));

  // ยอดสรุปรายวันแยกตามช่องทางชำระ ไม่รู้ช่องทางก็ลงยอดไม่ถูก — ยังไม่ปิดบิล ให้ส่งใหม่
  if (!parsed.payment_method) {
    await reply('bot3_close_no_payment', { queue_no: queueNo });
    return;
  }

  try {
    const result = await closeQuotationByQueue(parsed, { shopId, exactDate: true });
    if (result.matchCount === 0) {
      await reply('bot3_close_not_found', { queue_no: queueNo, date: thaiShortDate(result.quotation_date) });
    } else if (result.matchCount > 1) {
      const list = result.candidates.map((c) => `- ${c.quotation_no} (${c.customer_name || 'ไม่ทราบชื่อ'})`).join('\n');
      await reply('bot3_close_ambiguous', { queue_no: queueNo, list });
    } else if (result.warning === 'no_vehicle') {
      await reply('bot3_close_no_vehicle', { queue_no: queueNo, quotation_no: result.quotation_no });
    } else if (result.warning === 'no_items') {
      await reply('bot3_close_no_items', { queue_no: queueNo, quotation_no: result.quotation_no });
    } else {
      await reply('bot3_close_success', {
        quotation_no: result.quotation_no,
        queue_no: queueNo,
        customer_name: result.customer_name || '-',
        license_plate: result.license_plate || '-',
        payment_method: parsed.payment_method,
        amount: Number(result.amount).toLocaleString(),
        receipt_no: result.receiptNo,
      });
    }
  } catch (err) {
    console.error('Error closing quotation by queue (bot3):', err);
    await reply('bot3_close_failed', { queue_no: queueNo });
  }
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
    if (event.type !== 'message' || event.message?.type !== 'text') continue;

    // LINE ส่ง webhook ซ้ำได้ — ข้อความเดิมต้องไม่ถูกปิดบิล/ตอบซ้ำ
    const messageId = event.message.id;
    if (messageId && (await isProcessed(messageId))) continue;

    const groupId = event.source?.groupId;
    const bindCommand = BIND_COMMAND_RE.exec(event.message.text.trim());
    if (bindCommand) {
      if (!groupId) continue;
      if (messageId) await markProcessed(messageId);
      await handleBindCommand(token, event, bindCommand[1]);
      continue;
    }

    const parsed = parseLineQueueMessage(event.message.text);
    if (!parsed) continue; // แชตทั่วไปในกลุ่ม/ข้อความไม่ครบเทมเพลต — ข้ามเงียบ ๆ
    if (messageId) await markProcessed(messageId);

    const shopId = await shopOfGroup(groupId);
    if (!shopId) {
      // แจ้งเมื่อมีคนตั้งใจปิดบิล ไม่งั้นเขาจะเข้าใจว่าปิดแล้ว (แชตส่วนตัวกับบอทก็มาทางนี้ — ไม่มีกลุ่ม)
      if (parsed.paid_confirmed) {
        await replyWithToken(token, event.replyToken, await getMessageTemplate('bot3_group_not_bound'));
      }
      continue;
    }

    // ยังไม่พิมพ์วลีปิดบิล ("ชำระเงินเรียบร้อย" ฯลฯ) — ถ้ามีรายการมาด้วย ให้ตรวจยอด
    // ให้เฉย ๆ (read-only ไม่แตะ DB) ไม่มีรายการเลยก็ไม่ใช่ข้อความที่เกี่ยวกับกลุ่มนี้
    // เลย ข้ามเงียบ ๆ (close_only ไม่มีทางมาถึงจุดนี้ เพราะ close_only ต้อง
    // paid_confirmed=true เสมอ — ดู parseLineQueueMessage.js)
    if (!parsed.paid_confirmed) {
      if (parsed.items && parsed.items.length > 0) await handleAmountCheck(token, event, parsed, shopId);
      continue;
    }

    await handleClose(token, event, parsed, shopId);
  }

  res.json({ success: true });
});

module.exports = router;
