// คัดลอกสต๊อกเดิม (racks + wing_arms + รุ่นรถที่จับคู่ไว้) เข้าสต๊อกรวม (stock_items) —
// คัดลอกอย่างเดียว ไม่แก้/ไม่ลบตารางเดิมแม้แต่แถวเดียว (ระบบเดิมใช้งานต่อได้เหมือนเดิม)
//
// ใช้:  node scripts/migrate-stock-all.js            ← ดูตัวอย่างก่อน (dry-run) ไม่บันทึกอะไร
//       node scripts/migrate-stock-all.js --apply    ← บันทึกจริง (ทั้งหมดอยู่ในทรานแซกชันเดียว
//                                                      พังตรงไหน rollback หมด)
// รันซ้ำได้ปลอดภัย: รายการที่มีรหัส OEM ในหมวดนั้นอยู่แล้วจะถูกข้าม ไม่ทับยอดที่แก้ไว้
//
// แร็ค → หมวด "แร็ค" (รหัส = model_code, รายละเอียด = name)
// ปีกนก → หมวด "ปีกนก" ซ้ายกับขวาที่เป็นคู่กันรวมเป็นรายการเดียว (has_sides) โดย
//   oem_code = รหัสซ้าย, oem_code_right = รหัสขวา, stock_left/stock_right = ยอดแต่ละข้าง
//   การจับคู่ใช้กฎเดียวกับ migrate-phase1.js (ตำแหน่ง+เพลา+ข้างตรงข้าม+ชื่อสลับ ซ้าย↔ขวา)
//   บวกคู่ที่เจ้าของร้านตรวจยืนยันด้วยมือแล้วใน migrate-phase1b-pairs.js
//   ที่เหลือจับคู่ไม่ได้ → คัดลอกเป็นรายการเดี่ยว (ดูรายงานท้ายสคริปต์ให้ตรวจ)
require('dotenv').config();
const pool = require('../src/db/pool');

const APPLY = process.argv.includes('--apply');

// คู่ปีกนกที่เจ้าของร้านตรวจและยืนยันแล้ว (จาก migrate-phase1b-pairs.js) — ชื่อพิมพ์ไม่ตรง
// กันจึงจับคู่อัตโนมัติไม่ได้ แต่ SKU ชัดเจนว่าเป็นคู่เดียวกัน อ้างด้วย SKU (ไม่ใช้ id
// เพราะ id ในไฟล์ phase1b เป็น parts.id ของตารางแผนเก่า ไม่ใช่ wing_arms.id)
const CONFIRMED_PAIRS = [
  ['51350-TG1-C01', '51360-TG1-C01'],
  ['IZCA037L-LA', 'IZCA037L-RA'],
  ['IZCA063L-LA', 'IZCA063L-RA'],
  ['KACA013L-LA', 'KACA013L-RA'],
  ['TOCA057L-LA', 'TOCA057L-RA'],
  ['TOCA069L-LA', 'TOCA069L-RA'],
  ['TOCA091L-LA', 'TOCA091L-RA'],
  ['TOCA383L-LA', 'TOCA383L-RA'],
  ['JB-T172 L', 'JB-T172 R'],
  ['3A2-MGZSL /333', '3A2-MGZSR /333'],
];
// ข้อมูลเดิมที่ผิดจริง 2 จุด ใช้ SKU เป็นความจริง (แก้เฉพาะตอนคัดลอก ไม่เขียนกลับตารางเดิม)
const FIELD_FIXES = { 'IZCA063L-RA': { axle: 'front' }, 'JB-T172 R': { side: 'right' } };

// รูปแบบชื่อ/SKU ที่ตัดคำบอกข้างออกแล้ว ใช้จับคู่ซ้าย-ขวาที่ชื่อพิมพ์ไม่ตรงกันเป๊ะ
// (เช่น "ขวา Toyota Vios" กับ "ซ้ายToyota Vios", "LH/FI" กับ "RH/FI", "T7U-LA" กับ "T7U-RA")
function normalizeName(name) {
  return name.toLowerCase().replace(/ซ้าย|ขวา|lh|rh/g, '').replace(/[\s/\-_.,]+/g, '');
}
function normalizeSku(sku) {
  return sku.toLowerCase().replace(/[\s-]*(la|ra|lh|rh|l|r)$/, '').replace(/\s+/g, '');
}

function swapThaiSide(name, fromSide) {
  return fromSide === 'left' ? name.replace('ซ้าย', 'ขวา') : name.replace('ขวา', 'ซ้าย');
}

async function main() {
  const conn = await pool.getConnection();
  const report = { racksNew: 0, racksSkipped: 0, pairsNew: 0, singlesNew: 0, wingSkipped: 0, fitments: 0 };
  const singles = [];
  try {
    await conn.beginTransaction();

    const [[rackCat]] = await conn.query("SELECT id FROM stock_categories WHERE name = 'แร็ค' AND is_active = 1");
    const [[wingCat]] = await conn.query("SELECT id FROM stock_categories WHERE name = 'ปีกนก' AND is_active = 1");
    if (!rackCat || !wingCat) throw new Error('ไม่พบหมวด "แร็ค" หรือ "ปีกนก" ในสต๊อกรวม — ยกเลิก');

    const [[userRow]] = await conn.query("SELECT id FROM users WHERE role = 'office' ORDER BY id LIMIT 1");
    const userId = userRow.id;

    // positions: { left: n, right: n } สำหรับของแยกซ้าย/ขวา (hasSides) — ของธรรมดาใช้ qty
    async function insertItem({ categoryId, oem, codes, description, hasSides, qty, positions, minStock }) {
      const [exists] = await conn.query(
        'SELECT id FROM stock_items WHERE category_id = ? AND oem_code = ?', [categoryId, oem]
      );
      if (exists.length) return null;
      const [ins] = await conn.query(
        `INSERT INTO stock_items (category_id, oem_code, description, has_sides, stock_qty, min_stock)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [categoryId, oem, description, hasSides ? 1 : 0, qty, minStock]
      );
      if (hasSides) {
        for (const position of ['left', 'right']) {
          await conn.query(
            'INSERT INTO stock_item_positions (item_id, position, qty, oem_code) VALUES (?, ?, ?, ?)',
            [ins.insertId, position, positions[position], codes ? codes[position] : null]
          );
        }
      }
      const openings = hasSides
        ? [['left', positions.left], ['right', positions.right]]
        : [[null, qty]];
      for (const [position, n] of openings) {
        if (n > 0) {
          await conn.query(
            `INSERT INTO stock_item_movements (item_id, qty_before, qty_after, reason, position, note, user_id)
             VALUES (?, 0, ?, 'create', ?, 'ย้ายจากระบบสต๊อกเดิม', ?)`,
            [ins.insertId, n, position, userId]
          );
        }
      }
      return ins.insertId;
    }

    async function copyFitments(itemId, rows) {
      const seen = new Set();
      for (const f of rows) {
        const key = `${f.brand}|${f.model}|${f.year_from}|${f.year_to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await conn.query(
          'INSERT INTO stock_item_fitments (item_id, brand, model, year_from, year_to) VALUES (?, ?, ?, ?, ?)',
          [itemId, f.brand, f.model, f.year_from, f.year_to]
        );
        report.fitments += 1;
      }
    }

    // ตารางจับคู่รุ่นรถเดิมอาจยังไม่มีบนเซิร์ฟเวอร์ (ถ้าไม่เคยใช้ฟีเจอร์นั้น) → ถือว่าว่าง
    async function readIfTableExists(table) {
      const [[t]] = await conn.query(
        'SELECT COUNT(*) c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
        [table]
      );
      if (!t.c) return [];
      const [rows] = await conn.query(`SELECT * FROM ${table}`);
      return rows;
    }

    // ── แร็ค ──
    const [racks] = await conn.query('SELECT * FROM racks ORDER BY id');
    const rackFit = await readIfTableExists('rack_fitments');
    for (const r of racks) {
      const id = await insertItem({
        categoryId: rackCat.id, oem: r.model_code, codes: null, description: r.name,
        hasSides: false, qty: r.stock_qty, positions: null, minStock: r.min_stock,
      });
      if (!id) { report.racksSkipped += 1; continue; }
      report.racksNew += 1;
      await copyFitments(id, rackFit.filter((f) => f.rack_id === r.id));
    }

    // ── ปีกนก ──
    const [wingRaw] = await conn.query('SELECT * FROM wing_arms ORDER BY id');
    const wingFit = await readIfTableExists('wing_arm_fitments');
    // แก้ side ตาม SKU (-LA/-RA) และค่าที่ยืนยันแล้ว เฉพาะในหน่วยความจำ — ไม่เขียนกลับตารางเดิม
    const wings = wingRaw.map((w) => {
      let side = w.side;
      if (/-LA$/i.test(w.sku)) side = 'left';
      if (/-RA$/i.test(w.sku)) side = 'right';
      return { ...w, side, axle: w.axle || null, ...(FIELD_FIXES[w.sku] || {}) };
    });
    const bySku = new Map(wings.map((w) => [w.sku, w]));
    const used = new Set();
    const pairs = [];

    for (const [skuA, skuB] of CONFIRMED_PAIRS) {
      const wa = bySku.get(skuA);
      const wb = bySku.get(skuB);
      if (!wa || !wb || used.has(wa.id) || used.has(wb.id)) continue;
      if (wa.side === wb.side) { console.warn(`  ข้ามคู่ที่ยืนยัน ${skuA} / ${skuB}: ข้างซ้ำกัน`); continue; }
      pairs.push(wa.side === 'left' ? [wa, wb] : [wb, wa]);
      used.add(wa.id); used.add(wb.id);
    }
    for (const w of wings) {
      if (used.has(w.id) || !['left', 'right'].includes(w.side)) continue;
      const opposite = w.side === 'left' ? 'right' : 'left';
      const expectedName = swapThaiSide(w.name, w.side);
      const sibling = wings.find((o) =>
        o.id !== w.id && !used.has(o.id) && o.side === opposite &&
        (o.position || null) === (w.position || null) && (o.axle || null) === (w.axle || null) &&
        o.name === expectedName);
      if (!sibling) continue;
      pairs.push(w.side === 'left' ? [w, sibling] : [sibling, w]);
      used.add(w.id); used.add(sibling.id);
    }

    // รอบที่ 3: ที่เหลือที่ยังไม่มีคู่ จับคู่เมื่อ "ชื่อหรือ SKU ที่ตัดคำบอกข้างแล้ว" ตรงกัน
    // ตำแหน่ง+เพลาเท่ากัน ข้างตรงข้ามกัน และมีตัวเลือกเดียวเท่านั้น (ถ้ามีหลายตัวที่ตรง
    // ไม่เดา ปล่อยเป็นรายการเดี่ยวให้ตรวจเอง)
    const sameSlot = (a, b) =>
      (a.position || null) === (b.position || null) && (a.axle || null) === (b.axle || null);
    const looksSame = (a, b) =>
      normalizeName(a.name) === normalizeName(b.name) ||
      (normalizeSku(a.sku).length >= 4 && normalizeSku(a.sku) === normalizeSku(b.sku));
    const leftovers = () => wings.filter((w) => !used.has(w.id) && ['left', 'right'].includes(w.side));
    const candidatesFor = (w) => leftovers().filter((o) =>
      o.id !== w.id && o.side !== w.side && sameSlot(o, w) && looksSame(o, w));
    for (const w of leftovers()) {
      if (used.has(w.id)) continue;
      const candidates = candidatesFor(w);
      if (candidates.length !== 1) continue;
      const other = candidates[0];
      if (candidatesFor(other).length !== 1) continue;
      pairs.push(w.side === 'left' ? [w, other] : [other, w]);
      used.add(w.id); used.add(other.id);
    }

    for (const [left, right] of pairs) {
      const id = await insertItem({
        categoryId: wingCat.id, oem: left.sku, codes: { left: left.sku, right: right.sku }, description: left.name,
        hasSides: true, qty: left.stock_qty + right.stock_qty,
        positions: { left: left.stock_qty, right: right.stock_qty },
        minStock: Math.max(left.min_stock, right.min_stock),
      });
      if (!id) { report.wingSkipped += 2; continue; }
      report.pairsNew += 1;
      await copyFitments(id, wingFit.filter((f) => f.wing_arm_id === left.id || f.wing_arm_id === right.id));
    }

    // จับคู่ไม่ได้ → รายการเดี่ยว: มีข้างชัดเจน (ซ้าย/ขวาอย่างเดียว) เก็บเป็นของแยกข้างโดยอีกข้าง = 0
    // ชื่อที่มีทั้ง "ซ้าย" และ "ขวา" ในตัวเดียว = ชิ้นเดียวใช้ได้สองข้าง → ไม่แยกข้าง
    for (const w of wings) {
      if (used.has(w.id)) continue;
      const bothInName = w.name.includes('ซ้าย') && w.name.includes('ขวา');
      const sided = !bothInName && ['left', 'right'].includes(w.side);
      const id = await insertItem({
        categoryId: wingCat.id, oem: w.sku, codes: { left: sided && w.side === 'left' ? w.sku : null, right: sided && w.side === 'right' ? w.sku : null }, description: w.name, hasSides: sided,
        qty: w.stock_qty,
        positions: { left: sided && w.side === 'left' ? w.stock_qty : 0, right: sided && w.side === 'right' ? w.stock_qty : 0 },
        minStock: w.min_stock,
      });
      if (!id) { report.wingSkipped += 1; continue; }
      report.singlesNew += 1;
      singles.push(`${w.sku} | ${w.name} | ${sided ? `แยกข้าง (${w.side}) อีกข้าง = 0` : 'ไม่แยกข้าง'}`);
      await copyFitments(id, wingFit.filter((f) => f.wing_arm_id === w.id));
    }

    // ── ตรวจก่อนบันทึก ──
    const [[rackSum]] = await conn.query('SELECT COALESCE(SUM(stock_qty),0) s FROM racks');
    const [[wingSum]] = await conn.query('SELECT COALESCE(SUM(stock_qty),0) s FROM wing_arms');
    const [[newRack]] = await conn.query('SELECT COALESCE(SUM(stock_qty),0) s FROM stock_items WHERE category_id = ?', [rackCat.id]);
    const [[newWing]] = await conn.query('SELECT COALESCE(SUM(stock_qty),0) s FROM stock_items WHERE category_id = ?', [wingCat.id]);
    const [[badSum]] = await conn.query(
      `SELECT COUNT(*) c FROM stock_items i
       WHERE i.has_sides = 1 AND i.stock_qty <> (SELECT COALESCE(SUM(p.qty), 0) FROM stock_item_positions p WHERE p.item_id = i.id)`);
    if (badSum.c > 0) throw new Error('ยอดรวมไม่เท่ากับผลรวมทุกตำแหน่ง — ยกเลิก');
    // ถ้าไม่เคยมีรายการถูกข้ามไปก่อน (รันครั้งแรก) ผลรวมต้องเท่าของเดิมเป๊ะ
    const firstRun = report.racksSkipped === 0 && report.wingSkipped === 0;
    if (firstRun && (Number(newRack.s) !== Number(rackSum.s) || Number(newWing.s) !== Number(wingSum.s))) {
      throw new Error(`ผลรวมสต๊อกไม่ตรงของเดิม (แร็ค ${newRack.s}/${rackSum.s}, ปีกนก ${newWing.s}/${wingSum.s}) — ยกเลิก`);
    }

    console.log('--- ผลการย้าย ---');
    console.log(`แร็ค: เพิ่ม ${report.racksNew} / ข้าม(มีแล้ว) ${report.racksSkipped}  (ของเดิม ${racks.length} แถว, ยอดรวมเดิม ${rackSum.s} → ใหม่ ${newRack.s})`);
    console.log(`ปีกนก: คู่ซ้าย-ขวา ${report.pairsNew} รายการ + รายการเดี่ยว ${report.singlesNew} / ข้าม ${report.wingSkipped}  (ของเดิม ${wingRaw.length} แถว, ยอดรวมเดิม ${wingSum.s} → ใหม่ ${newWing.s})`);
    console.log(`รุ่นรถ/ปีที่คัดลอก: ${report.fitments} แถว`);
    if (singles.length) {
      console.log('รายการเดี่ยวที่จับคู่ซ้าย-ขวาไม่ได้ (ตรวจดูด้วย):');
      singles.forEach((s) => console.log(`   - ${s}`));
    }

    if (APPLY) {
      await conn.commit();
      console.log('\nบันทึกแล้ว (COMMIT)');
    } else {
      await conn.rollback();
      console.log('\nนี่คือตัวอย่างเท่านั้น (DRY-RUN) — ไม่ได้บันทึกอะไร  ใส่ --apply เพื่อบันทึกจริง');
    }
  } catch (err) {
    await conn.rollback();
    console.error('\n!! ล้มเหลว — rollback ทั้งหมด ไม่มีอะไรถูกบันทึก:', err.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main();
