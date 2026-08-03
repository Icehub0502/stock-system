// โครงร่าง webhook สำหรับบอทที่ยังไม่มี business logic (บอท 2 "รับรายการอะไหล่" /
// บอท 3 "ปิดบิล" — ระหว่างพัฒนาการเชื่อมบอทต่อบอท) ตรวจลายเซ็น HMAC เหมือนบอท 1
// จริง (ดู routes/lineWebhook.routes.js) และจับ group id ของแต่ละบอทเก็บแยกกันไว้ใน
// app_settings ก่อน เพื่อให้ phase ถัดไป (สร้าง/ส่งข้อความ) ใช้ได้ทันทีโดยไม่ต้องมา
// เดินสายส่วนนี้ใหม่ — ยังไม่มี business logic ใด ๆ ทุกอีเวนต์แค่ถูกรับทราบด้วย 200
const crypto = require('crypto');
const express = require('express');
const pool = require('../db/pool');

function verifySignature(rawBody, signature, secret) {
  if (!rawBody || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function setSetting(key, value) {
  try {
    await pool.execute(
      'INSERT INTO app_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [key, value]
    );
  } catch (err) {
    console.error(`Error writing app_settings (${key}):`, err);
  }
}

// secretEnv  — ชื่อ env var ที่เก็บ Channel Secret ของบอทนี้ (แยกจาก LINE_CHANNEL_SECRET ของบอท 1)
// settingsKey — คีย์ใน app_settings สำหรับเก็บ group id ของบอทนี้ (แยกจาก line_group_id ของบอท 1)
// label      — ใช้แค่ตอน log กันสับสนว่าอีเวนต์มาจากบอทไหนตอนอ่าน log รวม
function createLineWebhookStub({ secretEnv, settingsKey, label }) {
  const router = express.Router();

  router.post('/webhook', async (req, res) => {
    const secret = process.env[secretEnv];
    if (!secret) {
      // ยังไม่ได้ตั้งค่า — ปฏิเสธไว้ก่อน ไม่เปิด endpoint ทิ้งไว้ให้ใครก็ยิงได้
      return res.status(503).json({ error: `${label} webhook not configured` });
    }
    if (!verifySignature(req.rawBody, req.get('x-line-signature'), secret)) {
      return res.status(401).json({ error: 'invalid signature' });
    }

    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    for (const event of events) {
      if (event.source?.groupId) {
        await setSetting(settingsKey, event.source.groupId);
      }
      console.log(`[${label}] event received:`, event.type, event.message?.type || '');
      // TODO: business logic ของบอทนี้ — ยังไม่ implement (รอ phase ถัดไป)
    }

    res.json({ success: true });
  });

  return router;
}

module.exports = createLineWebhookStub;
