// Webhook ของบอท 2 "Champpower รับรายการ" — รับต่อจากบอท 1 (ลงคิว) แล้วรอรับรายการ
// อะไหล่/สรุปราคาจากพนักงาน ก่อนส่งต่อให้บอท 3 ปิดบิล (ดูแผนงาน 3 บอทที่ตกลงกันไว้)
// ยังไม่มี business logic จริง — ดูโครงร่างที่ใช้ร่วมกับบอท 3 ใน utils/lineWebhookStub.js
const createLineWebhookStub = require('../utils/lineWebhookStub');

module.exports = createLineWebhookStub({
  secretEnv: 'LINE_BOT2_CHANNEL_SECRET',
  settingsKey: 'line_group_id_bot2',
  label: 'LINE Bot2 (รับรายการ)',
});
