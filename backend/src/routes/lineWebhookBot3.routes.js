// Webhook ของบอท 3 "Champpower ปิดบิล" — รับต่อจากบอท 2 (สรุปรายการ/ราคาแล้ว) รอ
// พนักงานคัดลอกหลักฐานชำระเงินมาปิดบิล (ดูแผนงาน 3 บอทที่ตกลงกันไว้)
// ยังไม่มี business logic จริง — ดูโครงร่างที่ใช้ร่วมกับบอท 2 ใน utils/lineWebhookStub.js
const createLineWebhookStub = require('../utils/lineWebhookStub');

module.exports = createLineWebhookStub({
  secretEnv: 'LINE_BOT3_CHANNEL_SECRET',
  settingsKey: 'line_group_id_bot3',
  label: 'LINE Bot3 (ปิดบิล)',
});
