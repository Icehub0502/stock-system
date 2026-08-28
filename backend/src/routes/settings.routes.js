// หน้า "ตั้งค่า" เฉพาะเจ้าของร้าน (username 'ice' — ดู requireOwner ใน middleware/auth.js)
// ตอนนี้มีแค่ส่วนตั้งค่าบอทไลน์: สถานะ token (อ่านจาก .env อย่างเดียว ไม่ให้แก้ผ่านเว็บ
// เพราะเป็นความลับ ต้องแก้ที่ไฟล์ .env บนเซิร์ฟเวอร์เอง), group id ที่จับไว้ และเทมเพลต
// ข้อความ 2 แบบ (ว่าง/กรอกแล้ว) ที่แก้ไขได้จริงผ่าน app_settings (ดู getSetting/
// setSetting ที่ export มาจาก lineWebhook.routes.js — ไม่เขียนกลไก key-value ซ้ำ)
const express = require('express');
const { authenticate, requireOwner } = require('../middleware/auth');
const {
  getSetting,
  setSetting,
  DEFAULT_BLANK_TEMPLATE,
  DEFAULT_FILLED_TEMPLATE,
} = require('./lineWebhook.routes');

const router = express.Router();
router.use(authenticate, requireOwner);

router.get('/line', async (req, res) => {
  try {
    const [
      line_group_id,
      line_group_id_bot2,
      line_group_id_bot3,
      line_template_blank,
      line_template_filled,
    ] = await Promise.all([
      getSetting('line_group_id'),
      getSetting('line_group_id_bot2'),
      getSetting('line_group_id_bot3'),
      getSetting('line_template_blank'),
      getSetting('line_template_filled'),
    ]);
    res.json({
      success: true,
      data: {
        bots: {
          bot1: Boolean(process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN),
          bot2: Boolean(process.env.LINE_BOT2_CHANNEL_SECRET && process.env.LINE_BOT2_CHANNEL_ACCESS_TOKEN),
          bot3: Boolean(process.env.LINE_BOT3_CHANNEL_SECRET && process.env.LINE_BOT3_CHANNEL_ACCESS_TOKEN),
        },
        group_ids: {
          line_group_id: line_group_id || '',
          line_group_id_bot2: line_group_id_bot2 || '',
          line_group_id_bot3: line_group_id_bot3 || '',
        },
        templates: {
          blank: line_template_blank || DEFAULT_BLANK_TEMPLATE,
          filled: line_template_filled || DEFAULT_FILLED_TEMPLATE,
        },
        defaults: {
          blank: DEFAULT_BLANK_TEMPLATE,
          filled: DEFAULT_FILLED_TEMPLATE,
        },
      },
    });
  } catch (err) {
    console.error('Error loading LINE settings:', err);
    res.status(500).json({ error: 'โหลดการตั้งค่าไม่สำเร็จ' });
  }
});

router.put('/line', async (req, res) => {
  const { group_ids = {}, templates = {} } = req.body || {};
  try {
    const writes = [];
    if (typeof group_ids.line_group_id === 'string') writes.push(setSetting('line_group_id', group_ids.line_group_id.trim()));
    if (typeof group_ids.line_group_id_bot2 === 'string') writes.push(setSetting('line_group_id_bot2', group_ids.line_group_id_bot2.trim()));
    if (typeof group_ids.line_group_id_bot3 === 'string') writes.push(setSetting('line_group_id_bot3', group_ids.line_group_id_bot3.trim()));
    if (typeof templates.blank === 'string') writes.push(setSetting('line_template_blank', templates.blank));
    if (typeof templates.filled === 'string') writes.push(setSetting('line_template_filled', templates.filled));
    await Promise.all(writes);
    res.json({ success: true });
  } catch (err) {
    console.error('Error saving LINE settings:', err);
    res.status(500).json({ error: 'บันทึกการตั้งค่าไม่สำเร็จ' });
  }
});

module.exports = router;
