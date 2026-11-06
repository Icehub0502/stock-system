// The warranty register: a running number (SPK 123, PKS 1) for every bill that replaces a rack.
//
// warranty_numbers: one row per number, per branch. A number is taken on the job (it prints on the repair notice before
// any receipt exists) or on a receipt with no job; a job reaches its receipt through quotations.converted_receipt_id.
// A number given by mistake is voided, never reused and never deleted, so the paper trail has no holes.
//
// shops.warranty_start_no: the number a branch starts from. Empty until a manager sets it, because SPK continues from an
// Excel sheet and must not hand out 1 again. PKS starts from 1, as the owner decided (2026-11-06).
// Idempotent: safe to run on every start.

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column]
  );
  return rows.length > 0;
}

async function migrateWarrantyRegister(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS warranty_numbers (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      shop_id INT NOT NULL DEFAULT 1,
      warranty_no INT NOT NULL,
      job_id BIGINT UNSIGNED DEFAULT NULL,
      receipt_id BIGINT UNSIGNED DEFAULT NULL,
      created_by VARCHAR(100) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      voided_at DATETIME DEFAULT NULL,
      voided_by VARCHAR(100) DEFAULT NULL,
      UNIQUE KEY uq_warranty_no (shop_id, warranty_no),
      KEY idx_warranty_no_job (job_id),
      KEY idx_warranty_no_receipt (receipt_id),
      CONSTRAINT fk_warranty_no_shop FOREIGN KEY (shop_id) REFERENCES shops(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  if (!(await columnExists(conn, 'shops', 'warranty_start_no'))) {
    await conn.query('ALTER TABLE shops ADD COLUMN warranty_start_no INT DEFAULT NULL');
    await conn.query("UPDATE shops SET warranty_start_no = 1 WHERE code = 'champpowerpks'");
  }
}

module.exports = { migrateWarrantyRegister };
