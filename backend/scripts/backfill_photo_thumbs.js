require('dotenv').config();
const mysql = require('mysql2/promise');
const sharp = require('sharp');

// เติม photo_thumb_data ย้อนหลังให้รูปรถตอนรับเข้า (intake) ที่มีอยู่แล้วก่อนจะเพิ่ม
// คอลัมน์นี้ — โค้ดที่แนบรูปใหม่ (AddJobModal.jsx/JobDetailPage.jsx) สร้าง thumb
// ให้เองอยู่แล้วตั้งแต่ตอนนี้ไป แต่รูปเก่าที่แนบไว้ก่อนหน้ายังไม่มี ทำให้ GET /jobs
// (COALESCE(photo_thumb_data, photo_data)) ยัง fallback ไปใช้รูปเต็ม ~650-800KB/รูป
// ต่อไปเรื่อยๆ จนกว่าจะรันสคริปต์นี้ — รันซ้ำได้ปลอดภัย (WHERE photo_thumb_data IS
// NULL เท่านั้น ไม่ทับ thumb ที่มีอยู่แล้ว)
(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'champpower-stock2',
  });
  try {
    const [rows] = await conn.query(
      "SELECT id, photo_data FROM job_photos WHERE photo_type = 'intake' AND photo_thumb_data IS NULL"
    );
    console.log(`พบรูปที่ยังไม่มี thumb ${rows.length} รูป`);

    let updated = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const match = /^data:(image\/\w+);base64,(.+)$/.exec(row.photo_data);
        if (!match) { failed += 1; continue; }
        const buffer = Buffer.from(match[2], 'base64');
        const thumbBuffer = await sharp(buffer)
          .resize({ width: 200, withoutEnlargement: true })
          .jpeg({ quality: 50 })
          .toBuffer();
        const thumbDataUrl = `data:image/jpeg;base64,${thumbBuffer.toString('base64')}`;
        await conn.execute(
          'UPDATE job_photos SET photo_thumb_data = ? WHERE id = ?',
          [thumbDataUrl, row.id]
        );
        updated += 1;
      } catch (err) {
        failed += 1;
        console.error(`รูป id ${row.id} ทำ thumb ไม่สำเร็จ:`, err.message);
      }
    }
    console.log(`สร้าง thumb สำเร็จ ${updated} รูป, ล้มเหลว ${failed} รูป`);
  } finally {
    await conn.end();
  }
})().catch((err) => {
  console.error('Backfill error:', err);
  process.exit(1);
});
