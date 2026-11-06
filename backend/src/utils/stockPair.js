// Joining two stock items entered separately for the left and right of one part into one item split left/right, and
// undoing that. Nothing is lost either way: the quantities become the two positions, and the history and bill lines of
// both items move across with their side. The right-hand item is only hidden, and remembers where it went
// (merged_into_id), which is what makes the undo possible. Everything runs in the caller's transaction.
const { recomputeItemCost } = require('./stockCost');
const { findPairs } = require('./scanPairs');

// The word for a side in a description is not part of the part's name
const SIDE_WORDS_RE = /(ข้าง)?(ซ้าย|ขวา)|\b(LH|RH|L|R)\b/gi;

function withoutSideWords(description) {
  return String(description ?? '').replace(SIDE_WORDS_RE, ' ').replace(/[\s()\-/]+$/g, '').replace(/\s+/g, ' ').trim();
}

// the side a description names, or null when it names none or both
function sideInDescription(description) {
  const text = String(description ?? '');
  const left = /ซ้าย|\bLH\b/i.test(text);
  const right = /ขวา|\bRH\b/i.test(text);
  if (left === right) return null;
  return left ? 'left' : 'right';
}

// Pairs worth suggesting among plain items: by the code first (JET-1L / JET-1R), then by a description that differs only
// by the side. Only within one category. rows: { id, category_id, oem_code, description }.
function suggestPairs(rows) {
  const pairs = [];
  const used = new Set();
  const byCategory = new Map();
  rows.forEach((row) => {
    if (!byCategory.has(row.category_id)) byCategory.set(row.category_id, []);
    byCategory.get(row.category_id).push(row);
  });
  for (const group of byCategory.values()) {
    const byCode = new Map(group.map((row) => [row.oem_code, row]));
    for (const pair of findPairs(group.map((row) => row.oem_code)).pairs) {
      const left = byCode.get(pair.left);
      const right = byCode.get(pair.right);
      used.add(left.id);
      used.add(right.id);
      pairs.push({ left, right, reason: 'code' });
    }
    const byName = new Map();
    for (const row of group) {
      if (used.has(row.id)) continue;
      const side = sideInDescription(row.description);
      const name = withoutSideWords(row.description);
      if (!side || !name) continue;
      if (!byName.has(name)) byName.set(name, { left: [], right: [] });
      byName.get(name)[side].push(row);
    }
    for (const { left, right } of byName.values()) {
      // more than one candidate on a side is a guess, and a wrong join is worse than a missing suggestion
      if (left.length === 1 && right.length === 1) pairs.push({ left: left[0], right: right[0], reason: 'description' });
    }
  }
  return pairs;
}

// Returns { itemId, hiddenId } or { status, error }
async function pairItems(conn, { leftId, rightId, description, shopId }) {
  if (leftId === rightId) return { status: 400, error: 'เลือกคนละรายการ' };
  const [rows] = await conn.query(
    `SELECT id, oem_code, description, stock_qty, has_sides, has_axles, has_levels, is_active, manual_cost
     FROM stock_items WHERE id IN (?) AND shop_id = ? ORDER BY id FOR UPDATE`,
    [[leftId, rightId], shopId]
  );
  const left = rows.find((row) => row.id === leftId);
  const right = rows.find((row) => row.id === rightId);
  if (!left || !right || !left.is_active || !right.is_active) return { status: 404, error: 'ไม่พบรายการที่เลือก' };
  if ([left, right].some((row) => row.has_sides || row.has_axles || row.has_levels)) {
    return { status: 400, error: 'จับคู่ได้เฉพาะรายการที่ยังไม่แยกตำแหน่ง' };
  }

  for (const table of ['stock_item_movements', 'stock_receive_lines']) {
    await conn.query(`UPDATE ${table} SET position = 'left' WHERE item_id = ? AND position IS NULL`, [left.id]);
    await conn.query(`UPDATE ${table} SET item_id = ?, position = 'right' WHERE item_id = ?`, [left.id, right.id]);
  }
  await conn.query(
    `INSERT INTO stock_item_positions (item_id, position, qty, oem_code) VALUES (?, 'left', ?, ?), (?, 'right', ?, ?)`,
    [left.id, left.stock_qty, left.oem_code, left.id, right.stock_qty, right.oem_code]
  );
  // the car models of both sides; a model both already list stays once
  await conn.query(
    `INSERT INTO stock_item_fitments (item_id, brand, model, year_from, year_to)
     SELECT ?, f.brand, f.model, f.year_from, f.year_to FROM stock_item_fitments f
     WHERE f.item_id = ? AND NOT EXISTS (
       SELECT 1 FROM stock_item_fitments x
       WHERE x.item_id = ? AND x.brand = f.brand AND x.model = f.model AND x.year_from <=> f.year_from AND x.year_to <=> f.year_to
     )`,
    [left.id, right.id, left.id]
  );
  await conn.query(
    `UPDATE stock_items SET has_sides = 1, stock_qty = ?, description = ?, pre_pair_description = ?, manual_cost = COALESCE(manual_cost, ?)
     WHERE id = ? AND shop_id = ?`,
    [left.stock_qty + right.stock_qty, description, left.description, right.manual_cost, left.id, shopId]
  );
  await conn.query('UPDATE stock_items SET is_active = 0, stock_qty = 0, merged_into_id = ? WHERE id = ? AND shop_id = ?', [left.id, right.id, shopId]);
  await recomputeItemCost(conn, left.id, shopId);
  return { itemId: left.id, hiddenId: right.id };
}

// Back to two items, each with what its side holds now, including anything received or used since they were joined.
// Returns { itemId, restoredId } or { status, error }
async function unpairItem(conn, { itemId, shopId }) {
  const [[item]] = await conn.query(
    'SELECT id, oem_code, description, pre_pair_description FROM stock_items WHERE id = ? AND shop_id = ? AND is_active = 1 FOR UPDATE',
    [itemId, shopId]
  );
  if (!item) return { status: 404, error: 'ไม่พบรายการ' };
  const [[hidden]] = await conn.query(
    'SELECT id, oem_code FROM stock_items WHERE merged_into_id = ? AND shop_id = ? FOR UPDATE',
    [itemId, shopId]
  );
  if (!hidden) return { status: 400, error: 'รายการนี้ไม่ได้เกิดจากการจับคู่ จึงแยกไม่ได้' };

  const [positions] = await conn.query('SELECT position, qty, oem_code FROM stock_item_positions WHERE item_id = ? FOR UPDATE', [itemId]);
  const leftRow = positions.find((row) => row.position === 'left');
  const rightRow = positions.find((row) => row.position === 'right');
  if (!leftRow || !rightRow) return { status: 400, error: 'รายการนี้ไม่ได้แยกซ้าย/ขวาแล้ว จึงแยกไม่ได้' };

  for (const table of ['stock_item_movements', 'stock_receive_lines']) {
    await conn.query(`UPDATE ${table} SET item_id = ?, position = NULL WHERE item_id = ? AND position = 'right'`, [hidden.id, itemId]);
    await conn.query(`UPDATE ${table} SET position = NULL WHERE item_id = ? AND position = 'left'`, [itemId]);
  }
  await conn.query('DELETE FROM stock_item_positions WHERE item_id = ?', [itemId]);
  await conn.query(
    `UPDATE stock_items SET has_sides = 0, stock_qty = ?, oem_code = ?, description = COALESCE(pre_pair_description, description), pre_pair_description = NULL
     WHERE id = ? AND shop_id = ?`,
    [leftRow.qty, leftRow.oem_code || item.oem_code, itemId, shopId]
  );
  await conn.query(
    'UPDATE stock_items SET is_active = 1, stock_qty = ?, oem_code = ?, merged_into_id = NULL WHERE id = ? AND shop_id = ?',
    [rightRow.qty, rightRow.oem_code || hidden.oem_code, hidden.id, shopId]
  );
  await recomputeItemCost(conn, itemId, shopId);
  await recomputeItemCost(conn, hidden.id, shopId);
  return { itemId, restoredId: hidden.id };
}

module.exports = { suggestPairs, pairItems, unpairItem, withoutSideWords, sideInDescription };
