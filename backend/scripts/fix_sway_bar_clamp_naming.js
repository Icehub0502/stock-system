require('dotenv').config();
const mysql = require('mysql2/promise');

// แก้ไขครั้งเดียว: "บูชเหล็กกันโคลงหน้า/หลัง" ที่เคยเข้าใจว่าเป็นคนละชิ้นกับ
// "ยางรัดกันโคลงหน้า/หลัง" (เพิ่มเข้าไปทีหลังเป็นรายการใหม่) ที่จริงคือของชิ้น
// เดียวกัน ชื่อเดิมสะกดผิด — ลบรายการซ้ำที่เพิ่งเพิ่ม (ยังไม่มีราคา/รูป) แล้ว
// เปลี่ยนชื่อรายการเดิม (ซึ่งมีรูปอยู่แล้ว) ให้ถูกต้องแทน กันข้อมูลราคาที่ออฟฟิศ
// อาจกรอกไว้แล้วหาย — ดู backend/data/suspension_parts_seed.json ที่แก้คู่กัน
// รันซ้ำได้ปลอดภัย (แถวที่แก้ไปแล้วจะไม่เจอเงื่อนไข WHERE เดิมอีก)
(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'champpower-stock2',
  });
  try {
    const [priced] = await conn.query(
      "SELECT COUNT(*) n FROM quote_part_prices WHERE part_name IN ('บูชเหล็กกันโคลงหน้า','บูชเหล็กกันโคลงหลัง') AND (price > 0 OR needs_price = 0)"
    );
    if (priced[0].n > 0) {
      console.log(`พบ ${priced[0].n} แถวที่ตั้งราคาไว้แล้วในชื่อเดิม — หยุดไว้ก่อน ตรวจสอบด้วยมือก่อนรันสคริปต์นี้`);
      return;
    }

    const [delRes] = await conn.query(
      "DELETE FROM quote_part_prices WHERE part_name IN ('ยางรัดกันโคลงหน้า','ยางรัดกันโคลงหลัง')"
    );
    console.log('ลบรายการซ้ำที่เพิ่งเพิ่ม (ไม่มีราคา/รูป):', delRes.affectedRows);

    const [ren1] = await conn.query(
      "UPDATE quote_part_prices SET part_name = 'ยางรัดกันโคลงหน้า', description = REPLACE(description, 'Front Stabilizer Bushing', 'Front Sway Bar Bracket Clamp Rubber'), image_data = '/part-images/ยางรัดกันโคลงหน้า.png' WHERE part_name = 'บูชเหล็กกันโคลงหน้า'"
    );
    console.log('เปลี่ยนชื่อ+รูปแถวหน้า:', ren1.affectedRows);

    const [ren2] = await conn.query(
      "UPDATE quote_part_prices SET part_name = 'ยางรัดกันโคลงหลัง', description = REPLACE(description, 'Rear Stabilizer Bushing', 'Rear Sway Bar Bracket Clamp Rubber'), image_data = '/part-images/ยางรัดกันโคลงหลัง.png' WHERE part_name = 'บูชเหล็กกันโคลงหลัง'"
    );
    console.log('เปลี่ยนชื่อ+รูปแถวหลัง:', ren2.affectedRows);
  } finally {
    await conn.end();
  }
})().catch((err) => {
  console.error('Fix error:', err);
  process.exit(1);
});
