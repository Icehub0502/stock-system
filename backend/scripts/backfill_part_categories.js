require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// เติมคอลัมน์ category ย้อนหลังให้แถว quote_part_prices ที่มีอยู่แล้ว (สร้างก่อน
// คอลัมน์นี้จะถูกเพิ่มเข้าตาราง) — จับคู่ตาม part_name เหมือน
// import_part_images.js รันซ้ำได้ปลอดภัย (WHERE category IS NULL เท่านั้น
// ไม่ทับหมวดที่แก้ไขเองไว้แล้ว)
(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'champpower-stock2',
  });
  try {
    const parts = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'data', 'suspension_parts_seed.json'), 'utf8')
    );
    let updated = 0;
    for (const p of parts) {
      if (!p.category) continue;
      const [result] = await conn.execute(
        'UPDATE quote_part_prices SET category = ? WHERE part_name = ? AND category IS NULL',
        [p.category, p.part_name_th]
      );
      updated += result.affectedRows;
    }
    console.log(`อัปเดตหมวดหมู่ให้ ${updated} แถว`);
  } finally {
    await conn.end();
  }
})().catch((err) => {
  console.error('Backfill error:', err);
  process.exit(1);
});
