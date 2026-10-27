// Trash ("deleted records"): a full copy of every record deleted from the web app, kept so the
// platform administrator (role dev) can look at it and restore it. See utils/trash.js.
//
// - deleted_records: one row per deleted record. `snapshot` holds the record and everything the
//   database deleted with it (ON DELETE CASCADE children) as JSON; `side_effects` holds what has to
//   be put back on other rows (ON DELETE SET NULL links, quotation status after deleting a receipt)
// - platform_settings: key/value settings of the whole platform (not of one shop), e.g. how long the
//   trash is kept. Automatic clean-up is OFF until the administrator turns it on.
// Idempotent: safe to run on every start.

async function migrateTrash(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS deleted_records (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      shop_id INT NOT NULL,
      entity VARCHAR(64) NOT NULL,
      record_id BIGINT UNSIGNED NOT NULL,
      label VARCHAR(255) NOT NULL,
      snapshot LONGTEXT NOT NULL,
      side_effects LONGTEXT DEFAULT NULL,
      photo_files LONGTEXT DEFAULT NULL,
      photos_purged_at DATETIME DEFAULT NULL,
      size_bytes INT UNSIGNED NOT NULL DEFAULT 0,
      deleted_by INT DEFAULT NULL,
      deleted_by_name VARCHAR(255) DEFAULT NULL,
      deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      restored_at DATETIME DEFAULT NULL,
      restored_by INT DEFAULT NULL,
      INDEX idx_deleted_shop_time (shop_id, deleted_at),
      INDEX idx_deleted_entity (entity, record_id),
      INDEX idx_deleted_time (deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      \`key\` VARCHAR(100) NOT NULL PRIMARY KEY,
      value TEXT DEFAULT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

module.exports = { migrateTrash };
