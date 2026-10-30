// Expenses on the owner page come from the accounting program's database, read only: this month against the last, what the
// owner leaves out (parts bought are already the cost of goods), and the page keeps working when that database is missing.
const request = require('supertest');
const pool = require('../src/db/pool');
const { createApp } = require('../src/app');
const { createShop, dropShop } = require('./helpers');
const { buildExpenses } = require('../src/routes/ownerStats.routes');
const { resetAccountingPool } = require('../src/utils/accountingDb');

const app = createApp();
const as = (token) => ({ Authorization: `Bearer ${token}` });
const TEST_DB = 'champ_accounting_test';
const saved = {};

let shop;

function isoDate(offsetMonths, day) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, day));
  return d.toISOString().slice(0, 10);
}
const today = () => new Date().toISOString().slice(0, 10);

async function useAccounting(env) {
  ['ACCOUNTING_DB_USER', 'ACCOUNTING_DB_PASSWORD', 'ACCOUNTING_DB_NAME', 'ACCOUNTING_DB_HOST'].forEach((k) => {
    if (!(k in saved)) saved[k] = process.env[k];
    if (env && env[k] !== undefined) process.env[k] = env[k];
    else delete process.env[k];
  });
  await resetAccountingPool();
}
const readableEnv = (name = TEST_DB) => ({
  ACCOUNTING_DB_USER: process.env.DB_USER || 'root',
  ACCOUNTING_DB_PASSWORD: process.env.DB_PASSWORD || '',
  ACCOUNTING_DB_NAME: name,
});
const summary = () => request(app).get('/api/owner-stats/summary').set(as(shop.ownerToken));

beforeAll(async () => {
  shop = await createShop();
  await pool.query(`CREATE DATABASE IF NOT EXISTS \`${TEST_DB}\``);
  await pool.query(`CREATE TABLE IF NOT EXISTS \`${TEST_DB}\`.categories (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, type VARCHAR(10) NOT NULL)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS \`${TEST_DB}\`.entries (id INT AUTO_INCREMENT PRIMARY KEY, entry_date DATE NOT NULL, type VARCHAR(10) NOT NULL, category_id INT DEFAULT NULL, amount DECIMAL(12,2) NOT NULL, deleted_at DATETIME DEFAULT NULL)`);
  await pool.query(`DELETE FROM \`${TEST_DB}\`.entries`);
  await pool.query(`DELETE FROM \`${TEST_DB}\`.categories`);
  const cat = async (name, type) => (await pool.query(`INSERT INTO \`${TEST_DB}\`.categories (name, type) VALUES (?, ?)`, [name, type]))[0].insertId;
  const rent = await cat('ค่าเช่า', 'expense');
  const parts = await cat('ซื้ออะไหล่', 'expense');
  const sales = await cat('ขายอะไหล่', 'income');
  const add = (date, type, category, amount, deleted = null) => pool.query(
    `INSERT INTO \`${TEST_DB}\`.entries (entry_date, type, category_id, amount, deleted_at) VALUES (?, ?, ?, ?, ?)`,
    [date, type, category, amount, deleted]
  );
  await add(today(), 'expense', rent, 10000);
  await add(today(), 'expense', parts, 5000);
  await add(today(), 'expense', rent, 999, '2026-01-01 00:00:00'); // deleted in the accounting program: not counted
  await add(today(), 'income', sales, 77777); // income is not an expense
  await add(isoDate(-1, 1), 'expense', rent, 10000);
  await add(isoDate(-1, 28), 'expense', parts, 3000);
});

afterAll(async () => {
  await useAccounting(null);
  Object.entries(saved).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  await resetAccountingPool();
  await pool.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
  await dropShop(shop.shopId);
  await pool.end();
});

describe('building the expense figures', () => {
  const rows = [
    { month: '2026-10', category: 'ค่าเช่า', total: 10000, upto_total: 10000 },
    { month: '2026-10', category: 'ซื้ออะไหล่', total: 5000, upto_total: 5000 },
    { month: '2026-09', category: 'ค่าเช่า', total: 10000, upto_total: 10000 },
    { month: '2026-09', category: 'ซื้ออะไหล่', total: 3000, upto_total: 0 },
  ];

  test('this month against the last, the left-out categories do not count, net profit follows', () => {
    const e = buildExpenses({ available: true, rows }, ['ซื้ออะไหล่'], '2026-10-15', 40000);
    expect(e).toMatchObject({ available: true, month_total: 10000, previous_month_total: 10000, previous_month_same_days_total: 10000, net_profit_month: 30000 });
    expect(e.by_category).toEqual([
      { category: 'ค่าเช่า', total: 10000, excluded: false },
      { category: 'ซื้ออะไหล่', total: 5000, excluded: true },
    ]);
    expect(e.series).toHaveLength(12);
    expect(e.series[11]).toEqual({ month: '2026-10', total: 10000 });
    expect(e.all_categories).toEqual(['ซื้ออะไหล่', 'ค่าเช่า'].sort());
  });

  test('nothing left out counts everything; no known cost of parts means no net profit', () => {
    const e = buildExpenses({ available: true, rows }, [], '2026-10-15', null);
    expect(e.month_total).toBe(15000);
    expect(e.net_profit_month).toBeNull();
  });

  test('an unavailable accounting database is passed on as unavailable', () => {
    expect(buildExpenses({ available: false, reason: 'unreachable' }, [], '2026-10-15', null)).toEqual({ available: false, reason: 'unreachable' });
  });
});

describe('owner expenses through the API', () => {
  test('not configured: the page works and says why there are no expenses', async () => {
    await useAccounting(null);
    const res = await summary();
    expect(res.status).toBe(200);
    expect(res.body.data.expenses).toEqual({ available: false, reason: 'not_configured' });
    expect(res.body.data.periods.today).toBeDefined();
  });

  test('read from the accounting database: deleted entries and income left out, last month alongside', async () => {
    await useAccounting(readableEnv());
    const { expenses } = (await summary()).body.data;
    expect(expenses.available).toBe(true);
    expect(expenses.month_total).toBe(15000);
    expect(expenses.previous_month_total).toBe(13000);
    expect(expenses.series[11].total).toBe(15000);
    expect(expenses.all_categories).toEqual(['ซื้ออะไหล่', 'ค่าเช่า'].sort());
  });

  test('the owner chooses what does not count; managers cannot change it', async () => {
    await useAccounting(readableEnv());
    expect((await request(app).put('/api/owner-stats/expense-settings').set(as(shop.managerToken)).send({ excluded: ['ซื้ออะไหล่'] })).status).toBe(403);
    expect((await request(app).put('/api/owner-stats/expense-settings').set(as(shop.ownerToken)).send({ excluded: 'x' })).status).toBe(400);
    const saved1 = await request(app).put('/api/owner-stats/expense-settings').set(as(shop.ownerToken)).send({ excluded: ['ซื้ออะไหล่', ' ซื้ออะไหล่ '] });
    expect(saved1.body.excluded).toEqual(['ซื้ออะไหล่']);
    const { expenses } = (await summary()).body.data;
    expect(expenses.month_total).toBe(10000);
    expect(expenses.previous_month_total).toBe(10000);
    expect(expenses.excluded).toEqual(['ซื้ออะไหล่']);
    expect(expenses.by_category.find((c) => c.category === 'ซื้ออะไหล่').excluded).toBe(true);
  });

  test('the accounting database cannot be reached: the page still works', async () => {
    await useAccounting(readableEnv('no_such_accounting_db'));
    const res = await summary();
    expect(res.status).toBe(200);
    expect(res.body.data.expenses).toEqual({ available: false, reason: 'unreachable' });
  });
});
