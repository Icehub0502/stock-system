const jwt = require('jsonwebtoken');
const pool = require('../src/db/pool');

// The middleware trusts the role inside the token, so tests sign tokens with the role they need for
// a real shop-1 user (the test database's users keep whatever role the role migration gave them).
async function signShop1Token(role, username) {
  const [[user]] = await pool.query(
    username
      ? 'SELECT id, username FROM users WHERE username = ? AND shop_id = 1 LIMIT 1'
      : "SELECT id, username FROM users WHERE role <> 'technician' AND shop_id = 1 ORDER BY id LIMIT 1",
    username ? [username] : []
  );
  return jwt.sign({ id: user.id, username: user.username, role, shop_id: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function getOfficeToken() {
  return signShop1Token('office');
}

async function getManagerToken() {
  return signShop1Token('manager');
}

async function getTechnicianToken() {
  const [[user]] = await pool.query("SELECT id, username, role FROM users WHERE role = 'technician' AND shop_id = 1 LIMIT 1");
  return jwt.sign({ id: user.id, username: user.username, role: user.role, shop_id: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

// Shop owner: needs a real user row (user-management tests look themselves up), created idempotently.
async function getOwnerToken() {
  await pool.execute(
    "INSERT IGNORE INTO users (username, password_hash, full_name, role) VALUES ('shopowner', 'x', 'Test Owner', 'owner')"
  );
  return signShop1Token('owner', 'shopowner');
}

async function getDevToken() {
  await pool.execute(
    "INSERT IGNORE INTO users (username, password_hash, full_name, role) VALUES ('devtest', 'x', 'Test Dev', 'dev')"
  );
  return signShop1Token('dev', 'devtest');
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
  // owner of the shop: user accounts, settings, technicians
  const [owner] = await pool.query(
    "INSERT INTO users (shop_id, username, password_hash, full_name, role) VALUES (?, 'shopowner', 'x', 'Shop B owner', 'owner')",
    [shopId]
  );
  const ownerToken = jwt.sign(
    { id: owner.insertId, username: 'shopowner', role: 'owner', shop_id: shopId },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  // manager token reuses the office user row (a token is only a signed claim of the role)
  const managerToken = jwt.sign(
    { id: user.insertId, username: 'office', role: 'manager', shop_id: shopId },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  return { shopId, userId: user.insertId, token, managerToken, ownerToken, ownerUserId: owner.insertId };
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
  await pool.query('DELETE FROM deleted_records WHERE shop_id = ?', [shopId]);
  await pool.query('DELETE FROM shops WHERE id = ?', [shopId]);
}

module.exports = { getOfficeToken, getManagerToken, getTechnicianToken, getOwnerToken, getDevToken, createCustomerWithVehicle, cleanupCustomer, createShop, dropShop };
