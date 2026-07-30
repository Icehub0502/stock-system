require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// รูปชุดแรก (commit 6e54bcd "Add real photos for all 134...") กลายเป็นว่าหลายชิ้น
// เป็นไอคอนภาพวาดทั่วไป ไม่ใช่รูปถ่ายจริง — ตอนนี้แทนที่ด้วยรูปจริงไปแล้ว 61 ชิ้น
// (ดู import_part_images_by_name.js) ส่วนที่เหลือซึ่งยังเป็นไอคอนภาพวาดอยู่ ให้เอา
// image_data ออก (NULL) เพื่อให้หน้า kiosk แสดงเป็นตัวหนังสือ "ไม่มีรูป" แทน
// รอรูปจริงมาเพิ่มทีหลัง ดีกว่าโชว์ไอคอนภาพวาดที่ทำให้เข้าใจผิดว่าเป็นรูปจริง
//
// ใช้: node scripts/clear_placeholder_icons.js
function normalize(name) {
  return name
    .replace(/\.png$/i, '')
    .replace(/^\d+_/, '')
    .replace(/[()]/g, ' ')
    .replace(/[_/+]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

function alias(norm) {
  if (norm.includes('บูชเหล็กกันโคลง')) {
    return norm.replace('บูชเหล็กกันโคลง', 'ยางรัดกันโคลง');
  }
  return norm;
}

(async () => {
  const parts = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'data', 'suspension_parts_seed.json'), 'utf8')
  );
  const newPhotoDir = path.join(__dirname, '..', '..', 'frontend', 'src', 'image', 'รูปอะไหล่รายชิ้น');
  const newPhotoFiles = fs.existsSync(newPhotoDir)
    ? fs.readdirSync(newPhotoDir).filter((f) => f.toLowerCase().endsWith('.png'))
    : [];

  const realPhotoNames = new Set();
  for (const file of newPhotoFiles) {
    const norm = alias(normalize(file));
    const match = parts.find((p) => normalize(p.part_name_th) === norm);
    if (match) realPhotoNames.add(match.part_name_th);
  }

  const stillPlaceholder = parts
    .map((p) => p.part_name_th)
    .filter((name) => !realPhotoNames.has(name));

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'champpower-stock2',
  });

  try {
    let cleared = 0;
    for (const name of stillPlaceholder) {
      const [result] = await conn.execute(
        'UPDATE quote_part_prices SET image_data = NULL WHERE part_name = ?',
        [name]
      );
      cleared += result.affectedRows;
    }
    console.log(`ลบ image_data ของอะไหล่ที่ยังเป็นไอคอนภาพวาด: ${stillPlaceholder.length} ชื่อ, ${cleared} แถว`);
  } finally {
    await conn.end();
  }
})().catch((err) => {
  console.error('Clear error:', err);
  process.exit(1);
});
