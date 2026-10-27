// SaaS phase 1: shop (tenant) structure in the database.
//
// - shops table; shop 1 = the existing shop (Champpower SPK), so every existing row belongs to it
// - shop_id column on every table that owns shop data (DEFAULT 1, so code that does not know about
//   shops yet keeps working exactly as before — phase 2 makes the code filter by the logged-in shop)
// - "unique" values (document numbers, customer code, username ...) become unique *per shop*
//
// Idempotent: safe to run on every start (called at the end of init.js). Nothing is dropped except the
// old single-column UNIQUE indexes, which are replaced by (shop_id, column) ones in the same ALTER.
// Child tables (items, photos, positions ...) have no shop_id: they are always reached through their
// parent row. Legacy rack / wing-arm tables are frozen and also left alone.

const DEFAULT_SHOP = { id: 1, code: 'champpower', name: 'แชมป์พาวเวอร์ SPK' };

// every table that owns its own shop data
const SHOP_TABLES = [
  'users', 'receipt_sessions', 'customers', 'quotations', 'products', 'vehicles', 'warranties',
  'service_items', 'receipts', 'repair_notices', 'claims', 'quote_part_prices', 'app_settings', 'jobs',
  'technicians', 'decline_reasons', 'suppliers', 'parts', 'part_codes', 'stock_ledger', 'stock_counts',
  'stock_categories', 'stock_items',
];

// single/multi-column UNIQUE constraints that must become per-shop
const UNIQUE_SPECS = [
  ['users', ['username']],
  ['customers', ['customer_code']],
  ['quotations', ['quotation_no']],
  ['receipts', ['receipt_no']],
  ['receipts', ['car_sequence_no']],
  ['claims', ['claim_no']],
  ['jobs', ['job_no']],
  ['technicians', ['name']],
  ['decline_reasons', ['label']],
  ['parts', ['part_code']],
  ['part_codes', ['code']],
  ['stock_categories', ['name']],
  ['repair_notices', ['code']],
  ['quote_part_prices', ['brand', 'model', 'part_name']],
];

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [table]
  );
  return rows.length > 0;
}

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column]
  );
  return rows.length > 0;
}

// unique indexes of a table → [{ name, cols: ['a','b'] }] (PRIMARY excluded)
async function uniqueIndexes(conn, table) {
  const [rows] = await conn.query(
    `SELECT INDEX_NAME AS name, COLUMN_NAME AS col, SEQ_IN_INDEX AS seq
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY'
     ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    [table]
  );
  const byName = new Map();
  for (const r of rows) {
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name).push(r.col);
  }
  return [...byName.entries()].map(([name, cols]) => ({ name, cols }));
}

async function primaryKeyColumns(conn, table) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME AS col FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = 'PRIMARY' ORDER BY SEQ_IN_INDEX`,
    [table]
  );
  return rows.map((r) => r.col);
}

async function migrateTenants(conn) {
  const log = [];

  await conn.query(`
    CREATE TABLE IF NOT EXISTS shops (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(30) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      status ENUM('active','suspended') NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await conn.query(
    'INSERT IGNORE INTO shops (id, code, name) VALUES (?, ?, ?)',
    [DEFAULT_SHOP.id, DEFAULT_SHOP.code, DEFAULT_SHOP.name]
  );

  // 1) shop_id on every shop-owned table
  for (const table of SHOP_TABLES) {
    if (!(await tableExists(conn, table))) continue;
    if (await columnExists(conn, table, 'shop_id')) continue;
    await conn.query(
      `ALTER TABLE \`${table}\`
         ADD COLUMN shop_id INT NOT NULL DEFAULT ${DEFAULT_SHOP.id},
         ADD INDEX idx_${table}_shop (shop_id),
         ADD CONSTRAINT fk_${table}_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE RESTRICT`
    );
    log.push(`shop_id added to ${table}`);
  }

  // 2) UNIQUE (col) → UNIQUE (shop_id, col)
  for (const [table, cols] of UNIQUE_SPECS) {
    if (!(await tableExists(conn, table))) continue;
    const indexes = await uniqueIndexes(conn, table);
    const already = indexes.find((i) => i.cols[0] === 'shop_id' && i.cols.slice(1).join(',') === cols.join(','));
    if (already) continue;
    const old = indexes.find((i) => i.cols.join(',') === cols.join(','));
    if (!old) {
      console.warn(`[tenant] ${table}(${cols.join(',')}) has no UNIQUE index to convert — skipped`);
      continue;
    }
    const newName = `uq_${table}_shop_${cols.join('_')}`.slice(0, 64);
    const colList = ['shop_id', ...cols].map((c) => `\`${c}\``).join(', ');
    await conn.query(
      `ALTER TABLE \`${table}\` DROP INDEX \`${old.name}\`, ADD UNIQUE KEY \`${newName}\` (${colList})`
    );
    log.push(`${table}.${cols.join('+')} is now unique per shop`);
  }

  // 3) app_settings: PRIMARY KEY (key) → (shop_id, key)
  if (await tableExists(conn, 'app_settings')) {
    const pk = await primaryKeyColumns(conn, 'app_settings');
    if (pk.join(',') === 'key') {
      await conn.query('ALTER TABLE app_settings DROP PRIMARY KEY, ADD PRIMARY KEY (shop_id, `key`)');
      log.push('app_settings key is now per shop');
    }
  }

  if (log.length > 0) console.log(`[tenant] ${log.join('; ')}`);
}

module.exports = { migrateTenants, SHOP_TABLES, UNIQUE_SPECS, DEFAULT_SHOP };
