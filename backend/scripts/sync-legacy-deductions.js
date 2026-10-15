// ซิงก์การตัดสต๊อก/รับเข้าที่เกิดขึ้นในระบบเก่า (ตาราง transactions ของ racks/wing_arms) "หลังวันที่ย้าย
// ข้อมูลเข้าสต๊อกรวม" เข้ามาที่สต๊อกรวมให้ยอดตรงกัน
//
// ปัญหา: หลังย้ายสต๊อกเก่าเข้าสต๊อกรวม (scripts/migrate-stock-all.js) หน้าตัดสต๊อก/จ่ายออกยังตัดจากตาราง
// เก่าอยู่ สต๊อกรวมเลยไม่ลดตาม สคริปต์นี้เอารายการเก่าหลังวันย้ายมาลง/หักในสต๊อกรวม:
//   - OUT (ตัดสต๊อก) → ตัดยอดในสต๊อกรวม ลงประวัติ 'deduct' ด้วยวันที่เดิม (moved_at) รุ่นรถเดิม → ขึ้นหน้า
//     "ประวัติการตัดสต๊อก" ตรงวัน
//   - IN (รับเข้าผ่านระบบเก่า เช่นหน้าเว็บค้างเวอร์ชันเก่า) → บวกยอด ลงประวัติ 'adjust'
// จับคู่รายการเก่ากับสต๊อกรวมด้วยรหัส: แร็ค model_code → หมวด "แร็ค", ปีกนก sku → รหัสของตำแหน่ง
// (ซ้าย/ขวา) ในหมวด "ปีกนก" ยอดไม่ติดลบ (ถ้าหักแล้วต่ำกว่า 0 ตั้งเป็น 0 และรายงานเตือน)
//
// รันซ้ำได้ปลอดภัย: ทุกรายการเก่าที่ซิงก์แล้วถูกจำไว้ (stock_item_movements.legacy_tx_id UNIQUE) ไม่ซิงก์ซ้ำ
// ทำทั้งหมดในทรานแซกชันเดียว พังตรงไหน rollback หมด
//
// ใช้:  node scripts/sync-legacy-deductions.js                 ← ดูตัวอย่าง (ไม่บันทึกอะไร)
//       node scripts/sync-legacy-deductions.js --apply         ← บันทึกจริง
//       node scripts/sync-legacy-deductions.js --since-id=1234 ← กำหนดเลข transaction ที่เริ่มซิงก์เอง
//                                                                (ปกติหาให้เองจากเวลาที่ย้ายข้อมูล)
//
// หมายเหตุ: ซิงก์ได้เฉพาะรายการที่มีใน transactions — การแก้ยอดแร็ค/ปีกนกตรง ๆ ในหน้าเก่า (ไม่ผ่าน
// รายการรับ-จ่าย) ไม่มีประวัติให้ซิงก์ ส่วนต่างแบบนั้นจะโผล่ในรายงาน "ตรวจความตรงกัน" ท้ายสคริปต์
require('dotenv').config();
const pool = require('../src/db/pool');

const MIGRATION_NOTE = 'ย้ายจากระบบสต๊อกเดิม';
const MAX_QTY = 1000000;

async function findTarget(conn, t) {
  // คืน { itemId, position, category } หรือ null
  if (t.rack_id) {
    if (!t.rack_code) return null;
    const [[row]] = await conn.execute(
      `SELECT i.id FROM stock_items i JOIN stock_categories c ON c.id = i.category_id
       WHERE c.name = 'แร็ค' AND i.oem_code = ? AND i.is_active = 1 LIMIT 1`,
      [t.rack_code]
    );
    return row ? { itemId: row.id, position: null } : null;
  }
  if (t.wing_arm_id) {
    if (!t.wing_sku) return null;
    const [[pos]] = await conn.execute(
      `SELECT p.item_id, p.position FROM stock_item_positions p
       JOIN stock_items i ON i.id = p.item_id JOIN stock_categories c ON c.id = i.category_id
       WHERE c.name = 'ปีกนก' AND p.oem_code = ? AND i.is_active = 1 LIMIT 1`,
      [t.wing_sku]
    );
    if (pos) return { itemId: pos.item_id, position: pos.position };
    const [[single]] = await conn.execute(
      `SELECT i.id FROM stock_items i JOIN stock_categories c ON c.id = i.category_id
       WHERE c.name = 'ปีกนก' AND i.oem_code = ? AND i.is_active = 1
         AND NOT EXISTS (SELECT 1 FROM stock_item_positions p WHERE p.item_id = i.id) LIMIT 1`,
      [t.wing_sku]
    );
    return single ? { itemId: single.id, position: null } : null;
  }
  return null;
}

async function syncLegacy({ apply = false, sinceId = null, migratedAt = null } = {}) {
  const conn = await pool.getConnection();
  const report = { migratedAt: null, sinceId: null, boundaryRows: [], candidates: [], notFound: [], clamped: [], residuals: [], applied: false };
  try {
    await conn.beginTransaction();

    // ── เวลาที่ย้ายข้อมูลเข้าสต๊อกรวม ──
    let T = migratedAt;
    if (!T) {
      const [[m]] = await conn.query('SELECT MIN(created_at) AS t FROM stock_item_movements WHERE note = ?', [MIGRATION_NOTE]);
      T = m && m.t ? m.t : null;
    }
    if (!T) throw new Error('ไม่พบร่องรอยการย้ายข้อมูลเข้าสต๊อกรวม (ยังไม่เคยรัน migrate-stock-all.js?)');
    report.migratedAt = String(T);

    // ── รายการเก่าที่ต้องซิงก์: id ของ transactions ที่เกิดหลังวันย้าย ──
    // ใช้ "เลข id" ไม่ใช่เวลา เพราะหน้าตัดสต๊อกเลือกวันย้อนหลังได้ (created_at ถูกตั้งเป็นวันในอดีต แต่ id
    // เรียงตามเวลาที่กดจริง) — เลข id เริ่มต้น = ก่อนแถวแรกที่ created_at เกินเวลาย้าย
    let boundary = sinceId;
    if (boundary === null || boundary === undefined) {
      const [[first]] = await conn.query('SELECT MIN(id) AS id FROM transactions WHERE created_at > ?', [T]);
      boundary = first && first.id ? Number(first.id) - 1 : null;
    }
    report.sinceId = boundary;
    if (boundary === null) {
      await conn.rollback();
      return report;
    }
    const [around] = await conn.query(
      'SELECT id, type, qty, created_at FROM transactions WHERE id BETWEEN ? AND ? ORDER BY id',
      [boundary - 2, boundary + 3]
    );
    report.boundaryRows = around.map((r) => ({ id: r.id, type: r.type, qty: r.qty, created_at: String(r.created_at) }));

    const [txs] = await conn.query(
      `SELECT t.id, t.type, t.qty, t.note, t.vehicle_model, t.user_id, t.created_at, t.rack_id, t.wing_arm_id,
              r.model_code AS rack_code, w.sku AS wing_sku
       FROM transactions t
       LEFT JOIN racks r ON r.id = t.rack_id
       LEFT JOIN wing_arms w ON w.id = t.wing_arm_id
       WHERE t.id > ? AND (t.rack_id IS NOT NULL OR t.wing_arm_id IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM stock_item_movements m WHERE m.legacy_tx_id = t.id)
       ORDER BY t.id`,
      [boundary]
    );

    const touchedItems = new Set();
    for (const t of txs) {
      const code = t.rack_id ? t.rack_code : t.wing_sku;
      const target = await findTarget(conn, t);
      const entry = { id: t.id, type: t.type, qty: t.qty, date: String(t.created_at), code, status: 'ok' };
      if (!target) {
        entry.status = 'notfound';
        report.notFound.push(entry);
        report.candidates.push(entry);
        continue;
      }
      const [[item]] = await conn.execute('SELECT id, description, stock_qty FROM stock_items WHERE id = ? FOR UPDATE', [target.itemId]);
      let before = item.stock_qty;
      if (target.position) {
        const [[row]] = await conn.execute(
          'SELECT qty FROM stock_item_positions WHERE item_id = ? AND position = ? FOR UPDATE',
          [target.itemId, target.position]
        );
        before = row ? row.qty : 0;
      }
      const delta = t.type === 'IN' ? Number(t.qty) : -Number(t.qty);
      let after = before + delta;
      if (after < 0) {
        entry.status = 'clamped';
        report.clamped.push({ ...entry, before, wanted: after });
        after = 0;
      }
      if (after > MAX_QTY) after = MAX_QTY;
      entry.before = before;
      entry.after = after;
      entry.name = item.description;

      let total = after;
      if (target.position) {
        await conn.execute('UPDATE stock_item_positions SET qty = ? WHERE item_id = ? AND position = ?', [after, target.itemId, target.position]);
        const [[sum]] = await conn.execute(
          'SELECT COALESCE(SUM(qty), 0) AS total FROM stock_item_positions WHERE item_id = ?',
          [target.itemId]
        );
        total = Number(sum.total);
      }
      await conn.execute('UPDATE stock_items SET stock_qty = ? WHERE id = ?', [total, target.itemId]);

      const note = `ซิงก์จากระบบเก่า (รายการ #${t.id})${t.note ? `: ${t.note}` : ''}`.slice(0, 255);
      if (t.type === 'OUT') {
        await conn.execute(
          `INSERT INTO stock_item_movements
             (item_id, qty_before, qty_after, reason, position, note, user_id, vehicle_model, moved_at, legacy_tx_id)
           VALUES (?, ?, ?, 'deduct', ?, ?, ?, ?, ?, ?)`,
          [target.itemId, before, after, target.position, note, t.user_id, t.vehicle_model || null, t.created_at, t.id]
        );
      } else {
        await conn.execute(
          `INSERT INTO stock_item_movements
             (item_id, qty_before, qty_after, reason, position, note, user_id, legacy_tx_id)
           VALUES (?, ?, ?, 'adjust', ?, ?, ?, ?)`,
          [target.itemId, before, after, target.position, note, t.user_id, t.id]
        );
      }
      touchedItems.add(target.itemId);
      report.candidates.push(entry);
    }

    // ── ตรวจความตรงกัน: สต๊อกรวม − สต๊อกเก่า ต้องเท่ากับ "การเปลี่ยนแปลงที่เกิดเฉพาะในสต๊อกรวม" ──
    // (รับเข้าผ่านหน้าใหม่ ปรับยอด ตัดสต๊อกผ่านหน้าใหม่ ฯลฯ) ถ้าไม่เท่า = มีการแก้ยอดสต๊อกเก่าตรง ๆ ที่ไม่มี
    // ประวัติ หรือรายการที่จับคู่ไม่ได้ — ต้องให้คนตรวจ
    const [oldRows] = await conn.query(
      `SELECT 'rack' AS kind, model_code AS code, stock_qty FROM racks
       UNION ALL SELECT 'wing_arm', sku, stock_qty FROM wing_arms`
    );
    for (const row of oldRows) {
      const t = row.kind === 'rack'
        ? { rack_id: 1, rack_code: row.code }
        : { wing_arm_id: 1, wing_sku: row.code };
      const target = await findTarget(conn, t);
      if (!target) continue;
      let current;
      if (target.position) {
        const [[p]] = await conn.execute('SELECT qty FROM stock_item_positions WHERE item_id = ? AND position = ?', [target.itemId, target.position]);
        current = p ? p.qty : 0;
      } else {
        const [[i]] = await conn.execute('SELECT stock_qty FROM stock_items WHERE id = ?', [target.itemId]);
        current = i.stock_qty;
      }
      const [[d]] = await conn.execute(
        `SELECT COALESCE(SUM(qty_after - qty_before), 0) AS delta FROM stock_item_movements
         WHERE item_id = ? AND position <=> ? AND created_at >= ? AND legacy_tx_id IS NULL
           AND (note IS NULL OR note <> ?)`,
        [target.itemId, target.position, T, MIGRATION_NOTE]
      );
      const residual = current - row.stock_qty - Number(d.delta);
      if (residual !== 0) {
        report.residuals.push({ code: row.code, old: row.stock_qty, combined: current, newOnlyChange: Number(d.delta), diff: residual });
      }
    }

    if (apply) {
      await conn.commit();
      report.applied = true;
    } else {
      await conn.rollback();
    }
    return report;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

function printReport(r) {
  console.log(`เวลาที่ย้ายข้อมูลเข้าสต๊อกรวม: ${r.migratedAt}`);
  if (r.sinceId === null) {
    console.log('ไม่มีรายการรับ-จ่ายในระบบเก่าหลังวันย้ายเลย — ไม่มีอะไรต้องซิงก์');
    return;
  }
  console.log(`ซิงก์เฉพาะรายการเก่าที่เลข (id) มากกว่า ${r.sinceId}  (ถ้าไม่ใช่จุดที่ถูกต้อง ให้ใส่ --since-id=เลข)`);
  console.log('รายการรอบจุดเริ่ม (id | ชนิด | จำนวน | วันที่):');
  r.boundaryRows.forEach((b) => console.log(`   ${b.id > r.sinceId ? '→' : ' '} ${b.id} | ${b.type} | ${b.qty} | ${b.created_at}`));

  const outs = r.candidates.filter((c) => c.type === 'OUT').length;
  const ins = r.candidates.filter((c) => c.type === 'IN').length;
  console.log(`\nรายการที่ซิงก์ ${r.candidates.length} รายการ (ตัดออก ${outs}, รับเข้า ${ins})`);
  r.candidates.slice(0, 80).forEach((c) => {
    const tail = c.status === 'notfound' ? '❌ ไม่พบในสต๊อกรวม' : `${c.before} → ${c.after}${c.status === 'clamped' ? ' ⚠️ ติดลบ ตั้งเป็น 0' : ''}`;
    console.log(`   #${c.id} ${c.type === 'OUT' ? 'ตัด ' : 'รับ '}${c.qty} ${c.code || '(ไม่มีรหัส)'}  ${c.date}  ${tail}`);
  });
  if (r.candidates.length > 80) console.log(`   ... และอีก ${r.candidates.length - 80} รายการ`);

  if (r.notFound.length) console.log(`\n❌ จับคู่กับสต๊อกรวมไม่ได้ ${r.notFound.length} รายการ (ไม่ได้ซิงก์ — ตรวจว่ารหัสนี้มีในสต๊อกรวมหรือถูกซ่อน/ลบไป)`);
  if (r.clamped.length) console.log(`⚠️ ยอดติดลบหลังหัก ${r.clamped.length} รายการ (ตั้งเป็น 0) — สต๊อกรวมมียอดน้อยกว่าที่ตัดจริง ควรนับของจริงแล้วแก้ยอด`);

  console.log(`\nตรวจความตรงกัน (สต๊อกรวม − สต๊อกเก่า เทียบกับการเปลี่ยนแปลงเฉพาะในสต๊อกรวม): ไม่ตรง ${r.residuals.length} รายการ`);
  r.residuals.slice(0, 40).forEach((x) => console.log(`   ${x.code}: เก่า ${x.old} | รวม ${x.combined} | เปลี่ยนเฉพาะในสต๊อกรวม ${x.newOnlyChange} | ส่วนต่างที่อธิบายไม่ได้ ${x.diff > 0 ? '+' : ''}${x.diff}`));
  if (r.residuals.length > 40) console.log(`   ... และอีก ${r.residuals.length - 40} รายการ`);
  console.log(r.applied ? '\nบันทึกแล้ว (COMMIT)' : '\nนี่คือตัวอย่างเท่านั้น (DRY-RUN) — ไม่ได้บันทึกอะไร ใส่ --apply เพื่อบันทึกจริง');
}

async function cli() {
  const apply = process.argv.includes('--apply');
  const sinceArg = process.argv.find((a) => a.startsWith('--since-id='));
  const sinceId = sinceArg ? Number(sinceArg.split('=')[1]) : null;
  if (sinceArg && !Number.isInteger(sinceId)) throw new Error('--since-id ต้องเป็นตัวเลข');
  try {
    printReport(await syncLegacy({ apply, sinceId }));
  } catch (err) {
    console.error('\n!! ล้มเหลว — rollback ทั้งหมด ไม่มีอะไรถูกบันทึก:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) cli();

module.exports = { syncLegacy, MIGRATION_NOTE };
