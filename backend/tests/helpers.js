const jwt = require('jsonwebtoken');
const pool = require('../src/db/pool');

async function getOfficeToken() {
  const [[user]] = await pool.query("SELECT id, username, role FROM users WHERE role = 'office' LIMIT 1");
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function getTechnicianToken() {
  const [[user]] = await pool.query("SELECT id, username, role FROM users WHERE role = 'technician' LIMIT 1");
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

// requireOwner (middleware/auth.js) เช็คเฉพาะ username === 'ice' ตรง ๆ ไม่ผูกกับ role
// เลย — เทสต์หน้าตั้งค่า/endpoint ที่จำกัดเฉพาะเจ้าของร้านต้องมี user ชื่อนี้จริงใน DB
// ทดสอบ (ปกติมีแค่ admin/tech1 จาก seed) จึงสร้างขึ้นเองแบบ idempotent (INSERT IGNORE)
async function getOwnerToken() {
  await pool.execute(
    "INSERT IGNORE INTO users (username, password_hash, full_name, role) VALUES ('ice', 'x', 'Test Owner', 'office')"
  );
  const [[user]] = await pool.query("SELECT id, username, role FROM users WHERE username = 'ice' LIMIT 1");
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

// Creates a throwaway customer + vehicle directly in the DB (fast, and
// keeps fixture setup separate from the API behavior actually under test).
async function createCustomerWithVehicle({ namePrefix = 'Test Customer' } = {}) {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const customerCode = `TST-${suffix}`.slice(0, 20);
  const [customerResult] = await pool.execute(
    'INSERT INTO customers (customer_code, customer_name, phone) VALUES (?, ?, ?)',
    [customerCode, `${namePrefix} ${suffix}`, '0800000000']
  );
  const customerId = customerResult.insertId;

  const [vehicleResult] = await pool.execute(
    'INSERT INTO vehicles (customer_id, brand, model, color, license_plate, mileage) VALUES (?, ?, ?, ?, ?, ?)',
    [customerId, 'TestBrand', 'TestModel', 'Black', `TEST-${suffix}`, 0]
  );
  const vehicleId = vehicleResult.insertId;

  return { customerId, vehicleId, customerCode };
}

// Deletes everything a test created, in FK-safe order.
async function cleanupCustomer(customerId) {
  const [receipts] = await pool.query('SELECT id FROM receipts WHERE customer_id = ?', [customerId]);
  for (const r of receipts) {
    await pool.execute('DELETE FROM receipt_items WHERE receipt_id = ?', [r.id]);
    await pool.execute('DELETE FROM receipts WHERE id = ?', [r.id]);
  }
  const [quotations] = await pool.query('SELECT id FROM quotations WHERE customer_id = ?', [customerId]);
  for (const q of quotations) {
    await pool.execute('DELETE FROM quotation_items WHERE quotation_id = ?', [q.id]);
    await pool.execute('DELETE FROM quotations WHERE id = ?', [q.id]);
  }
  await pool.execute('DELETE FROM vehicles WHERE customer_id = ?', [customerId]);
  await pool.execute('DELETE FROM customers WHERE id = ?', [customerId]);
}

module.exports = { getOfficeToken, getTechnicianToken, getOwnerToken, createCustomerWithVehicle, cleanupCustomer };
