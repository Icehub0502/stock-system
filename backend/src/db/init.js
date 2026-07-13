const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'stock_system';

// ===== เพิ่ม Pool =====
const pool = mysql.createPool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function initDatabase() {
  const rootConn = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD
  });

  await rootConn.query(
    `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );

  await rootConn.end();

  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME
  });

  await conn.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(255),
      role ENUM('office','technician') NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS racks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      model_code VARCHAR(100) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      stock_qty INT NOT NULL DEFAULT 0,
      min_stock INT NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS receipt_sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_no VARCHAR(100) NOT NULL,
      user_id INT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_receipt_session_user FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS wing_arms (
      id INT AUTO_INCREMENT PRIMARY KEY,
      sku VARCHAR(100) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      position ENUM('upper','lower') NOT NULL DEFAULT 'lower',
      axle ENUM('front','rear') NOT NULL DEFAULT 'front',
      side ENUM('left','right') NOT NULL,
      stock_qty INT NOT NULL DEFAULT 0,
      min_stock INT NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      rack_id INT DEFAULT NULL,
      wing_arm_id INT DEFAULT NULL,
      type ENUM('IN','OUT') NOT NULL,
      qty INT NOT NULL,
      user_id INT NOT NULL,
      note VARCHAR(255),
      receipt_session_id INT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_tx_rack FOREIGN KEY (rack_id) REFERENCES racks(id) ON DELETE CASCADE,
      CONSTRAINT fk_tx_wing_arm FOREIGN KEY (wing_arm_id) REFERENCES wing_arms(id) ON DELETE CASCADE,
      CONSTRAINT fk_tx_user FOREIGN KEY (user_id) REFERENCES users(id),
      CONSTRAINT fk_tx_receipt_session FOREIGN KEY (receipt_session_id) REFERENCES receipt_sessions(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      customer_code VARCHAR(20) UNIQUE NOT NULL COMMENT 'CM-0001',
      customer_name VARCHAR(255) NOT NULL,
      phone VARCHAR(30) DEFAULT NULL,
      line_id VARCHAR(100) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS quotations (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      quotation_no VARCHAR(20) UNIQUE NOT NULL COMMENT 'IV260630001',
      quotation_date DATE NOT NULL,
      customer_id BIGINT UNSIGNED NOT NULL,
      car_brand VARCHAR(100),
      car_model VARCHAR(100),
      car_color VARCHAR(50),
      license_plate VARCHAR(50),
      product_summary TEXT,
      total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_quotation_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS products (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      category VARCHAR(100) NOT NULL,
      parts VARCHAR(100) NOT NULL,
      description TEXT NOT NULL,
      brand VARCHAR(100) DEFAULT NULL,
      price DECIMAL(10,2) DEFAULT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    ALTER TABLE products
    MODIFY COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
  `).catch(() => {});

  await conn.query(`
    CREATE TABLE IF NOT EXISTS quotation_items (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      quotation_id BIGINT UNSIGNED NOT NULL,
      product_id BIGINT UNSIGNED,
      product_name VARCHAR(255) NOT NULL,
      quantity INT NOT NULL DEFAULT 1,
      unit_price DECIMAL(12, 2) NOT NULL,
      vat DECIMAL(12, 2) GENERATED ALWAYS AS (quantity * unit_price * 0.07) STORED,
      CONSTRAINT fk_quotation_item FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE,
      CONSTRAINT fk_product_item FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Mirrors receipt_items' warranty columns so a quotation can carry the
  // same warranty info as a receipt (picked from the same service_items
  // catalog) — these get copied onto the receipt_items row created when a
  // quotation is approved, same as picking the item directly on a receipt.
  await conn.query(`
    ALTER TABLE quotation_items
    ADD COLUMN warranty_name VARCHAR(255) DEFAULT NULL,
    ADD COLUMN warranty_year INT DEFAULT 0,
    ADD COLUMN warranty_month INT DEFAULT 0,
    ADD COLUMN warranty_km INT DEFAULT 0
  `).catch(() => {});

  await conn.query(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      customer_id BIGINT UNSIGNED NOT NULL,
      brand VARCHAR(100) NOT NULL,
      model VARCHAR(100) NOT NULL,
      color VARCHAR(50) DEFAULT NULL,
      license_plate VARCHAR(50) DEFAULT NULL,
      mileage INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_vehicle_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS warranties (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      warranty_name VARCHAR(255) NOT NULL,
      warranty_year INT DEFAULT 0,
      warranty_month INT DEFAULT 0,
      warranty_km INT DEFAULT 0,
      is_active TINYINT(1) DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS service_items (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      category VARCHAR(100) NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      warranty_id BIGINT UNSIGNED DEFAULT NULL,
      is_active TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_service_warranty FOREIGN KEY (warranty_id) REFERENCES warranties(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Product "sets" (e.g. "ชุดโปรช่วงล่าง"): a service_items row flagged
  // is_set=1 carries one combined price for the whole set; its parts list
  // lives in service_item_components and is only used client-side to
  // expand the set into separate line items when picked on a receipt.
  await conn.query(`
    ALTER TABLE service_items
    ADD COLUMN is_set TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN set_price DECIMAL(10,2) DEFAULT NULL
  `).catch(() => {});

  await conn.query(`
    CREATE TABLE IF NOT EXISTS service_item_components (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      service_item_id BIGINT UNSIGNED NOT NULL,
      component_name VARCHAR(255) NOT NULL,
      default_qty INT NOT NULL DEFAULT 1,
      sort_order INT NOT NULL DEFAULT 0,
      CONSTRAINT fk_set_component_item FOREIGN KEY (service_item_id) REFERENCES service_items(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS receipts (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      receipt_no VARCHAR(30) NOT NULL UNIQUE,
      receipt_date DATE NOT NULL,
      customer_id BIGINT UNSIGNED NOT NULL,
      vehicle_id BIGINT UNSIGNED NOT NULL,
      mileage INT DEFAULT 0,
      remark TEXT DEFAULT NULL,
      payment_method VARCHAR(50) DEFAULT NULL,
      technician_name VARCHAR(100) DEFAULT NULL,
      total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_receipt_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
      CONSTRAINT fk_receipt_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await conn.query(`
    ALTER TABLE receipts
    ADD COLUMN payment_method VARCHAR(50) DEFAULT NULL,
    ADD COLUMN technician_name VARCHAR(100) DEFAULT NULL
  `).catch(() => {});

  await conn.query(`
    ALTER TABLE receipts
    ADD COLUMN printed_at TIMESTAMP NULL DEFAULT NULL
  `).catch(() => {});

  // Mirrors quotations.customer_signature — either captured directly on a
  // walk-in receipt, or copied over automatically when an approved
  // quotation (which already has one) is converted.
  await conn.query(`
    ALTER TABLE receipts
    ADD COLUMN customer_signature LONGTEXT DEFAULT NULL
  `).catch(() => {});

  // Quotation approval workflow: pending -> approved (auto-converted to a
  // receipt) or scheduled (customer asked to come back on scheduled_date).
  // Added via ALTER (not the CREATE TABLE above) because vehicles/receipts
  // must already exist for the FKs, and this runs on every boot against a
  // possibly-already-created table from before this feature existed.
  await conn.query(`
    ALTER TABLE quotations
    ADD COLUMN vehicle_id BIGINT UNSIGNED DEFAULT NULL,
    ADD COLUMN mileage INT DEFAULT 0,
    ADD COLUMN remark TEXT DEFAULT NULL,
    ADD COLUMN status ENUM('pending','approved','scheduled') NOT NULL DEFAULT 'pending',
    ADD COLUMN scheduled_date DATE DEFAULT NULL,
    ADD COLUMN converted_receipt_id BIGINT UNSIGNED DEFAULT NULL,
    ADD CONSTRAINT fk_quotation_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_quotation_receipt FOREIGN KEY (converted_receipt_id) REFERENCES receipts(id) ON DELETE SET NULL
  `).catch(() => {});

  // queue_no: a hand-entered job/queue number (replaces showing the auto
  // customer_code in the printed header — staff track their own numbering).
  // symptom: the customer's reported issue with the vehicle, captured before
  // quoting repairs.
  await conn.query(`
    ALTER TABLE quotations
    ADD COLUMN queue_no VARCHAR(50) DEFAULT NULL,
    ADD COLUMN symptom TEXT DEFAULT NULL
  `).catch(() => {});

  // customer_signature: a base64 PNG data URI captured on the shop's
  // tablet/phone — stored as-is (no file-upload pipeline in this app yet,
  // and a hand-drawn signature is only a few KB). Carried over onto the
  // receipt created when the quotation is approved, so it doesn't need to
  // be captured twice.
  await conn.query(`
    ALTER TABLE quotations
    ADD COLUMN customer_signature LONGTEXT DEFAULT NULL
  `).catch(() => {});

  await conn.query(`
    CREATE TABLE IF NOT EXISTS receipt_items (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      receipt_id BIGINT UNSIGNED NOT NULL,
      service_item_id BIGINT UNSIGNED DEFAULT NULL,
      product_name_snapshot VARCHAR(255) DEFAULT NULL,
      qty INT DEFAULT 1,
      price DECIMAL(10,2) DEFAULT 0.00,
      amount DECIMAL(10,2) DEFAULT 0.00,
      warranty_name VARCHAR(255) DEFAULT NULL,
      warranty_year INT DEFAULT 0,
      warranty_month INT DEFAULT 0,
      warranty_km INT DEFAULT 0,
      CONSTRAINT fk_receipt_item_receipt FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE,
      CONSTRAINT fk_receipt_item_service FOREIGN KEY (service_item_id) REFERENCES service_items(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // The physical "ใบแจ้งซ่อม" checklist form (fixed sections/sub-items, not
  // a variable line-item list like receipts/quotations) — stored as one
  // JSON blob since the shape is owned and rendered entirely by the
  // frontend; the backend just persists and returns it opaquely.
  await conn.query(`
    CREATE TABLE IF NOT EXISTS repair_notices (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(20) NOT NULL,
      customer_id BIGINT UNSIGNED DEFAULT NULL,
      vehicle_id BIGINT UNSIGNED DEFAULT NULL,
      quotation_id BIGINT UNSIGNED DEFAULT NULL,
      notice_date DATE NOT NULL,
      checklist JSON NOT NULL,
      checked_by VARCHAR(100) DEFAULT NULL,
      repaired_by VARCHAR(100) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_repair_notice_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
      CONSTRAINT fk_repair_notice_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL,
      CONSTRAINT fk_repair_notice_quotation FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [userRows] = await conn.query(
    'SELECT COUNT(*) AS c FROM users'
  );

  if (userRows[0].c === 0) {
    await conn.query(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
      ['admin', bcrypt.hashSync('admin123', 10), 'Office Admin', 'office']
    );

    await conn.query(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
      ['tech1', bcrypt.hashSync('tech123', 10), 'ช่าง 1', 'technician']
    );
  }

  await conn.end();

  console.log(`[init-db] Database "${DB_NAME}" ready`);
}

// ===== สำคัญ =====
module.exports = initDatabase;

// รันตรง ๆ
if (require.main === module) {
  initDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}