// หน้า "ตั้งค่า" เฉพาะเจ้าของร้าน (username 'ice' — ดู requireOwner ใน middleware/auth.js)
// ส่วนบอทไลน์: สถานะ token (อ่านจาก .env อย่างเดียว ไม่ให้แก้ผ่านเว็บเพราะเป็นความลับ
// ต้องแก้ที่ไฟล์ .env บนเซิร์ฟเวอร์เอง), group id ที่จับไว้, และข้อความที่บอททั้ง 3
// ตัวตอบกลับ/ส่งเข้ากลุ่มทุกแบบ (ดูทะเบียนทั้งหมดใน utils/lineMessageDefaults.js) —
// เก็บ/อ่านผ่าน app_settings key-value เดิม (getSetting/setSetting จาก
// lineWebhook.routes.js — ไม่เขียนกลไกเก็บค่าซ้ำ)
const express = require('express');
const { authenticate, requireOwner } = require('../middleware/auth');
const { getSetting, setSetting } = require('./lineWebhook.routes');
const { LINE_MESSAGE_DEFAULTS } = require('../utils/lineMessageDefaults');

const router = express.Router();
router.use(authenticate, requireOwner);

const GROUP_ID_KEYS = ['line_group_id', 'line_group_id_bot2', 'line_group_id_bot3'];
const MESSAGE_KEYS = Object.keys(LINE_MESSAGE_DEFAULTS);

router.get('/line', async (req, res) => {
  try {
    const [groupIdValues, messageValues] = await Promise.all([
      Promise.all(GROUP_ID_KEYS.map((k) => getSetting(k))),
      Promise.all(MESSAGE_KEYS.map((k) => getSetting(k))),
    ]);

    const group_ids = {};
    GROUP_ID_KEYS.forEach((k, i) => { group_ids[k] = groupIdValues[i] || ''; });

    // จัดกลุ่มตาม bot1/bot2/bot3 ให้หน้าเว็บเรียงแสดงตามที่พนักงานคุ้นเคย
    const messages = { bot1: [], bot2: [], bot3: [] };
    MESSAGE_KEYS.forEach((key, i) => {
      const def = LINE_MESSAGE_DEFAULTS[key];
      messages[def.group].push({
        key,
        label: def.label,
        vars: def.vars,
        default: def.default,
        value: messageValues[i] || def.default,
      });
    });

    res.json({
      success: true,
      data: {
        bots: {
          bot1: Boolean(process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN),
          bot2: Boolean(process.env.LINE_BOT2_CHANNEL_SECRET && process.env.LINE_BOT2_CHANNEL_ACCESS_TOKEN),
          bot3: Boolean(process.env.LINE_BOT3_CHANNEL_SECRET && process.env.LINE_BOT3_CHANNEL_ACCESS_TOKEN),
        },
        group_ids,
        messages,
      },
    });
  } catch (err) {
    console.error('Error loading LINE settings:', err);
    res.status(500).json({ error: 'โหลดการตั้งค่าไม่สำเร็จ' });
  }
});

router.put('/line', async (req, res) => {
  const { group_ids = {}, messages = {} } = req.body || {};
  try {
    const writes = [];
    GROUP_ID_KEYS.forEach((k) => {
      if (typeof group_ids[k] === 'string') writes.push(setSetting(k, group_ids[k].trim()));
    });
    // เขียนเฉพาะ key ที่รู้จักจริงในทะเบียน (กันเผลอส่ง key แปลกปลอมมาเขียนลง
    // app_settings) และต้องเป็นสตริงเท่านั้น
    Object.keys(messages).forEach((key) => {
      if (LINE_MESSAGE_DEFAULTS[key] && typeof messages[key] === 'string') {
        writes.push(setSetting(key, messages[key]));
      }
    });
    await Promise.all(writes);
    res.json({ success: true });
  } catch (err) {
    console.error('Error saving LINE settings:', err);
    res.status(500).json({ error: 'บันทึกการตั้งค่าไม่สำเร็จ' });
  }
});

module.exports = router;
