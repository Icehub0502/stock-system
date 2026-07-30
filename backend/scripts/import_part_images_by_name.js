require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// นำเข้ารูปอะไหล่จริงชุดที่ 2 (เจ้าของร้านเตรียมมาแยกจากชุดแรก ใช้ระบบเลข
// ลำดับ/หมวดหมู่คนละแบบ ไม่ตรงลำดับกับ suspension_parts_seed.json) — จับคู่
// ด้วย "ชื่ออะไหล่" แทนเลขลำดับไฟล์ (ตัดเลขนำหน้า ตัดวรรค/ขีดล่าง/วงเล็บออก
// แล้วเทียบ) ไฟล์ไหนชื่อไม่ตรงกับอะไหล่ที่มีอยู่ในระบบจะข้ามไปเฉย ๆ (ไม่เพิ่ม
// รายการใหม่ ไม่เดาโครงสร้าง) แล้วพิมพ์รายชื่อไฟล์ที่ข้ามให้ตรวจสอบทีหลัง
//
// ใช้: node scripts/import_part_images_by_name.js <โฟลเดอร์รูปต้นทาง>
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

function slugify(text) {
  return text.trim().replace(/[()]/g, ' ').replace(/[\s/+]+/g, '-').replace(/^-+|-+$/g, '');
}

(async () => {
  const sourceDir = process.argv[2];
  if (!sourceDir) {
    console.error('ใช้: node scripts/import_part_images_by_name.js <โฟลเดอร์รูปต้นทาง>');
    process.exit(1);
  }

  const parts = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'data', 'suspension_parts_seed.json'), 'utf8')
  );
  const seedMap = new Map();
  for (const p of parts) {
    seedMap.set(normalize(p.part_name_th), p.part_name_th);
  }

  const publicDir = path.join(__dirname, '..', '..', 'frontend', 'public', 'part-images');
  fs.mkdirSync(publicDir, { recursive: true });

  const sourceFiles = fs.readdirSync(sourceDir).filter((f) => f.toLowerCase().endsWith('.png'));

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'champpower-stock2',
  });

  try {
    let copied = 0;
    let updatedRows = 0;
    const unmatched = [];

    for (const file of sourceFiles) {
      const norm = alias(normalize(file));
      const partName = seedMap.get(norm);
      if (!partName) {
        unmatched.push(file);
        continue;
      }

      const slug = slugify(partName);
      const destPath = path.join(publicDir, `${slug}.png`);
      fs.copyFileSync(path.join(sourceDir, file), destPath);
      copied += 1;

      const [result] = await conn.execute(
        'UPDATE quote_part_prices SET image_data = ? WHERE part_name = ?',
        [`/part-images/${slug}.png`, partName]
      );
      updatedRows += result.affectedRows;
    }

    console.log(`คัดลอกรูป ${copied} ไฟล์ (จับคู่ชื่อได้) ไปที่ frontend/public/part-images/`);
    console.log(`อัปเดต quote_part_prices ${updatedRows} แถว`);
    console.log(`ไฟล์ที่ชื่อไม่ตรงกับอะไหล่ในระบบ (ข้าม): ${unmatched.length}`);
    if (unmatched.length > 0) {
      console.log(unmatched.join('\n'));
    }
  } finally {
    await conn.end();
  }
})().catch((err) => {
  console.error('Import error:', err);
  process.exit(1);
});
