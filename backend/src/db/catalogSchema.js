// Shared parts catalogue ("สมุดกลาง"): one master book of parts and prices for every shop, edited only by
// the platform administrator (role dev).
//
// - catalog_parts: the master list (brand, model, part, price). Not shop-owned, so no shop_id.
// - quote_part_prices (per shop) becomes the layer *on top of* the master book. A row there is either
//     * a part only this shop has (no master row with the same brand + model + part_name), or
//     * an adjustment of a master part: own_price = 1 → the shop's own price / description win,
//       own_price = 0 → the row only carries a picture (price comes from the master), or
//       is_active = 0 → the shop hid that master part.
//   Rows are matched to master parts by brand + model + part_name (no foreign key, so renaming a model
//   has to rename both sides in one transaction — see devCatalog.routes.js).
// - vehicle_models gets a review status: a model typed in by shop staff is 'pending' (visible to that shop
//   only) until the administrator approves it, merges it into an existing model or rejects it.
//
// Idempotent: safe to run on every start. The one-off seeding runs only when catalog_parts is created.

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

async function addColumn(conn, table, column, definition) {
  if (await columnExists(conn, table, column)) return;
  await conn.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// Seed the master book from shop 1 (Champpower SPK keeps the book it already built). A shop-1 row that is
// identical to its master row is dropped (the shop now inherits it, so later master edits reach it);
// rows carrying a picture stay as thin rows (own_price = 0) so the picture is not lost.
async function seedFromShopOne(conn) {
  await conn.beginTransaction();
  try {
    const [seeded] = await conn.query(
      `INSERT IGNORE INTO catalog_parts (brand, model, part_name, category, description, price, needs_price, is_active)
       SELECT brand, model, part_name, category, description, price, needs_price, is_active
       FROM quote_part_prices WHERE shop_id = 1`
    );
    await conn.query('UPDATE quote_part_prices SET own_price = 0 WHERE shop_id = 1 AND image_data IS NOT NULL');
    const [removed] = await conn.query(
      `DELETE q FROM quote_part_prices q
       JOIN catalog_parts c ON c.brand = q.brand AND c.model = q.model AND c.part_name = q.part_name
       WHERE q.shop_id = 1 AND q.image_data IS NULL
         AND q.price = c.price AND q.needs_price = c.needs_price AND q.is_active = c.is_active
         AND q.description <=> c.description AND q.category <=> c.category`
    );
    const [[left]] = await conn.query(
      `SELECT COUNT(*) AS n FROM quote_part_prices q
       LEFT JOIN catalog_parts c ON c.brand = q.brand AND c.model = q.model AND c.part_name = q.part_name
       WHERE q.shop_id = 1 AND c.id IS NULL`
    );
    // every shop-1 row must now be reachable through the master book, otherwise nothing is committed
    if (left.n > 0) throw new Error(`catalog seed would orphan ${left.n} rows`);
    await conn.commit();
    console.log(`[catalog] master book seeded from shop 1: ${seeded.affectedRows} parts, ${removed.affectedRows} shop rows now inherited`);
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}

async function migrateCatalog(conn) {
  const existed = await tableExists(conn, 'catalog_parts');
  await conn.query(`
    CREATE TABLE IF NOT EXISTS catalog_parts (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      brand VARCHAR(100) NOT NULL,
      model VARCHAR(100) NOT NULL,
      part_name VARCHAR(255) NOT NULL,
      category VARCHAR(150) DEFAULT NULL,
      description VARCHAR(500) DEFAULT NULL,
      price DECIMAL(10,2) NOT NULL DEFAULT 0,
      needs_price TINYINT(1) NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_catalog_part (brand, model, part_name),
      INDEX idx_catalog_part_name (part_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumn(conn, 'vehicle_models', 'status', "VARCHAR(10) NOT NULL DEFAULT 'approved'");
  await addColumn(conn, 'vehicle_models', 'submitted_shop_id', 'INT DEFAULT NULL');
  await addColumn(conn, 'vehicle_models', 'submitted_by', 'VARCHAR(100) DEFAULT NULL');
  await addColumn(conn, 'vehicle_models', 'submitted_at', 'DATETIME DEFAULT NULL');
  if (!(await indexExists(conn, 'vehicle_models', 'idx_vehicle_model_status'))) {
    await conn.query('ALTER TABLE vehicle_models ADD INDEX idx_vehicle_model_status (status, submitted_shop_id)');
  }

  await addColumn(conn, 'quote_part_prices', 'own_price', 'TINYINT(1) NOT NULL DEFAULT 1');

  if (!existed) await seedFromShopOne(conn);
}

async function indexExists(conn, table, index) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
    [table, index]
  );
  return rows.length > 0;
}

module.exports = { migrateCatalog };
