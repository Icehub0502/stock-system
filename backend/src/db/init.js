const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || 3306;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'stock_system';

async function initDatabase() {
  // 1. เชื่อมต่อแบบไม่ระบุฐานข้อมูล เพื่อสร้างฐานข้อมูลให้อัตโนมัติถ้ายังไม่มีใน XAMPP/phpMyAdmin
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

  // 2. เชื่อมต่อเข้าฐานข้อมูลที่สร้างไว้ เพื่อสร้างตาราง
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
    CREATE TABLE IF NOT EXISTS transactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      rack_id INT NOT NULL,
      type ENUM('IN','OUT') NOT NULL,
      qty INT NOT NULL,
      user_id INT NOT NULL,
      note VARCHAR(255),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rack_id) REFERENCES racks(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // seed ผู้ใช้เริ่มต้น (ถ้ายังไม่มีผู้ใช้เลย)
  const [userRows] = await conn.query('SELECT COUNT(*) AS c FROM users');
  if (userRows[0].c === 0) {
    await conn.query(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
      ['admin', bcrypt.hashSync('admin123', 10), 'Office Admin', 'office']
    );
    await conn.query(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
      ['tech1', bcrypt.hashSync('tech123', 10), 'ช่าง 1', 'technician']
    );
    console.log('[init-db] สร้างผู้ใช้เริ่มต้น: admin/admin123 (ออฟฟิส), tech1/tech123 (ช่าง)');
    console.log('[init-db] กรุณาเปลี่ยนรหัสผ่านหลังเข้าสู่ระบบครั้งแรก');
  }

  // seed ตัวอย่างรายการแร็ค (ถ้ายังไม่มีรายการเลย)
  const [rackRows] = await conn.query('SELECT COUNT(*) AS c FROM racks');
  if (rackRows[0].c === 0) {
    await conn.query(
      'INSERT INTO racks (model_code, name, stock_qty, min_stock) VALUES (?, ?, ?, ?)',
      ['RTTO5201', 'แร็ค Toyota Corolla AE100 AE112 ปี 1991-2000', 2, 1]
    );
    console.log('[init-db] เพิ่มตัวอย่างรายการแร็ค: RTTO5201');
  }

  await conn.end();
  console.log(`[init-db] เชื่อมต่อ MySQL/XAMPP สำเร็จ พร้อมใช้งาน database "${DB_NAME}"`);
}

module.exports = initDatabase;

// อนุญาตให้รันแยกด้วยคำสั่ง: npm run init-db
if (require.main === module) {
  initDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[init-db] เชื่อมต่อ MySQL ไม่สำเร็จ:', err.message);
      console.error('[init-db] ตรวจสอบว่าเปิด XAMPP Control Panel แล้วกด Start ที่ MySQL หรือยัง และค่าใน .env ถูกต้องหรือไม่');
      process.exit(1);
    });
}
