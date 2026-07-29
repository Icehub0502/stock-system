require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// สร้างรายการ "ราคาอะไหล่ตามรุ่นรถ" (quote_part_prices) ล่วงหน้าให้ทุกรุ่นรถ
// ในแคตตาล็อกอ้างอิง (vehicle_models) x อะไหล่มาตรฐาน 134 รายการ
// (backend/data/suspension_parts_seed.json) — ราคาตั้งต้นเป็น 0 เพราะไฟล์ต้นทาง
// ไม่มีราคาจริง (ดู backend/data/รายการอะไหล่ช่วงล่าง... ที่แปลงมา) ติด
// needs_price=1 ไว้เตือนหน้าเว็บไม่ให้เผลอเสนอราคา 0 บาทให้ลูกค้าจริงก่อนแก้ราคา
//
// รันซ้ำได้ปลอดภัย — INSERT IGNORE ยึด UNIQUE KEY (brand, model, part_name)
// ข้ามแถวที่มีอยู่แล้ว (รวมถึงแถวที่ออฟฟิศแก้ราคาไปแล้วเอง จะไม่ถูกทับ)
(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'champpower-stock2',
  });
  try {
    const models = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'data', 'vehicle_models_seed.json'), 'utf8')
    );
    const parts = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'data', 'suspension_parts_seed.json'), 'utf8')
    );

    const rows = [];
    for (const m of models) {
      const modelLabel = m.year_range ? `${m.model} (${m.year_range})` : m.model;
      for (const p of parts) {
        const description = p.part_name_en
          ? `${p.part_name_en}${p.notes ? ` — ${p.notes}` : ''}`
          : (p.notes || null);
        rows.push([m.brand, modelLabel, p.part_name_th, description, 0, 1]);
      }
    }

    console.log(`เตรียมสร้าง ${rows.length} แถว (${models.length} รุ่นรถ x ${parts.length} อะไหล่)...`);

    // แบ่งเป็นชุดๆ กันคำสั่งเดียวใหญ่เกิน max_allowed_packet
    const BATCH_SIZE = 2000;
    let totalInserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const [result] = await conn.query(
        `INSERT IGNORE INTO quote_part_prices
         (brand, model, part_name, description, price, needs_price)
         VALUES ?`,
        [batch]
      );
      totalInserted += result.affectedRows;
      process.stdout.write(`.`);
    }
    console.log(`\nนำเข้าสำเร็จ: เพิ่มใหม่ ${totalInserted} แถว จากทั้งหมด ${rows.length} แถวที่คำนวณไว้ (แถวที่ซ้ำ/มีอยู่แล้วถูกข้าม)`);
  } finally {
    await conn.end();
  }
})().catch((err) => {
  console.error('Import error:', err);
  process.exit(1);
});
