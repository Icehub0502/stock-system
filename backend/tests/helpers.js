const jwt = require('jsonwebtoken');
const pool = require('../src/db/pool');

async function getOfficeToken() {
  const [[user]] = await pool.query("SELECT id, username, role FROM users WHERE role = 'office' AND shop_id = 1 LIMIT 1");
  return jwt.sign({ id: user.id, username: user.username, role: user.role, shop_id: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function getTechnicianToken() {
  const [[user]] = await pool.query("SELECT id, username, role FROM users WHERE role = 'technician' AND shop_id = 1 LIMIT 1");
  return jwt.sign({ id: user.id, username: user.username, role: user.role, shop_id: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

// requireOwner (middleware/auth.js) เช็คเฉพาะ username === 'ice' ตรง ๆ ไม่ผูกกับ role
// เลย — เทสต์หน้าตั้งค่า/endpoint ที่จำกัดเฉพาะเจ้าของร้านต้องมี user ชื่อนี้จริงใน DB
// ทดสอบ (ปกติมีแค่ admin/tech1 จาก seed) จึงสร้างขึ้นเองแบบ idempotent (INSERT IGNORE)
async function getOwnerToken() {
  await pool.execute(
    "INSERT IGNORE INTO users (username, password_hash, full_name, role) VALUES ('ice', 'x', 'Test Owner', 'office')"
  );
  const [[user]] = await pool.query("SELECT id, username, role FROM users WHERE username = 'ice' AND shop_id = 1 LIMIT 1");
  return jwt.sign({ id: user.id, username: user.username, role: user.role, shop_id: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
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

// A second shop for cross-shop isolation tests: a shops row + one office user in it + a token for that
// user. Everything the test creates in the shop must be removed by the test; dropShop then deletes the
// leftovers of the shop itself (users, settings) and the shop row.
async function createShop() {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const [shop] = await pool.query('INSERT INTO shops (code, name) VALUES (?, ?)', [`t${suffix}`, `Test shop ${suffix}`]);
  const shopId = shop.insertId;
  const [user] = await pool.query(
    "INSERT INTO users (shop_id, username, password_hash, full_name, role) VALUES (?, 'office', 'x', 'Shop B office', 'office')",
    [shopId]
  );
  const token = jwt.sign(
    { id: user.insertId, username: 'office', role: 'office', shop_id: shopId },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  // owner = username 'ice' (requireOwner) — each shop has its own 'ice' for settings / users / technicians
  const [owner] = await pool.query(
    "INSERT INTO users (shop_id, username, password_hash, full_name, role) VALUES (?, 'ice', 'x', 'Shop B owner', 'office')",
    [shopId]
  );
  const ownerToken = jwt.sign(
    { id: owner.insertId, username: 'ice', role: 'office', shop_id: shopId },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  return { shopId, userId: user.insertId, token, ownerToken, ownerUserId: owner.insertId };
}

async function dropShop(shopId) {
  // children of rows that tests may leave behind are removed by the FK cascades; rows with RESTRICT
  // FKs must already have been deleted by the test itself
  const { SHOP_TABLES } = require('../src/db/tenantSchema');
  // stock items have children (movements / positions / fitments) that must go first
  await pool.query('DELETE m FROM stock_item_movements m JOIN stock_items i ON i.id = m.item_id WHERE i.shop_id = ?', [shopId]);
  // several passes: a table may be blocked by a RESTRICT foreign key from a table deleted later in the list
  let pending = [...SHOP_TABLES];
  for (let pass = 0; pass < 4 && pending.length > 0; pass += 1) {
    const failed = [];
    for (const table of pending) {
      try {
        await pool.query(`DELETE FROM \`${table}\` WHERE shop_id = ?`, [shopId]);
      } catch (err) {
        failed.push(table);
      }
    }
    pending = failed;
  }
  await pool.query('DELETE FROM shops WHERE id = ?', [shopId]);
}

module.exports = { getOfficeToken, getTechnicianToken, getOwnerToken, createCustomerWithVehicle, cleanupCustomer, createShop, dropShop };
