// Helpers for per-shop (tenant) isolation. Every route filters its queries with req.shopId (set by
// middleware/auth.js from the logged-in user's token); these cover the cases a plain "AND shop_id = ?"
// does not: ids sent by the client that must belong to the same shop before they are stored.
const pool = require('../db/pool');
const { SHOP_TABLES } = require('../db/tenantSchema');

const OWNED = new Set(SHOP_TABLES);

// true when row `id` of `table` belongs to `shopId`. table must be a shop-owned table (never user input).
async function ownsRow(conn, table, id, shopId) {
  if (!OWNED.has(table)) throw new Error(`ownsRow: ${table} is not a shop table`);
  if (id === null || id === undefined || id === '') return false;
  const [rows] = await (conn || pool).query(`SELECT 1 FROM \`${table}\` WHERE id = ? AND shop_id = ? LIMIT 1`, [id, shopId]);
  return rows.length > 0;
}

// every id in `ids` (ignoring null/empty) belongs to `shopId`
async function ownsAll(conn, table, ids, shopId) {
  const wanted = [...new Set((ids || []).filter((x) => x !== null && x !== undefined && x !== '').map(Number))];
  if (wanted.length === 0) return true;
  if (!OWNED.has(table)) throw new Error(`ownsAll: ${table} is not a shop table`);
  const [rows] = await (conn || pool).query(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE shop_id = ? AND id IN (?)`, [shopId, wanted]);
  return Number(rows[0].n) === wanted.length;
}

// Public pages (track / board) have no login. The shop is named by ?shop=<shop code>; without it they
// serve shop 1 (the links printed before the platform had several shops). Returns the shop id or null
// when the code does not match an active shop.
async function resolvePublicShopId(req) {
  const code = String(req.query?.shop ?? '').trim().toLowerCase();
  if (!code) return 1;
  const [rows] = await pool.query("SELECT id FROM shops WHERE code = ? AND status = 'active'", [code]);
  return rows[0]?.id ?? null;
}

module.exports = { ownsRow, ownsAll, resolvePublicShopId };
