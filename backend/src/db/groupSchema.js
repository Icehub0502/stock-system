// Branch groups: one owner (a business) can have several shops ("branches").
//
// - shop_groups: the business. shops.group_id says which business a shop belongs to.
//   Shop 1 (Champpower SPK) goes into the group "แชมป์พาวเวอร์".
// - An owner can switch between the branches of their own group and sees the combined figures of
//   those branches; a manager stays in one branch. Shops of other groups are invisible to them.
// - dev_audit_log: what the platform administrator (and owners switching branches) did, and when.
// - users.is_active: a switched-off account cannot log in (the administrator does this from the console).
// Idempotent: safe to run on every start.

const DEFAULT_GROUP_NAME = 'แชมป์พาวเวอร์';

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column]
  );
  return rows.length > 0;
}

async function migrateGroups(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS shop_groups (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  if (!(await columnExists(conn, 'shops', 'group_id'))) {
    await conn.query(
      `ALTER TABLE shops
         ADD COLUMN group_id INT DEFAULT NULL,
         ADD INDEX idx_shops_group (group_id),
         ADD CONSTRAINT fk_shops_group FOREIGN KEY (group_id) REFERENCES shop_groups(id) ON DELETE RESTRICT`
    );
  }

  // every shop must belong to a group: shops without one get a group of their own
  const [loose] = await conn.query('SELECT id, name FROM shops WHERE group_id IS NULL ORDER BY id');
  for (const shop of loose) {
    const name = shop.id === 1 ? DEFAULT_GROUP_NAME : shop.name;
    const [group] = await conn.query('INSERT INTO shop_groups (name) VALUES (?)', [name]);
    await conn.query('UPDATE shops SET group_id = ? WHERE id = ?', [group.insertId, shop.id]);
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS dev_audit_log (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT DEFAULT NULL,
      username VARCHAR(100) DEFAULT NULL,
      action VARCHAR(64) NOT NULL,
      shop_id INT DEFAULT NULL,
      detail TEXT DEFAULT NULL,
      ip VARCHAR(64) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_audit_time (created_at),
      INDEX idx_audit_shop (shop_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  if (!(await columnExists(conn, 'users', 'is_active'))) {
    await conn.query('ALTER TABLE users ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1');
  }
}

module.exports = { migrateGroups, DEFAULT_GROUP_NAME };
