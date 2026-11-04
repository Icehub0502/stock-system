// Clean the vehicle model book (November 2026), following backend/data/vehicle_model_cleanup.json:
//   1. pickups: every generation becomes one entry per body / drive type ("Hilux Revo G1 ตัวเตี้ย 2WD"), because parts
//      differ between them. The standard prices and remembered prices of the old entry are copied to each new entry.
//      A car linked to the old entry loses the link: staff pick the type once when the car comes back.
//   2. renames: generations get a clear name ("MUX (เจน 1)" → "MUX G1"). Uses rename_vehicle_models.js, so cars whose
//      text is the old name of one generation follow.
//   3. moves: an entry that repeats a generation hands its prices and linked cars to that generation.
//   4. every entry without a year range is retired, and a car still linked to one loses the link.
//
//   node scripts/clean_vehicle_models.js            dry run: does everything inside a transaction, prints the real
//                                                   counts, then rolls back (nothing is written)
//   node scripts/clean_vehicle_models.js --apply    the same, committed
//
// Quotations and receipts keep the name printed on them, cars keep their typed text. Nothing is deleted: a retired entry
// keeps its prices, so it can be restored by hand. Safe to run again: what is already done is skipped.
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { runPlan: runRenames } = require('./rename_vehicle_models');

const PLAN_PATH = path.join(__dirname, '..', 'data', 'vehicle_model_cleanup.json');

const NO_YEAR = "(year_range IS NULL OR year_range = '')";

async function findModel(conn, brand, model, yearRange) {
  const [[row]] = await conn.query(
    "SELECT id FROM vehicle_models WHERE brand = ? AND model = ? AND year_range <=> ? AND status = 'approved'",
    [brand, model, yearRange ?? null]
  );
  return row ? row.id : null;
}

// INSERT IGNORE: a price the target already has wins over the copied one
async function copyPrices(conn, fromId, toId) {
  const [prices] = await conn.query(
    `INSERT IGNORE INTO model_item_prices (group_id, vehicle_model_id, item_key, item_name, part_price, labor_price, is_set, is_active, updated_by)
     SELECT group_id, ?, item_key, item_name, part_price, labor_price, is_set, is_active, updated_by
     FROM model_item_prices WHERE vehicle_model_id = ?`,
    [toId, fromId]
  );
  const [observations] = await conn.query(
    `INSERT INTO price_observations (group_id, shop_id, vehicle_model_id, item_key, item_name, unit_price, source, source_id, created_at)
     SELECT group_id, shop_id, ?, item_key, item_name, unit_price, source, source_id, created_at
     FROM price_observations WHERE vehicle_model_id = ?`,
    [toId, fromId]
  );
  return prices.affectedRows + observations.affectedRows;
}

// Run the plan on `conn` (already in a transaction). Returns counts and messages; throws on any SQL error.
async function runPlan(conn, plan) {
  const stats = {
    pickupEntries: 0, pickupRetired: 0, pricesCopied: 0, carsUnlinked: 0, moved: 0, carsMoved: 0, noYearRetired: 0, renamed: 0, carsRenamed: 0,
  };
  const notes = [];

  for (const g of plan.pickups) {
    const newIds = [];
    for (const variant of g.variants) {
      const model = `${g.model} ${variant}`;
      let id = await findModel(conn, g.brand, model, g.year_range);
      if (!id) {
        const [created] = await conn.query(
          "INSERT INTO vehicle_models (brand, model, year_range, status) VALUES (?, ?, ?, 'approved')",
          [g.brand, model, g.year_range]
        );
        id = created.insertId;
        stats.pickupEntries += 1;
      }
      newIds.push(id);
    }
    for (const old of g.replaces || []) {
      const oldId = await findModel(conn, g.brand, old.model, old.year_range);
      if (!oldId) {
        notes.push(`skip (not an approved entry, maybe already done): ${g.brand} ${old.model} ${old.year_range}`);
        continue;
      }
      for (const newId of newIds) stats.pricesCopied += await copyPrices(conn, oldId, newId);
      // tenant-ok: a catalogue change for every shop; the car's body type is not known, so staff choose again
      const [cars] = await conn.query('UPDATE vehicles SET vehicle_model_id = NULL WHERE vehicle_model_id = ?', [oldId]);
      stats.carsUnlinked += cars.affectedRows;
      await conn.query("UPDATE vehicle_models SET status = 'retired' WHERE id = ?", [oldId]);
      stats.pickupRetired += 1;
    }
  }

  const renames = await runRenames(conn, plan.renames || []);
  stats.renamed = renames.stats.renamed;
  stats.carsRenamed = renames.stats.carsRenamed;
  notes.push(...renames.notes);

  for (const m of plan.moves || []) {
    const fromId = await findModel(conn, m.brand, m.model, m.year_range);
    const toId = await findModel(conn, m.brand, m.to_model, m.to_year_range);
    if (!fromId) {
      notes.push(`skip move (not an approved entry): ${m.brand} ${m.model}`);
      continue;
    }
    if (!toId) {
      notes.push(`skip move (target not found, entry is only retired if it has no year): ${m.brand} ${m.model} -> ${m.to_model}`);
      continue;
    }
    stats.pricesCopied += await copyPrices(conn, fromId, toId);
    // tenant-ok: a catalogue change for every shop; each car follows the generation it was linked to
    const [cars] = await conn.query('UPDATE vehicles SET vehicle_model_id = ? WHERE vehicle_model_id = ?', [toId, fromId]);
    stats.carsMoved += cars.affectedRows;
    await conn.query("UPDATE vehicle_models SET status = 'retired' WHERE id = ?", [fromId]);
    stats.moved += 1;
  }

  // tenant-ok: a catalogue change for every shop; these cars are matched again when staff pick a generation
  const [unlinked] = await conn.query(
    `UPDATE vehicles SET vehicle_model_id = NULL WHERE vehicle_model_id IN
       (SELECT id FROM vehicle_models WHERE ${NO_YEAR} AND status IN ('approved', 'pending'))`
  );
  stats.carsUnlinked += unlinked.affectedRows;
  const [retired] = await conn.query(
    `UPDATE vehicle_models SET status = 'retired' WHERE ${NO_YEAR} AND status IN ('approved', 'pending')`
  );
  stats.noYearRetired = retired.affectedRows;
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
        "INSERT INTO dev_audit_log (username, action, detail) VALUES ('script', 'catalog_clean_models', ?)",
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
    console.error('Cleanup error:', err.message);
    process.exit(1);
  });
}

module.exports = { runPlan };
