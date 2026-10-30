// What an item costs: the average of the lines received for it that have a cost, weighted by quantity.
// Lines without a cost are ignored; when no line has a cost the manual cost (typed by hand) is used, and when that is
// missing too the item has no cost (null). Called whenever a received line gets its cost or a bill is closed.
async function recomputeItemCost(conn, itemId, shopId) {
  const [[row]] = await conn.query(
    `SELECT SUM(l.qty * l.unit_cost) AS total, SUM(l.qty) AS qty
     FROM stock_receive_lines l JOIN receipt_sessions s ON s.id = l.receipt_session_id
     WHERE l.item_id = ? AND s.shop_id = ? AND l.applied_at IS NOT NULL AND l.unit_cost IS NOT NULL`,
    [itemId, shopId]
  );
  const qty = Number(row.qty) || 0;
  if (qty > 0) {
    await conn.query('UPDATE stock_items SET avg_cost = ? WHERE id = ? AND shop_id = ?', [Math.round((Number(row.total) / qty) * 100) / 100, itemId, shopId]);
  } else {
    await conn.query('UPDATE stock_items SET avg_cost = manual_cost WHERE id = ? AND shop_id = ?', [itemId, shopId]);
  }
}

// price per piece from client input: null when empty, NaN-safe, never negative
function parseUnitCost(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 10000000) return { error: 'ต้นทุนต่อชิ้นไม่ถูกต้อง' };
  return { value: Math.round(n * 100) / 100 };
}

module.exports = { recomputeItemCost, parseUnitCost };
