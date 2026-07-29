require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// นำเข้าข้อมูลอ้างอิงยี่ห้อ+รุ่นรถ (backend/data/vehicle_models_seed.json —
// แปลงมาจากไฟล์ Excel ที่เจ้าของร้านให้มา) เข้าตาราง vehicle_models
// รันซ้ำได้ปลอดภัย — INSERT IGNORE ข้ามแถวที่ซ้ำ (brand, model, year_range) เดิม
(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'champpower-stock2',
  });
  try {
    const dataPath = path.join(__dirname, '..', 'data', 'vehicle_models_seed.json');
    const rows = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    if (rows.length === 0) {
      console.log('ไม่มีข้อมูลในไฟล์ seed');
      return;
    }
    const values = rows.map((r) => [r.brand, r.model, r.year_range || null]);
    const [result] = await conn.query(
      'INSERT IGNORE INTO vehicle_models (brand, model, year_range) VALUES ?',
      [values]
    );
    console.log(`นำเข้าสำเร็จ: เพิ่มใหม่ ${result.affectedRows} แถว จากทั้งหมด ${rows.length} แถวในไฟล์ (แถวที่ซ้ำถูกข้าม)`);
  } finally {
    await conn.end();
  }
})().catch((err) => {
  console.error('Import error:', err);
  process.exit(1);
});
