// Split catalogue entries that lump several generations together ("Camry 1993-ปัจจุบัน") into one entry per
// generation with its own year range, following backend/data/vehicle_model_splits.json.
//
//   node scripts/split_vehicle_models.js            dry run: does everything inside a transaction, prints the
//                                                   real counts, then rolls back (nothing is written)
//   node scripts/split_vehicle_models.js --apply    the same, committed
//
// For every old entry the script, in one transaction:
//   1. adds the new generations to vehicle_models (approved); one that already exists is reused
//   2. copies the old entry's master parts and prices (catalog_parts) to every new generation
//   3. copies every shop's own price rows of the old entry (own prices, hidden parts, pictures) the same way
//   4. retires the old entry: vehicle_models.status = 'retired' and its master parts / shop rows are hidden
//      (is_active = 0). Nothing is deleted, so it can be undone by hand if ever needed.
// Entries listed under "retire" (typed in by staff / test data, no year range, no parts) are only retired.
// Safe to run again: an old entry that is already retired is skipped, rows that exist are not duplicated.
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const PLAN_PATH = path.join(__dirname, '..', 'data', 'vehicle_model_splits.json');

const labelOf = (model, yearRange) => (yearRange ? `${model} (${yearRange})` : model);
const normalize = (value) => String(value || '').toLowerCase().replace(/[\s\-_./()]+/g, '');

// Run the plan on `conn` (already in a transaction). Returns counts and messages; throws on any SQL error.
async function runPlan(conn, plan) {
  const stats = { groups: 0, skipped: 0, newModels: 0, reusedModels: 0, masterRows: 0, shopRows: 0, retired: 0 };
  const notes = [];

  const groups = new Map();
  for (const s of plan.splits) {
    const key = `${s.brand}\u0000${s.old_model}\u0000${s.old_years}`;
    if (!groups.has(key)) groups.set(key, { brand: s.brand, oldModel: s.old_model, oldYears: s.old_years, items: [] });
    groups.get(key).items.push(s);
  }

  for (const g of groups.values()) {
    const oldLabel = labelOf(g.oldModel, g.oldYears);
    const [[old]] = await conn.query(
      "SELECT id FROM vehicle_models WHERE brand = ? AND model = ? AND year_range <=> ? AND status = 'approved'",
      [g.brand, g.oldModel, g.oldYears]
    );
    if (!old) {
      stats.skipped += 1;
      notes.push(`skip (not an approved entry, maybe already split): ${g.brand} ${oldLabel}`);
      continue;
    }
    stats.groups += 1;

    const [approved] = await conn.query("SELECT model, year_range FROM vehicle_models WHERE brand = ? AND status = 'approved'", [g.brand]);
    const known = new Set(approved.map((r) => normalize(labelOf(r.model, r.year_range))));
    const newLabels = [];
    for (const item of g.items) {
      const label = labelOf(item.model, item.year_range);
      newLabels.push(label);
      if (known.has(normalize(label))) {
        stats.reusedModels += 1;
        continue;
      }
      await conn.query(
        "INSERT INTO vehicle_models (brand, model, year_range, status) VALUES (?, ?, ?, 'approved')",
        [g.brand, item.model, item.year_range]
      );
      known.add(normalize(label));
      stats.newModels += 1;
    }

    const copyTargets = newLabels.filter((label) => label !== oldLabel);
    for (const label of copyTargets) {
      const [master] = await conn.query(
        `INSERT IGNORE INTO catalog_parts (brand, model, part_name, category, description, price, needs_price, is_active)
         SELECT brand, ?, part_name, category, description, price, needs_price, is_active
         FROM catalog_parts WHERE brand = ? AND model = ?`,
        [label, g.brand, oldLabel]
      );
      stats.masterRows += master.affectedRows;
      // tenant-ok: platform administrator script copies every shop's own price rows to the new generation
      const [shop] = await conn.query(
        `INSERT IGNORE INTO quote_part_prices
           (shop_id, brand, model, part_name, description, price, image_data, is_active, needs_price, category, own_price)
         SELECT shop_id, brand, ?, part_name, description, price, image_data, is_active, needs_price, category, own_price
         FROM quote_part_prices WHERE brand = ? AND model = ?`,
        [label, g.brand, oldLabel]
      );
      stats.shopRows += shop.affectedRows;
    }

    // keep the old entry when one of the new generations carries exactly its name (nothing to retire)
    if (newLabels.includes(oldLabel)) {
      notes.push(`kept (a new generation has the same label): ${g.brand} ${oldLabel}`);
      continue;
    }
    await conn.query("UPDATE vehicle_models SET status = 'retired' WHERE id = ?", [old.id]);
    await conn.query('UPDATE catalog_parts SET is_active = 0 WHERE brand = ? AND model = ?', [g.brand, oldLabel]);
    // tenant-ok: platform administrator script hides the retired entry in every shop's price rows
    await conn.query('UPDATE quote_part_prices SET is_active = 0 WHERE brand = ? AND model = ?', [g.brand, oldLabel]);
    stats.retired += 1;
  }

  for (const r of plan.retire || []) {
    const [[row]] = await conn.query(
      "SELECT id FROM vehicle_models WHERE brand = ? AND model = ? AND year_range IS NULL AND status = 'approved'",
      [r.brand, r.model]
    );
    if (!row) continue;
    const [[parts]] = await conn.query('SELECT COUNT(*) AS n FROM catalog_parts WHERE brand = ? AND model = ?', [r.brand, r.model]);
    if (parts.n > 0) {
      notes.push(`not retired (it has ${parts.n} master parts): ${r.brand} ${r.model}`);
      continue;
    }
    await conn.query("UPDATE vehicle_models SET status = 'retired' WHERE id = ?", [row.id]);
    stats.retired += 1;
  }
  return { stats, notes };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf8'));
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'champpower-stock2',
  });
  try {
    await conn.beginTransaction();
    const { stats, notes } = await runPlan(conn, plan);
    notes.forEach((n) => console.log(n));
    console.log(JSON.stringify(stats));
    if (apply) {
      await conn.query(
        "INSERT INTO dev_audit_log (username, action, detail) VALUES ('script', 'catalog_split_models', ?)",
        [JSON.stringify(stats)]
      );
      await conn.commit();
      console.log('APPLIED: committed');
    } else {
      await conn.rollback();
      console.log('DRY RUN: nothing was written (run again with --apply to save)');
    }
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Split error:', err);
    process.exit(1);
  });
}

module.exports = { runPlan };
