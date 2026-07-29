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

// error code ที่หมายถึง "คอลัมน์/ดัชนี/FK นี้มีอยู่แล้ว" — เกิดขึ้นได้ปกติเมื่อรัน
// migration ซ้ำทุกครั้งที่บูต (ตารางถูกสร้างไปแล้วจากการบูตครั้งก่อน) ปลอดภัยที่จะข้าม
// error code อื่น (เช่น สิทธิ์ไม่พอ, disk เต็ม, lock timeout) ต้องโยนต่อ ไม่ให้เงียบหาย
const IGNORABLE_ALTER_ERROR_CODES = new Set([
  'ER_DUP_FIELDNAME',          // ADD COLUMN ที่มีอยู่แล้ว
  'ER_DUP_KEYNAME',            // ADD INDEX/KEY ที่มีอยู่แล้ว
  'ER_DUP_KEY',                // ADD INDEX/UNIQUE ที่ชนกับ index เดิม
  'ER_FK_DUP_NAME',            // ADD CONSTRAINT (FOREIGN KEY) ที่มีอยู่แล้ว
  'ER_CANT_DROP_FIELD_OR_KEY', // DROP COLUMN ที่ถูกลบไปแล้ว (รันซ้ำทุกครั้งที่บูต)
]);

function ignoreIfAlreadyApplied(err) {
  if (IGNORABLE_ALTER_ERROR_CODES.has(err.code)) return;
  // error จริง (ไม่ใช่แค่ "มีอยู่แล้ว") — log แล้วโยนต่อให้บูตล้มเหลว แทนที่จะเงียบไป
  console.error('[init-db] Migration ALTER failed:', err.message);
  throw err;
}

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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS receipt_sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_no VARCHAR(100) NOT NULL,
      user_id INT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_receipt_session_user FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS products (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      category VARCHAR(100) NOT NULL,
      parts VARCHAR(100) NOT NULL,
      description TEXT NOT NULL,
      brand VARCHAR(100) DEFAULT NULL,
      price DECIMAL(10,2) DEFAULT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    ALTER TABLE products
    MODIFY COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT
  `).catch(ignoreIfAlreadyApplied);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS quotation_items (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      quotation_id BIGINT UNSIGNED NOT NULL,
      product_id BIGINT UNSIGNED,
      product_name VARCHAR(255) NOT NULL,
      quantity INT NOT NULL DEFAULT 1,
      unit_price DECIMAL(12, 2) NOT NULL,
      CONSTRAINT fk_quotation_item FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE,
      CONSTRAINT fk_product_item FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // เจ้าของร้านยืนยันว่าบิลที่ออกจริงไม่มี Vat 7% เลย — ลบคอลัมน์ที่คำนวณอัตโนมัติ
  // (GENERATED ALWAYS AS quantity * unit_price * 0.07) ออก เพราะไม่เคยถูกใช้แสดงผล
  // หรือรวมเป็นยอดใด ๆ ที่ลูกค้าเห็นอยู่แล้ว (ตรวจสอบแล้วว่าไม่มี route/หน้าไหนอ่านค่านี้
  // ไปคำนวณยอดรวม) ใช้ DROP COLUMN แบบ idempotent — ถ้าคอลัมน์ถูกลบไปแล้วจากการบูต
  // ครั้งก่อน MySQL จะโยน ER_CANT_DROP_FIELD_OR_KEY ซึ่งถูกดักไว้ใน ignoreIfAlreadyApplied
  await conn.query(`
    ALTER TABLE quotation_items
    DROP COLUMN vat
  `).catch(ignoreIfAlreadyApplied);

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
  `).catch(ignoreIfAlreadyApplied);

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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS warranties (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      warranty_name VARCHAR(255) NOT NULL,
      warranty_year INT DEFAULT 0,
      warranty_month INT DEFAULT 0,
      warranty_km INT DEFAULT 0,
      is_active TINYINT(1) DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Product "sets" (e.g. "ชุดโปรช่วงล่าง"): a service_items row flagged
  // is_set=1 carries one combined price for the whole set; its parts list
  // lives in service_item_components and is only used client-side to
  // expand the set into separate line items when picked on a receipt.
  await conn.query(`
    ALTER TABLE service_items
    ADD COLUMN is_set TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN set_price DECIMAL(10,2) DEFAULT NULL
  `).catch(ignoreIfAlreadyApplied);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS service_item_components (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      service_item_id BIGINT UNSIGNED NOT NULL,
      component_name VARCHAR(255) NOT NULL,
      default_qty INT NOT NULL DEFAULT 1,
      sort_order INT NOT NULL DEFAULT 0,
      CONSTRAINT fk_set_component_item FOREIGN KEY (service_item_id) REFERENCES service_items(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await conn.query(`
    ALTER TABLE receipts
    ADD COLUMN payment_method VARCHAR(50) DEFAULT NULL,
    ADD COLUMN technician_name VARCHAR(100) DEFAULT NULL
  `).catch(ignoreIfAlreadyApplied);

  await conn.query(`
    ALTER TABLE receipts
    ADD COLUMN printed_at TIMESTAMP NULL DEFAULT NULL
  `).catch(ignoreIfAlreadyApplied);

  // Mirrors quotations.customer_signature — either captured directly on a
  // walk-in receipt, or copied over automatically when an approved
  // quotation (which already has one) is converted.
  await conn.query(`
    ALTER TABLE receipts
    ADD COLUMN customer_signature LONGTEXT DEFAULT NULL
  `).catch(ignoreIfAlreadyApplied);

  // Mirrors quotations.deposit_amount/deposit_date — receipts เก็บ snapshot
  // ของฟิลด์ที่ลูกค้าเห็น (เหมือน remark/mileage/payment_method ด้านบน) แทนการ
  // join กลับไปที่ quotations เดิม ค่าจะถูกคัดลอกมาตอนใบเสนอราคาถูกอนุมัติ
  await conn.query(`
    ALTER TABLE receipts
    ADD COLUMN deposit_amount DECIMAL(10,2) NULL,
    ADD COLUMN deposit_date DATE NULL
  `).catch(ignoreIfAlreadyApplied);

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
  `).catch(ignoreIfAlreadyApplied);

  // queue_no: a hand-entered job/queue number (replaces showing the auto
  // customer_code in the printed header — staff track their own numbering).
  // symptom: the customer's reported issue with the vehicle, captured before
  // quoting repairs.
  await conn.query(`
    ALTER TABLE quotations
    ADD COLUMN queue_no VARCHAR(50) DEFAULT NULL,
    ADD COLUMN symptom TEXT DEFAULT NULL
  `).catch(ignoreIfAlreadyApplied);

  // customer_signature: a base64 PNG data URI captured on the shop's
  // tablet/phone — stored as-is (no file-upload pipeline in this app yet,
  // and a hand-drawn signature is only a few KB). Carried over onto the
  // receipt created when the quotation is approved, so it doesn't need to
  // be captured twice.
  await conn.query(`
    ALTER TABLE quotations
    ADD COLUMN customer_signature LONGTEXT DEFAULT NULL
  `).catch(ignoreIfAlreadyApplied);

  // เพิ่มค่า 'no_date' ให้ status — ใช้เมื่อสำนักงานกดยืนยันชัดเจนว่าลูกค้าไม่ระบุวัน
  // นัดหมาย (ต่างจาก 'pending' เฉยๆ ที่แปลว่ายังไม่ได้ดำเนินการอะไรเลย) MODIFY COLUMN
  // ปลอดภัยที่จะรันซ้ำทุกครั้งที่บูต ไม่เหมือน ADD COLUMN ที่ error ถ้ามีอยู่แล้ว
  await conn.query(`
    ALTER TABLE quotations
    MODIFY COLUMN status ENUM('pending','approved','scheduled','no_date') NOT NULL DEFAULT 'pending'
  `).catch(ignoreIfAlreadyApplied);

  // Mirrors receipts.printed_at — lets the list show a persisted "พิมพ์แล้ว"
  // state per quotation instead of forgetting as soon as the modal closes.
  await conn.query(`
    ALTER TABLE quotations
    ADD COLUMN printed_at TIMESTAMP NULL DEFAULT NULL
  `).catch(ignoreIfAlreadyApplied);

  // requested_queue_no: เลขคิวที่พนักงาน "พิมพ์มาจริง" ก่อนถูกเปลี่ยนอัตโนมัติ (ดู
  // createQuotationFromQueue ใน lineWebhook.routes.js) — เกิดเมื่อเลขคิวชนกับของ
  // ลูกค้าคนอื่นในวันเดียวกัน ระบบจะเปลี่ยน queue_no จริงให้เป็นเลขถัดไปที่ว่าง แต่
  // เก็บเลขเดิมที่พิมพ์มาไว้ที่นี่ด้วย เพื่อให้ลูกค้าคนเดิมพิมพ์เลขคิวเดิมซ้ำอีกครั้ง
  // (หมายถึง "แก้ไขใบเดิม") ยังจับคู่กับใบที่ถูกเปลี่ยนเลขไปแล้วได้ถูกต้อง แทนที่จะ
  // เปิดใบใหม่ซ้อน
  await conn.query(`
    ALTER TABLE quotations
    ADD COLUMN requested_queue_no VARCHAR(50) DEFAULT NULL
  `).catch(ignoreIfAlreadyApplied);

  // closed_at: ตราเวลาที่บิลนี้ "ปิด" แล้ว (ลูกค้าชำระเงินเสร็จผ่านเทมเพลตไลน์ ดู
  // createQuotationFromQueue ใน lineWebhook.routes.js) — ไม่ใช้ status ENUM ใหม่
  // (status ยังเป็น 'approved' เหมือนบิลอนุมัติทั่วไปที่ยังไม่ปิด) เพราะ closed_at
  // เป็นแค่ "ล็อกไม่ให้ merge/ชนคิวอีก" ไม่ใช่สถานะงานที่ต้องแสดงแยกในหน้าเว็บ บิลที่
  // ปิดแล้วจะไม่ถูกจับคู่เป็นใบเดิมอีก (กันแก้ไขบิลที่จบงานไปแล้ว) และเลขคิวของมันจะ
  // ถูกปล่อยว่างให้ลูกค้าคนใหม่ใช้ได้ (ดู takenByOther/existing lookup queries)
  await conn.query(`
    ALTER TABLE quotations
    ADD COLUMN closed_at TIMESTAMP NULL DEFAULT NULL
  `).catch(ignoreIfAlreadyApplied);

  // deposit_amount/deposit_date: เงินมัดจำที่ลูกค้าวางไว้ตอนเปิดใบเสนอราคา (ก่อนงาน
  // เสร็จจริง) และวันที่วางมัดจำ — ไม่บังคับกรอก (NULL ได้) เพราะใบเสนอราคาส่วนใหญ่
  // ไม่มีมัดจำ ค่าจะถูกคัดลอกไปที่ receipts ตอนอนุมัติ เหมือนกับ remark/mileage/
  // payment_method ที่ทำอยู่แล้ว (ดู quotations.routes.js และ lineWebhook.routes.js)
  await conn.query(`
    ALTER TABLE quotations
    ADD COLUMN deposit_amount DECIMAL(10,2) NULL,
    ADD COLUMN deposit_date DATE NULL
  `).catch(ignoreIfAlreadyApplied);

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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // repair_notices.code (RN-####) ไม่มี UNIQUE constraint มาตั้งแต่แรก ต่างจาก
  // quotation_no/receipt_no/customer_code ที่มี — เพิ่มไว้เป็นตัวกันสำรองระดับ DB
  // ถ้า generateRepairNoticeCode/generateCode (ที่ล็อกด้วย FOR UPDATE ในทรานแซกชัน
  // อยู่แล้ว) มีช่องโหว่หลุดออกมาได้บ้าง จะได้ error ที่ ER_DUP_ENTRY ชัดเจนแทนที่จะ
  // ปล่อยให้เอกสาร 2 ใบใช้เลขเดียวกันเงียบ ๆ
  await conn.query(`
    ALTER TABLE repair_notices
    ADD UNIQUE KEY uk_repair_notices_code (code)
  `).catch(ignoreIfAlreadyApplied);

  // ดัชนีเสริมประสิทธิภาพ query ที่ใช้บ่อย — ไม่ใช่ constraint ใหม่ ไม่กระทบข้อมูลเดิม
  // customers.phone: ใช้กับ WHERE phone = ? ใน LINE webhook (ดู lineWebhook.routes.js)
  await conn.query(`
    ALTER TABLE customers
    ADD INDEX idx_customers_phone (phone)
  `).catch(ignoreIfAlreadyApplied);

  // receipts.receipt_date: ใช้กับ WHERE r.receipt_date = ? (ดู receipts.routes.js)
  await conn.query(`
    ALTER TABLE receipts
    ADD INDEX idx_receipts_receipt_date (receipt_date)
  `).catch(ignoreIfAlreadyApplied);

  // quotations(customer_id, queue_no, quotation_date): รองรับการค้นหาใบเสนอราคา
  // เดิมของลูกค้าคนเดียวกัน+เลขคิวเดียวกันใน createQuotationFromQueue (LINE bot)
  await conn.query(`
    ALTER TABLE quotations
    ADD INDEX idx_quotations_customer_queue_date (customer_id, queue_no, quotation_date)
  `).catch(ignoreIfAlreadyApplied);

  // เก็บ message id ของ LINE ที่ประมวลผลแล้ว (กันสร้างใบเสนอราคาซ้ำตอน LINE ส่ง
  // webhook ซ้ำ/retry) ลงฐานข้อมูลแทนหน่วยความจำล้วน (Set/Map เดิมใน
  // lineWebhook.routes.js) — เดิมข้อมูลนี้หายทุกครั้งที่ PM2 restart/deploy ทำให้
  // ข้อความที่เคยประมวลผลไปแล้วกลับถูกสร้างใบเสนอราคาซ้ำได้ถ้า LINE retry มาหลัง
  // restart พอดี quotation_id/quotation_no/customer_id/vehicle_id/was_new_* ถูก
  // เติมทีหลังเฉพาะข้อความที่ "เปิดใบใหม่" เท่านั้น (ดู trackMessageQuotation) ใช้
  // ตอนจัดการ unsend — ข้อความอื่นแถวนี้จะมีแค่ message_id เก็บไว้เฉย ๆ
  await conn.query(`
    CREATE TABLE IF NOT EXISTS processed_line_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      message_id VARCHAR(64) NOT NULL UNIQUE,
      quotation_id BIGINT UNSIGNED NULL,
      quotation_no VARCHAR(20) NULL,
      customer_id BIGINT UNSIGNED NULL,
      vehicle_id BIGINT UNSIGNED NULL,
      was_new_customer TINYINT(1) DEFAULT 0,
      was_new_vehicle TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // เก็บค่า config ทั่วไปแบบ key-value สำหรับ LINE bot เช่น group id ที่จะใช้ push
  // ข้อความเชิงรุก (proactive) หา — บันทึกอัตโนมัติครั้งแรกที่มีข้อความจากกลุ่มนั้น
  // เข้ามา (ดู lineWebhook.routes.js) ไม่ต้องตั้งค่าเอง ใช้ตารางแยกแทนเพิ่มคอลัมน์
  // แคตตาล็อกราคาอะไหล่ตามยี่ห้อ+รุ่นรถ สำหรับฟีเจอร์เสนอราคา — เลือก
  // ยี่ห้อ → รุ่น → อะไหล่ แล้วราคาเด้งขึ้นมาเอง (ดู quotePartPrices.routes.js)
  // แยกจากตาราง products เดิม (ต้นทุนภายใน ไม่มีคอลัมน์รุ่นรถ) โดยตั้งใจ กัน
  // ปนกับข้อมูลต้นทุนที่มีอยู่แล้ว image_data เก็บเป็น base64 data URI ตรงๆ
  // แบบเดียวกับ customer_signature (ระบบนี้ยังไม่มี file-upload pipeline)
  await conn.query(`
    CREATE TABLE IF NOT EXISTS quote_part_prices (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      brand VARCHAR(100) NOT NULL,
      model VARCHAR(100) NOT NULL,
      part_name VARCHAR(255) NOT NULL,
      description VARCHAR(500) DEFAULT NULL,
      price DECIMAL(10,2) NOT NULL DEFAULT 0,
      image_data LONGTEXT DEFAULT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_quote_part_brand_model (brand, model)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // uniq_quote_part กัน import_quote_parts_for_all_models.js สร้างแถวซ้ำถ้ารันซ้ำ
  // (ใช้ INSERT IGNORE ยึดคีย์นี้) — ปลอดภัยที่จะรันซ้ำทุกครั้งที่บูตแบบ
  // ignoreIfAlreadyApplied เพราะถ้ามีข้อมูลซ้ำอยู่ก่อนแล้ว (ไม่ควรมี แต่กันไว้)
  // จะได้ error คนละแบบ (ER_DUP_ENTRY) ซึ่งไม่ควรเงียบไว้ ต้องแก้ข้อมูลก่อน
  await conn.query(`
    ALTER TABLE quote_part_prices
    ADD UNIQUE KEY uniq_quote_part (brand, model, part_name)
  `).catch(ignoreIfAlreadyApplied);

  // needs_price: แถวที่ import_quote_parts_for_all_models.js สร้างให้อัตโนมัติ
  // ทุกรุ่นรถ (ราคาเริ่มต้น 0 เพราะไม่มีราคาจริงในไฟล์ต้นทาง) ใช้ flag นี้เตือน
  // หน้าคีออส/หน้าจัดการไม่ให้เผลอเสนอราคา 0 บาทให้ลูกค้าจริงก่อนแก้ราคา — แถวที่
  // ออฟฟิศพิมพ์ราคาเองจากหน้าเว็บ (POST /quote-parts ปกติ) จะไม่ติด flag นี้
  await conn.query(`
    ALTER TABLE quote_part_prices
    ADD COLUMN needs_price TINYINT(1) NOT NULL DEFAULT 0
  `).catch(ignoreIfAlreadyApplied);

  // แคตตาล็อกอ้างอิงยี่ห้อ+รุ่นรถมาตรฐาน (นำเข้าจากไฟล์ Excel ที่เจ้าของร้าน
  // เตรียมมา — ดู backend/scripts/import_vehicle_models.js) ใช้เป็นตัวเลือก
  // ยี่ห้อ/รุ่นในหน้าเสนอราคา (ทั้งตอนเลือกยี่ห้อ→รุ่นในหน้าคีออส และตอนกรอกราคา
  // อะไหล่ในหน้าจัดการ) แทนการพิมพ์เอง กันข้อความยี่ห้อ/รุ่นสะกดไม่ตรงกันระหว่าง
  // สองหน้า ซึ่งจะทำให้ค้นหาราคาอะไหล่ไม่เจอ — ตารางนี้เป็นข้อมูลอ้างอิงล้วนๆ
  // ไม่ผูก FK กับ quote_part_prices (ซึ่งเก็บ brand/model เป็น snapshot ข้อความ
  // ธรรมดา ไม่ใช่ FK) เพราะราคาที่กรอกไปแล้วต้องไม่หายไปแม้จะแก้/ลบรายการอ้างอิงนี้
  await conn.query(`
    CREATE TABLE IF NOT EXISTS vehicle_models (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      brand VARCHAR(100) NOT NULL,
      model VARCHAR(150) NOT NULL,
      year_range VARCHAR(50) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_vehicle_model (brand, model, year_range),
      INDEX idx_vehicle_model_brand (brand)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // staff_signature/staff_name: ลายเซ็นฝั่ง "ผู้เสนอราคา" (พนักงาน) คู่กับ
  // customer_signature ที่มีอยู่แล้ว (ลายเซ็นลูกค้า) — เก็บเป็น base64 PNG
  // data URI แบบเดียวกัน วาดสดผ่าน SignatureModal ตัวเดิม
  await conn.query(`
    ALTER TABLE quotations
    ADD COLUMN staff_signature LONGTEXT DEFAULT NULL,
    ADD COLUMN staff_name VARCHAR(100) DEFAULT NULL
  `).catch(ignoreIfAlreadyApplied);

  // ในตารางอื่นเพราะเป็น config ระดับระบบ ไม่ผูกกับ entity ไหนโดยเฉพาะ
  await conn.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      \`key\` VARCHAR(100) PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
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