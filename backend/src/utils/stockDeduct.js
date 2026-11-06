// Takes parts out of สต๊อกรวม, inside the caller's transaction: several positions of one item at once (a left and right
// pair), all or nothing, and never below zero. Shared by the stock deduction page and the parts of a claim.
const { positionsFor, positionLabel } = require('./stockPositions');

// lines: [{ position, qty }]. Returns { movementIds, items, total } or { status, error }.
async function deductStock(conn, { itemId, lines, note = null, vehicleModel = null, movedAt = null, claimId = null, userId, shopId }) {
  const [[item]] = await conn.execute(
    `SELECT id, description, has_sides, has_axles, has_levels, stock_qty
     FROM stock_items WHERE id = ? AND shop_id = ? AND is_active = 1 FOR UPDATE`,
    [itemId, shopId]
  );
  if (!item) return { status: 404, error: 'ไม่พบรายการนี้ในสต๊อกรวม' };
  const validPositions = positionsFor(item.has_sides, item.has_axles, item.has_levels);
  const isPositioned = validPositions.length > 0;
  for (const line of lines) {
    if (isPositioned ? !validPositions.includes(line.position) : line.position !== null) {
      return { status: 400, error: isPositioned ? 'รายการนี้แยกตำแหน่ง ต้องระบุตำแหน่งให้ถูกต้อง' : 'รายการนี้ไม่แยกตำแหน่ง' };
    }
  }

  const items = [];
  const movementIds = [];
  let total = item.stock_qty;
  for (const line of lines) {
    let before = item.stock_qty;
    if (isPositioned) {
      const [[row]] = await conn.execute(
        'SELECT qty FROM stock_item_positions WHERE item_id = ? AND position = ? FOR UPDATE',
        [itemId, line.position]
      );
      before = row ? row.qty : 0;
    }
    if (before < line.qty) {
      const where = line.position ? ` (${positionLabel(line.position)})` : '';
      return { status: 400, error: `สต๊อก "${item.description}"${where} เหลือไม่พอ (คงเหลือ ${before})` };
    }
    const after = before - line.qty;
    if (isPositioned) {
      await conn.execute('UPDATE stock_item_positions SET qty = ? WHERE item_id = ? AND position = ?', [after, itemId, line.position]);
    } else {
      total = after;
    }
    const [mv] = await conn.execute(
      `INSERT INTO stock_item_movements
         (item_id, qty_before, qty_after, reason, position, note, user_id, vehicle_model, moved_at, claim_id)
       VALUES (?, ?, ?, 'deduct', ?, ?, ?, ?, ?, ?)`,
      [itemId, before, after, line.position, note, userId, vehicleModel, movedAt, claimId]
    );
    movementIds.push(mv.insertId);
    items.push({ position: line.position, qty_after: after });
  }
  if (isPositioned) {
    const [[sum]] = await conn.execute(
      'SELECT COALESCE(SUM(qty), 0) AS total FROM stock_item_positions WHERE item_id = ?',
      [itemId]
    );
    total = Number(sum.total);
  }
  await conn.execute('UPDATE stock_items SET stock_qty = ? WHERE id = ? AND shop_id = ?', [total, itemId, shopId]);
  return { movementIds, items, total };
}

module.exports = { deductStock };
