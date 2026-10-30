// Parts suppliers and what the parts cost:
//   suppliers                  the shops the stock is bought from, per branch; guide_categories only orders the
//                              suggestions in the receive form (a supplier is not limited to those categories).
//                              The table already existed (name, phone, line_id, contact_person, note, is_active,
//                              shop_id; nothing used it): it is kept as it is and only guide_categories is added.
//   receipt_sessions.supplier_*  which supplier a receive bill came from (one bill = one supplier)
//   stock_receive_lines.unit_cost  price per piece on that bill line (can be filled in after the bill is closed)
//   stock_receive_lines.movement_id / voided_at  the stock movement a closed line became, and when that receive was
//                              cancelled (a cancelled line no longer counts in the average cost)
//   stock_items.avg_cost       cost of an item = average of its received lines that have a cost, weighted by quantity;
//                              manual_cost is the fallback typed by hand for stock bought before costs were recorded
async function hasColumn(conn, table, column) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [table, column]
  );
  return rows.length > 0;
}

async function addColumn(conn, table, column, definition) {
  if (!(await hasColumn(conn, table, column))) await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}

// The first branch's list as the owner gave it: supplier → categories it is usually bought for
const SHOP_1_SUPPLIERS = [
  ['รุ่งโรจน์อะไหล่ยนต์', 'แร็ค,ปีกนก'],
  ['BBTECT', 'แร็ค,ปีกนก'],
  ['ดอนเมือง', 'แร็ค,ปีกนก,โช๊ค'],
  ['รัตนา', 'แร็ค'],
  ['เฮียใช้ PSกลการ', 'แร็ค,ปีกนก'],
  ['ช่างอั๋น', 'แร็ค'],
  ['พี่ไฟล์', 'แร็ค,ปีกนก'],
  ['EEP', 'ปีกนก,เพลาขับ,โช๊ค'],
  ['TSV', 'เพลาขับ'],
  ['รุ่งเรืองรัต ซอยมังกร', 'เพลาขับ,ลูกหมาก,โช๊ค,ผ้าเบรค'],
  ['รุ่งเรืองรัต หนามแดง', 'โช๊ค,ผ้าเบรค'],
  ['พันสุข', 'เพลาขับ,ลูกหมาก,โช๊ค,ผ้าเบรค'],
  ['JET', 'ลูกหมาก'],
  ['333', 'ลูกหมาก'],
  ['PMC', 'ลูกหมาก,โช๊ค,ผ้าเบรค'],
  ['Amada', 'โช๊ค'],
  ['Formula', 'โช๊ค'],
  ['TEIN', 'โช๊ค'],
  ['Superpart', 'โช๊ค'],
  ['YOSHI', 'ผ้าเบรค'],
];

async function migrateSuppliers(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      phone VARCHAR(50) DEFAULT NULL,
      line_id VARCHAR(100) DEFAULT NULL,
      contact_person VARCHAR(150) DEFAULT NULL,
      note TEXT DEFAULT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      shop_id INT NOT NULL DEFAULT 1,
      KEY idx_suppliers_shop (shop_id),
      CONSTRAINT fk_suppliers_shop FOREIGN KEY (shop_id) REFERENCES shops(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await addColumn(conn, 'suppliers', 'guide_categories', 'VARCHAR(255) DEFAULT NULL');
  await addColumn(conn, 'receipt_sessions', 'supplier_id', 'INT DEFAULT NULL');
  await addColumn(conn, 'receipt_sessions', 'supplier_name', 'VARCHAR(150) DEFAULT NULL');
  await addColumn(conn, 'stock_receive_lines', 'unit_cost', 'DECIMAL(12,2) DEFAULT NULL');
  await addColumn(conn, 'stock_receive_lines', 'movement_id', 'BIGINT UNSIGNED DEFAULT NULL');
  await addColumn(conn, 'stock_receive_lines', 'voided_at', 'DATETIME DEFAULT NULL');
  await addColumn(conn, 'stock_items', 'avg_cost', 'DECIMAL(12,2) DEFAULT NULL');
  await addColumn(conn, 'stock_items', 'manual_cost', 'DECIMAL(12,2) DEFAULT NULL');
  // the first branch's list, added once (a name that is already there, in any case, is left alone)
  for (const [name, categories] of SHOP_1_SUPPLIERS) {
    await conn.query(
      `INSERT INTO suppliers (shop_id, name, guide_categories)
       SELECT sh.id, ?, ? FROM shops sh
       WHERE sh.id = 1 AND NOT EXISTS (SELECT 1 FROM suppliers x WHERE x.shop_id = 1 AND LOWER(x.name) = LOWER(?))`,
      [name, categories, name]
    );
  }
}

module.exports = { migrateSuppliers };
