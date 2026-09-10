require('dotenv').config();
const mysql = require('mysql2/promise');
const { saveDataUrlToFile } = require('../src/utils/photoStorage');

// ย้ายรูปที่เก็บเป็น base64 ตรงๆ ใน DB (job_photos.photo_data/photo_thumb_data,
// quote_part_prices.image_data) ออกมาเป็นไฟล์จริงบนดิสก์ (backend/uploads/) แล้ว
// อัปเดตคอลัมน์ให้เก็บ URL พาธสั้นๆ แทน — ดูเหตุผลในบทสนทนากับเจ้าของร้าน (DB บวม
// 566MB จาก job_photos ตัวเดียว) รันครั้งเดียวตอน deploy ครั้งนี้ แต่รันซ้ำได้ปลอดภัย
// (WHERE ... LIKE 'data:%' กรองเฉพาะแถวที่ยังไม่ย้าย ข้ามแถวที่ย้ายไปแล้ว/ไม่มีรูปเลย)
(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'champpower-stock2',
  });

  try {
    const [jobPhotoRows] = await conn.query(
      "SELECT id, photo_data, photo_thumb_data FROM job_photos WHERE photo_data LIKE 'data:%' OR photo_thumb_data LIKE 'data:%'"
    );
    console.log(`[job_photos] พบ ${jobPhotoRows.length} แถวที่ยังเก็บเป็น base64`);
    let jobPhotosDone = 0;
    let jobPhotosFailed = 0;
    for (const row of jobPhotoRows) {
      try {
        const photoUrl = saveDataUrlToFile(row.photo_data, 'job-photos');
        const thumbUrl = saveDataUrlToFile(row.photo_thumb_data, 'job-photos');
        await conn.execute(
          'UPDATE job_photos SET photo_data = ?, photo_thumb_data = ? WHERE id = ?',
          [photoUrl, thumbUrl, row.id]
        );
        jobPhotosDone += 1;
      } catch (err) {
        jobPhotosFailed += 1;
        console.error(`[job_photos] id ${row.id} ย้ายไม่สำเร็จ:`, err.message);
      }
    }
    console.log(`[job_photos] ย้ายสำเร็จ ${jobPhotosDone} แถว, ล้มเหลว ${jobPhotosFailed} แถว`);

    const [quotePartRows] = await conn.query(
      "SELECT id, image_data FROM quote_part_prices WHERE image_data LIKE 'data:%'"
    );
    console.log(`[quote_part_prices] พบ ${quotePartRows.length} แถวที่ยังเก็บเป็น base64`);
    let quotePartsDone = 0;
    let quotePartsFailed = 0;
    for (const row of quotePartRows) {
      try {
        const imageUrl = saveDataUrlToFile(row.image_data, 'quote-parts');
        await conn.execute('UPDATE quote_part_prices SET image_data = ? WHERE id = ?', [imageUrl, row.id]);
        quotePartsDone += 1;
      } catch (err) {
        quotePartsFailed += 1;
        console.error(`[quote_part_prices] id ${row.id} ย้ายไม่สำเร็จ:`, err.message);
      }
    }
    console.log(`[quote_part_prices] ย้ายสำเร็จ ${quotePartsDone} แถว, ล้มเหลว ${quotePartsFailed} แถว`);
  } finally {
    await conn.end();
  }
})().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});
