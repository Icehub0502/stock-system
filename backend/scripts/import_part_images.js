require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// นำเข้ารูปอะไหล่มาตรฐาน 134 ชิ้น (เจ้าของร้านถ่าย/เตรียมไว้ ตั้งชื่อไฟล์
// "001_ชื่ออะไหล่ไทย.png" ... "134_..." ตรงลำดับเดียวกับ
// backend/data/suspension_parts_seed.json เป๊ะ) เข้าระบบ:
//
//   1. คัดลอกไฟล์รูปไปที่ frontend/public/part-images/<slug>.png (ให้ Vite
//      เสิร์ฟเป็น static asset) — สร้าง slug จากชื่ออะไหล่ไทยเอง ไม่พึ่งเลขลำดับ
//      ในชื่อไฟล์ กันปัญหาถ้าลำดับใน seed เปลี่ยนในอนาคต
//   2. อัปเดต quote_part_prices.image_data = '/part-images/<slug>.png' ให้ทุก
//      แถวที่ part_name ตรงกับอะไหล่ชิ้นนั้น (รูปอะไหล่ 1 ชนิดใช้ร่วมกันได้ทุก
//      รุ่นรถ ไม่ต้องเก็บซ้ำเป็น base64 71,556 ชุด) — เก็บเป็น "พาธไฟล์" สั้นๆ
//      ไม่ใช่ base64 เหมือน image_data ที่กรอกเองในหน้าจัดการ เพราะ <img src>
//      ใช้ได้ทั้งสองแบบเหมือนกัน
//   3. ข้ามแถวที่มีรูปอยู่แล้ว (image_data IS NOT NULL) กันทับรูปที่ออฟฟิศ
//      อัปโหลดเองไว้เฉพาะรุ่นนั้นทีหลัง
//
// ใช้: node scripts/import_part_images.js <โฟลเดอร์รูปต้นทางที่แตกซิปแล้ว>
function slugify(text) {
  return text
    .trim()
    .replace(/[()]/g, ' ')
    .replace(/[\s/+]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

(async () => {
  const sourceDir = process.argv[2];
  if (!sourceDir) {
    console.error('ใช้: node scripts/import_part_images.js <โฟลเดอร์รูปต้นทาง>');
    process.exit(1);
  }

  const parts = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'data', 'suspension_parts_seed.json'), 'utf8')
  );
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
    let missing = [];

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const seq = String(i + 1).padStart(3, '0');
      const sourceFile = sourceFiles.find((f) => f.startsWith(`${seq}_`));
      if (!sourceFile) {
        missing.push(`${seq} ${part.part_name_th}`);
        continue;
      }

      const slug = slugify(part.part_name_th);
      const destPath = path.join(publicDir, `${slug}.png`);
      fs.copyFileSync(path.join(sourceDir, sourceFile), destPath);
      copied += 1;

      const [result] = await conn.execute(
        'UPDATE quote_part_prices SET image_data = ? WHERE part_name = ? AND image_data IS NULL',
        [`/part-images/${slug}.png`, part.part_name_th]
      );
      updatedRows += result.affectedRows;
    }

    console.log(`คัดลอกรูป ${copied}/${parts.length} ไฟล์ ไปที่ frontend/public/part-images/`);
    console.log(`อัปเดต quote_part_prices ${updatedRows} แถว`);
    if (missing.length > 0) {
      console.log('ไม่พบไฟล์รูปสำหรับ:', missing.join(', '));
    }
  } finally {
    await conn.end();
  }
})().catch((err) => {
  console.error('Import error:', err);
  process.exit(1);
});
