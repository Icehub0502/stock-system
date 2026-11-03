// Rename catalogue models to the shop's naming (November 2026), following backend/data/vehicle_model_renames.json:
//   - model codes written without the dash: "CR-V" → "CRV", "D-Max" → "DMAX"
//   - generations that share one model name get their generation: "CR-V" 2006-2011 → "CRV G3", "City" → "City GM6"
//
//   node scripts/rename_vehicle_models.js            dry run: does everything inside a transaction, prints the
//                                                    real counts, then rolls back (nothing is written)
//   node scripts/rename_vehicle_models.js --apply    the same, committed
//
// In one transaction:
//   1. renames the approved catalogue rows. Prices hang on vehicle_models.id, so they follow without any change.
//   2. customers' cars whose model text is the old name of one generation ("CR-V ปี '06-11'", "CR-V (2006-2011)",
//      or the old style of a model that was not renamed: "Vios ปี '02-07'") get the new display name
//      ("CRV G3 (ปี 2006-2011)") and are linked to that generation. Cars with any other text are left as typed.
// Quotations and receipts keep the name printed on them. Nothing is deleted. Safe to run again: a row that is
// already renamed is skipped.
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const { normalizeName } = require('../src/utils/normalizeName');
const { displayModelName, legacyDisplayModelName } = require('../src/utils/modelDisplay');

const PLAN_PATH = path.join(__dirname, '..', 'data', 'vehicle_model_renames.json');

const labelOf = (model, yearRange) => (yearRange ? `${model} (${yearRange})` : model);

// Run the plan on `conn` (already in a transaction). Returns counts and messages; throws on any SQL error.
async function runPlan(conn, plan) {
  const stats = { renamed: 0, alreadyDone: 0, skipped: 0, carsRenamed: 0, carsLinked: 0 };
  const notes = [];
  const oldNames = new Map(); // vehicle_models.id → the model name before this run

  for (const p of plan) {
    const [[row]] = await conn.query(
      "SELECT id FROM vehicle_models WHERE brand = ? AND model = ? AND year_range <=> ? AND status = 'approved'",
      [p.brand, p.model, p.year_range]
    );
    if (!row) {
      const [[done]] = await conn.query(
        "SELECT id FROM vehicle_models WHERE brand = ? AND model = ? AND year_range <=> ? AND status = 'approved'",
        [p.brand, p.new_model, p.year_range]
      );
      if (done) {
        stats.alreadyDone += 1;
        oldNames.set(done.id, p.model);
      } else {
        stats.skipped += 1;
        notes.push(`skip (not in the catalogue): ${p.brand} ${labelOf(p.model, p.year_range)}`);
      }
      continue;
    }
    const [same] = await conn.query(
      "SELECT model, year_range FROM vehicle_models WHERE brand = ? AND status = 'approved' AND id <> ?",
      [p.brand, row.id]
    );
    const wanted = normalizeName(labelOf(p.new_model, p.year_range));
    if (same.some((r) => normalizeName(labelOf(r.model, r.year_range)) === wanted)) {
      stats.skipped += 1;
      notes.push(`skip (the new name is taken): ${p.brand} ${labelOf(p.new_model, p.year_range)}`);
      continue;
    }
    await conn.query('UPDATE vehicle_models SET model = ? WHERE id = ?', [p.new_model, row.id]);
    oldNames.set(row.id, p.model);
    stats.renamed += 1;
  }

  // every name a car may carry for one generation → that generation (a name that fits two is left alone)
  const [models] = await conn.query("SELECT id, brand, model, year_range FROM vehicle_models WHERE status = 'approved' AND year_range IS NOT NULL");
  const byName = new Map();
  const add = (key, model) => {
    const hit = byName.get(key);
    byName.set(key, hit && hit.id !== model.id ? 'ambiguous' : model);
  };
  for (const m of models) {
    const brand = normalizeName(m.brand);
    for (const name of new Set([m.model, oldNames.get(m.id) || m.model])) {
      add(`${brand}|${normalizeName(legacyDisplayModelName(name, m.year_range))}`, m);
      add(`${brand}|${normalizeName(labelOf(name, m.year_range))}`, m);
    }
  }

  // tenant-ok: a catalogue rename for every shop; each car only follows its own generation
  const [cars] = await conn.query('SELECT id, brand, model, vehicle_model_id FROM vehicles WHERE model IS NOT NULL');
  for (const car of cars) {
    const model = byName.get(`${normalizeName(car.brand)}|${normalizeName(car.model)}`);
    if (!model || model === 'ambiguous') continue;
    if (car.vehicle_model_id && car.vehicle_model_id !== model.id) continue; // linked to another generation by staff
    const name = displayModelName(model.model, model.year_range);
    if (name === car.model && car.vehicle_model_id === model.id) continue;
    // tenant-ok: updated by the car's own id
    await conn.query('UPDATE vehicles SET model = ?, vehicle_model_id = ? WHERE id = ?', [name, model.id, car.id]);
    if (name !== car.model) stats.carsRenamed += 1;
    if (!car.vehicle_model_id) stats.carsLinked += 1;
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
        "INSERT INTO dev_audit_log (username, action, detail) VALUES ('script', 'catalog_rename_models', ?)",
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
    console.error('Rename error:', err.message);
    process.exit(1);
  });
}

module.exports = { runPlan };
