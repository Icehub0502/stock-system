// หน้า "ตั้งค่า" เฉพาะเจ้าของร้าน (username 'ice' — ดู requireOwner ใน middleware/auth.js)
// ส่วนบอทไลน์: สถานะ token (อ่านจาก .env อย่างเดียว ไม่ให้แก้ผ่านเว็บเพราะเป็นความลับ
// ต้องแก้ที่ไฟล์ .env บนเซิร์ฟเวอร์เอง), group id ที่จับไว้, และข้อความที่บอททั้ง 3
// ตัวตอบกลับ/ส่งเข้ากลุ่มทุกแบบ (ดูทะเบียนทั้งหมดใน utils/lineMessageDefaults.js) —
// เก็บ/อ่านผ่าน app_settings key-value เดิม (getSetting/setSetting จาก
// lineWebhook.routes.js — ไม่เขียนกลไกเก็บค่าซ้ำ)
const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireOwner } = require('../middleware/auth');
const { getSetting, setSetting, getMessageTemplate } = require('./lineWebhook.routes');
const { LINE_MESSAGE_DEFAULTS } = require('../utils/lineMessageDefaults');

const router = express.Router();
router.use(authenticate);

const GROUP_ID_KEYS = ['line_group_id', 'line_group_id_bot2', 'line_group_id_bot3'];
const MESSAGE_KEYS = Object.keys(LINE_MESSAGE_DEFAULTS);

// พนักงานทั่วไป (ไม่ใช่แค่เจ้าของร้าน) ต้องอ่านค่านี้ได้ — ปุ่ม "คัดลอกลงกลุ่ม" ที่หน้า
// ใบเสนอราคาต้องใช้ label/ลำดับฟิลด์เดียวกับเทมเพลตที่เจ้าของร้านตั้งไว้จริง ไม่ใช่
// ก็อปปี้แยกไว้เอง (ที่ผ่านมาสองจุดนี้เพี้ยนกันจนบอทอ่านไม่รู้จักบรรทัดที่เปลี่ยนไป)
router.get('/line-template-blank', async (req, res) => {
  try {
    const template = await getMessageTemplate('line_template_blank');
    res.json({ template });
  } catch (err) {
    console.error('Error loading blank LINE template:', err);
    res.status(500).json({ error: 'โหลดเทมเพลตไม่สำเร็จ' });
  }
});

router.get('/line', requireOwner, async (req, res) => {
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

router.put('/line', requireOwner, async (req, res) => {
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

// เหตุผลที่ลูกค้าไม่ได้ทำ — พนักงานทั่วไปอ่านได้ (DeclineReasonModal.jsx ใช้ตอนกด
// "ลูกค้าไม่ได้ทำ") แต่แก้ไข/เพิ่ม/ลบได้เฉพาะเจ้าของร้านจากหน้าตั้งค่านี้เท่านั้น
router.get('/decline-reasons', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id, label, sort_order FROM decline_reasons ORDER BY sort_order, id');
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error loading decline reasons:', err);
    res.status(500).json({ error: 'โหลดเหตุผลไม่สำเร็จ' });
  }
});

router.post('/decline-reasons', requireOwner, async (req, res) => {
  const { label } = req.body || {};
  if (!label || !label.trim()) {
    return res.status(400).json({ error: 'กรุณากรอกเหตุผล' });
  }
  try {
    const [[{ maxOrder }]] = await pool.query('SELECT COALESCE(MAX(sort_order), 0) AS maxOrder FROM decline_reasons');
    const [result] = await pool.execute(
      'INSERT INTO decline_reasons (label, sort_order) VALUES (?, ?)',
      [label.trim(), maxOrder + 1]
    );
    res.status(201).json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    console.error('Error creating decline reason:', err);
    res.status(500).json({ error: 'เพิ่มเหตุผลไม่สำเร็จ (อาจมีชื่อนี้อยู่แล้ว)' });
  }
});

router.put('/decline-reasons/:id', requireOwner, async (req, res) => {
  const { label } = req.body || {};
  if (!label || !label.trim()) {
    return res.status(400).json({ error: 'กรุณากรอกเหตุผล' });
  }
  try {
    const [result] = await pool.execute('UPDATE decline_reasons SET label = ? WHERE id = ?', [label.trim(), req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'ไม่พบเหตุผลนี้' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating decline reason:', err);
    res.status(500).json({ error: 'แก้ไขเหตุผลไม่สำเร็จ (อาจมีชื่อนี้อยู่แล้ว)' });
  }
});

router.delete('/decline-reasons/:id', requireOwner, async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM decline_reasons WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'ไม่พบเหตุผลนี้' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting decline reason:', err);
    res.status(500).json({ error: 'ลบเหตุผลไม่สำเร็จ' });
  }
});

module.exports = router;
