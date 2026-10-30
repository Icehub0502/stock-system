// activity_log: every change a signed-in user makes (create / edit / delete / action), who, when, from where, what was
// sent and, for edits and deletes, what the record looked like before. Written by middleware/activityLogger.js and read
// only by the platform administrator (role dev, routes/devActivity.routes.js). Nothing in the app reads it back.
async function migrateActivityLog(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      shop_id INT DEFAULT NULL,
      user_id INT DEFAULT NULL,
      username VARCHAR(100) DEFAULT NULL,
      full_name VARCHAR(255) DEFAULT NULL,
      role VARCHAR(20) DEFAULT NULL,
      method VARCHAR(8) NOT NULL,
      route VARCHAR(200) NOT NULL,
      path VARCHAR(500) NOT NULL,
      status SMALLINT UNSIGNED NOT NULL,
      duration_ms INT UNSIGNED DEFAULT NULL,
      kind VARCHAR(16) NOT NULL,
      entity VARCHAR(64) DEFAULT NULL,
      entity_id VARCHAR(64) DEFAULT NULL,
      summary VARCHAR(500) NOT NULL,
      request_body MEDIUMTEXT DEFAULT NULL,
      before_data MEDIUMTEXT DEFAULT NULL,
      error_text VARCHAR(500) DEFAULT NULL,
      ip VARCHAR(64) DEFAULT NULL,
      user_agent VARCHAR(255) DEFAULT NULL,
      INDEX idx_act_time (created_at),
      INDEX idx_act_shop (shop_id, created_at),
      INDEX idx_act_user (user_id, created_at),
      INDEX idx_act_entity (entity, entity_id),
      INDEX idx_act_kind (kind, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

module.exports = { migrateActivityLog };
