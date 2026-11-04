// Customer cases (November 2026): the claims table also records a car that came back to be fixed with nothing new sold,
// what was found, how it was fixed, and the calls made afterwards to ask the customer how the car is.
//
// claims gets:
//   case_type          parts_claim (a part was claimed) | rework (came back to have our work fixed)
//   status             open (being fixed) → follow_up (fixed, staff call the customer) → closed (closed by a manager)
//   source_receipt_id  the bill the problem comes from (optional, no foreign key: a deleted bill must not touch the case)
//   finding, resolution, outcome, lesson, closed_at, closed_by
// claim_follow_ups: one row per planned call; done_at is empty until staff write the report. A child of claims like
// claim_items, so it has no shop_id and is always reached through its claim; it goes to the trash with its claim.
//
// Claims made before this change were never tracked, so they start as closed: nobody is asked to call about old work.
// Idempotent: safe to run on every start. Nothing is deleted.

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column]
  );
  return rows.length > 0;
}

async function indexExists(conn, table, index) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
    [table, index]
  );
  return rows.length > 0;
}

async function addColumn(conn, table, column, definition) {
  if (await columnExists(conn, table, column)) return;
  await conn.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function migrateClaimCases(conn) {
  await addColumn(conn, 'claims', 'case_type', "VARCHAR(20) NOT NULL DEFAULT 'parts_claim'");
  if (!(await columnExists(conn, 'claims', 'status'))) {
    // existing rows take 'closed' from this first default; new rows default to 'open' from then on
    await conn.query("ALTER TABLE claims ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'closed'");
    await conn.query("ALTER TABLE claims ALTER COLUMN status SET DEFAULT 'open'");
  }
  await addColumn(conn, 'claims', 'source_receipt_id', 'BIGINT UNSIGNED DEFAULT NULL');
  await addColumn(conn, 'claims', 'finding', 'TEXT');
  await addColumn(conn, 'claims', 'resolution', 'TEXT');
  await addColumn(conn, 'claims', 'outcome', 'VARCHAR(20) DEFAULT NULL');
  await addColumn(conn, 'claims', 'lesson', 'TEXT');
  await addColumn(conn, 'claims', 'closed_at', 'DATETIME DEFAULT NULL');
  await addColumn(conn, 'claims', 'closed_by', 'VARCHAR(100) DEFAULT NULL');
  if (!(await indexExists(conn, 'claims', 'idx_claim_shop_status'))) {
    await conn.query('ALTER TABLE claims ADD INDEX idx_claim_shop_status (shop_id, status)');
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS claim_follow_ups (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      claim_id BIGINT UNSIGNED NOT NULL,
      scheduled_date DATE NOT NULL,
      done_at DATETIME DEFAULT NULL,
      done_by VARCHAR(100) DEFAULT NULL,
      result VARCHAR(20) DEFAULT NULL,
      note TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_follow_up_claim (claim_id, done_at),
      CONSTRAINT fk_follow_up_claim FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

module.exports = { migrateClaimCases };
