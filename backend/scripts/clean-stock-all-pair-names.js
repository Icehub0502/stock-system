// แก้ชื่อรายการแยกซ้าย/ขวาในสต๊อกรวมที่ย้ายมาแล้ว ให้ตัดคำ "ซ้าย/ขวา/LH/RH" ออกจากรายละเอียด
// (ย้ายรอบแรกเอาชื่อของข้างซ้ายมาทั้งดุ้น เลยมี "ซ้าย" ติดอยู่ทั้งที่รายการมีสองข้าง)
// แก้เฉพาะ stock_items.description ของรายการที่ has_sides=1 และมีทั้งซ้ายกับขวา ไม่แตะยอด/รหัส
//
// ใช้:  node scripts/clean-stock-all-pair-names.js           ← ดูตัวอย่าง (ไม่บันทึก)
//       node scripts/clean-stock-all-pair-names.js --apply   ← บันทึกจริง (ทรานแซกชันเดียว)
require('dotenv').config();
const pool = require('../src/db/pool');
const { stripSideWords } = require('../src/utils/pairName');

const APPLY = process.argv.includes('--apply');

async function main() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT i.id, i.description FROM stock_items i
       WHERE i.has_sides = 1 AND i.has_axles = 0
         AND (SELECT COUNT(*) FROM stock_item_positions p WHERE p.item_id = i.id) = 2
         AND (i.description LIKE '%ซ้าย%' OR i.description LIKE '%ขวา%' OR i.description REGEXP '(^|[^A-Za-z])(LH|RH)([^A-Za-z]|$)')`
    );
    let changed = 0;
    for (const row of rows) {
      const next = stripSideWords(row.description);
      if (next === row.description) continue;
      changed += 1;
      if (changed <= 15) console.log(`  ${row.description}\n    → ${next}`);
      await conn.query('UPDATE stock_items SET description = ? WHERE id = ?', [next.slice(0, 500), row.id]);
    }
    console.log(`\nรายการที่ตรงเงื่อนไข ${rows.length} / แก้ชื่อ ${changed}`);
    if (APPLY) { await conn.commit(); console.log('บันทึกแล้ว (COMMIT)'); }
    else { await conn.rollback(); console.log('ตัวอย่างเท่านั้น (DRY-RUN) — ใส่ --apply เพื่อบันทึกจริง'); }
  } catch (err) {
    await conn.rollback();
    console.error('ล้มเหลว — rollback:', err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main();
