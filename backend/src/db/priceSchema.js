// Standard prices per vehicle generation ("ราคามาตรฐานตามรุ่นรถ"), replacing the old parts-by-model catalogue.
//
// - model_item_prices: the price of one item (a rack, a suspension promo set, a shock ...) for one vehicle
//   generation (vehicle_models row), owned by a *branch group* (shop_groups): every branch of the same owner
//   sees the same prices, other owners never do. Items are matched by name (item_key = the normalised name),
//   because service_items are per shop and have different ids in every branch.
//   part_price is what the item is sold for (usually labour included); labor_price is only set for items whose
//   labour is billed on its own line. is_set marks a promo set, whose part_price is the price of the whole set.
//   Rows are never deleted: removing a price sets is_active = 0.
// - price_observations: every price staff typed on a saved quotation (car generation + item + price), so the
//   manager can see which prices have settled and promote them to standard prices.
// - vehicles.vehicle_model_id: the generation of a customer's car once it has been chosen, so the staff are asked
//   only once per car.
// The old catalog_parts / quote_part_prices tables stay in the database untouched (archived, no screen reads them).
//
// Idempotent: safe to run on every start.

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column]
  );
  return rows.length > 0;
}

async function migratePrices(conn) {
  if (!(await columnExists(conn, 'vehicles', 'vehicle_model_id'))) {
    await conn.query('ALTER TABLE vehicles ADD COLUMN vehicle_model_id BIGINT UNSIGNED DEFAULT NULL, ADD INDEX idx_vehicles_model (vehicle_model_id)');
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS model_item_prices (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      group_id INT NOT NULL,
      vehicle_model_id BIGINT UNSIGNED NOT NULL,
      item_key VARCHAR(255) NOT NULL,
      item_name VARCHAR(255) NOT NULL,
      part_price DECIMAL(12,2) NOT NULL,
      labor_price DECIMAL(12,2) DEFAULT NULL,
      is_set TINYINT(1) NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      updated_by VARCHAR(100) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_model_item_price (group_id, vehicle_model_id, item_key),
      INDEX idx_model_item_price_model (group_id, vehicle_model_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS price_observations (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      group_id INT NOT NULL,
      shop_id INT NOT NULL,
      vehicle_model_id BIGINT UNSIGNED NOT NULL,
      item_key VARCHAR(255) NOT NULL,
      item_name VARCHAR(255) NOT NULL,
      unit_price DECIMAL(12,2) NOT NULL,
      source VARCHAR(20) NOT NULL DEFAULT 'quotation',
      source_id BIGINT UNSIGNED DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_price_obs_item (group_id, vehicle_model_id, item_key, id),
      INDEX idx_price_obs_source (source, source_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

module.exports = { migratePrices };
