// Read-only window on the accounting program (champ-accounting, its own database, its own login).
//
// The stock system only ever READS the expense entries from it, through a separate connection with its own MySQL user
// that has SELECT on the two tables it needs (see .env.example). Nothing is written, nothing else is touched, and when the
// accounting database is not configured, is down, or its tables change, the caller gets { available: false } and the owner
// page simply shows no expenses: the stock system never depends on it to work.
const mysql = require('mysql2/promise');

let pool = null;

function settings() {
  const user = process.env.ACCOUNTING_DB_USER;
  if (!user) return null;
  return {
    host: process.env.ACCOUNTING_DB_HOST || process.env.DB_HOST || 'localhost',
    port: Number(process.env.ACCOUNTING_DB_PORT || process.env.DB_PORT) || 3306,
    user,
    password: process.env.ACCOUNTING_DB_PASSWORD || '',
    database: process.env.ACCOUNTING_DB_NAME || 'champ_accounting',
  };
}

function getPool() {
  if (pool) return pool;
  const s = settings();
  if (!s) return null;
  pool = mysql.createPool({ ...s, waitForConnections: true, connectionLimit: 2, connectTimeout: 3000, dateStrings: true });
  return pool;
}

// closes the pool so the next call reads the settings again (used by the tests)
async function resetAccountingPool() {
  if (pool) await pool.end().catch(() => {});
  pool = null;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('accounting database timed out')), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Expense totals per month and category (deleted entries left out) from `from` to `to` (YYYY-MM-DD):
//   [{ month: 'YYYY-MM', category, total, upto_total }]
// upto_total = the part dated on day `uptoDay` of the month or earlier, to compare a running month with the last one.
async function loadExpenseRows({ from, to, uptoDay }) {
  const db = getPool();
  if (!db) return { available: false, reason: 'not_configured' };
  try {
    const [rows] = await withTimeout(db.query(
      `SELECT DATE_FORMAT(e.entry_date, '%Y-%m') AS month, COALESCE(c.name, 'ไม่ระบุหมวด') AS category,
              COALESCE(SUM(e.amount), 0) AS total,
              COALESCE(SUM(CASE WHEN DAY(e.entry_date) <= ? THEN e.amount ELSE 0 END), 0) AS upto_total
       FROM entries e LEFT JOIN categories c ON c.id = e.category_id
       WHERE e.type = 'expense' AND e.deleted_at IS NULL AND e.entry_date BETWEEN ? AND ?
       GROUP BY month, category`,
      [uptoDay, from, to]
    ), 5000);
    return {
      available: true,
      rows: rows.map((r) => ({ month: r.month, category: r.category, total: Number(r.total), upto_total: Number(r.upto_total) })),
    };
  } catch (err) {
    console.error('accounting database not readable:', err.message);
    return { available: false, reason: 'unreachable' };
  }
}

module.exports = { loadExpenseRows, resetAccountingPool };
