// Creating a stock item (สต๊อกรวม) — shared by the สต๊อกรวม page (POST /stock-items) and the scan page,
// where a code that is not in stock yet can be added straight into a receipt bill
// (POST /stock-receive/new-item). Both must apply the same rules, so they live here.
const { positionsFor } = require('./stockPositions');

const MAX_QTY = 1000000;
const MIN_YEAR = 1950;
const MAX_YEAR = 2100;

// whole number in min..MAX_QTY, or null
function parseQty(value, min = 0) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= MAX_QTY ? n : null;
}

function cleanText(value, maxLen) {
  return String(value ?? '').trim().slice(0, maxLen);
}

// รหัส OEM ของแต่ละตำแหน่ง ({ position: code }) — ว่าง = NULL (ยังไม่ทราบรหัส)
function parseCodes(raw, positions) {
  const codes = {};
  for (const position of positions) {
    codes[position] = cleanText(raw ? raw[position] : '', 100) || null;
  }
  return codes;
}

// รหัสหลักของชิ้น = รหัสแรกที่มีค่าตามลำดับตำแหน่ง (ใช้เป็นกุญแจไม่ซ้ำในหมวด + ค้นหา)
// ไม่มีรหัสตำแหน่งเลยก็ใช้ oem_code ที่ส่งมาตรง ๆ แทน (fallback)
function primaryCode(positions, codes, fallback) {
  for (const position of positions) {
    if (codes[position]) return codes[position];
  }
  return fallback;
}

// อ่านยอดแต่ละตำแหน่งจากข้อมูลที่ส่งมา ({ position: qty }) — ตำแหน่งที่ไม่ส่ง = 0
// คืน { stocks } หรือ { error }
function parseStocks(raw, positions) {
  const stocks = {};
  for (const position of positions) {
    const value = raw && raw[position] !== undefined ? parseQty(raw[position]) : 0;
    if (value === null) return { error: 'จำนวนต้องเป็นเลขจำนวนเต็มตั้งแต่ 0 ขึ้นไป' };
    stocks[position] = value;
  }
  return { stocks };
}

// ตรวจรายการรุ่นรถที่ส่งมา — คืน { fitments } ที่ทำความสะอาดแล้ว หรือ { error }
function parseFitments(raw) {
  if (raw === undefined || raw === null) return { fitments: [] };
  if (!Array.isArray(raw) || raw.length > 100) return { error: 'ข้อมูลรุ่นรถไม่ถูกต้อง' };
  const seen = new Set();
  const fitments = [];
  for (const row of raw) {
    const brand = cleanText(row?.brand, 100);
    const model = cleanText(row?.model, 100);
    if (!brand || !model) return { error: 'รุ่นรถทุกแถวต้องมียี่ห้อและรุ่น' };
    const yearFrom = row.year_from === '' || row.year_from == null ? null : Number(row.year_from);
    const yearTo = row.year_to === '' || row.year_to == null ? null : Number(row.year_to);
    for (const y of [yearFrom, yearTo]) {
      if (y !== null && (!Number.isInteger(y) || y < MIN_YEAR || y > MAX_YEAR)) {
        return { error: `ปีรถต้องเป็นเลข ค.ศ. ระหว่าง ${MIN_YEAR}-${MAX_YEAR}` };
      }
    }
    if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
      return { error: 'ปีเริ่มต้องไม่มากกว่าปีสิ้นสุด' };
    }
    const key = `${brand.toLowerCase()}|${model.toLowerCase()}|${yearFrom}|${yearTo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fitments.push({ brand, model, year_from: yearFrom, year_to: yearTo });
  }
  return { fitments };
}

async function replaceFitments(conn, itemId, fitments) {
  await conn.execute('DELETE FROM stock_item_fitments WHERE item_id = ?', [itemId]);
  for (const f of fitments) {
    await conn.execute(
      'INSERT INTO stock_item_fitments (item_id, brand, model, year_from, year_to) VALUES (?, ?, ?, ?, ?)',
      [itemId, f.brand, f.model, f.year_from, f.year_to]
    );
  }
}

// Validates the body of a new item. Opening stock comes from body.stocks ({ position: qty }) for an item
// split by position, else body.stock_qty. Returns { item } or { error }.
function parseNewStockItem(body) {
  const categoryId = Number(body.category_id);
  const hasSides = body.has_sides === true || body.has_sides === 1;
  const hasAxles = body.has_axles === true || body.has_axles === 1;
  const hasLevels = body.has_levels === true || body.has_levels === 1;
  const minStock = body.min_stock === undefined ? 1 : parseQty(body.min_stock);
  // ของแยกตำแหน่ง: ยอดมาจาก body.stocks ({ position: qty }) แล้ว stock_qty = ผลรวม
  const positions = positionsFor(hasSides, hasAxles, hasLevels);
  const parsedStocks = parseStocks(body.stocks, positions);
  const stockQty = positions.length
    ? (parsedStocks.stocks ? Object.values(parsedStocks.stocks).reduce((a, b) => a + b, 0) : null)
    : (body.stock_qty === undefined ? 0 : parseQty(body.stock_qty));
  const codes = parseCodes(body.codes, positions);
  const oemCode = primaryCode(positions, codes, cleanText(body.oem_code, 100));
  if (!Number.isInteger(categoryId) || categoryId <= 0 || !oemCode) {
    return { error: 'กรุณาเลือกหมวดหมู่และกรอกรหัส OEM (อย่างน้อยหนึ่งตำแหน่ง)' };
  }
  if (stockQty === null || minStock === null) {
    return { error: 'จำนวนต้องเป็นเลขจำนวนเต็มตั้งแต่ 0 ขึ้นไป' };
  }
  const parsedFit = parseFitments(body.fitments);
  if (parsedFit.error) return { error: parsedFit.error };
  return {
    item: {
      categoryId,
      description: cleanText(body.description, 500),
      hasSides,
      hasAxles,
      hasLevels,
      minStock,
      positions,
      stocks: parsedStocks.stocks || {},
      stockQty,
      codes,
      oemCode,
      fitments: parsedFit.fitments,
    },
  };
}

// Inserts a parsed item inside the caller's transaction. A hidden item (is_active=0) with the same code in
// the same category is brought back instead of inserting a duplicate. createdInSessionId marks an item
// created from the scan page, so it can be hidden again if its only bill line is removed.
// Returns { itemId } or { status, error }; a duplicate code in the category throws ER_DUP_ENTRY.
async function insertStockItem(conn, { shopId, userId, item, createdInSessionId = null }) {
  const [[cat]] = await conn.execute(
    'SELECT id FROM stock_categories WHERE id = ? AND shop_id = ? AND is_active = 1',
    [item.categoryId, shopId]
  );
  if (!cat) return { status: 404, error: 'ไม่พบหมวดหมู่' };

  const flags = [item.hasSides ? 1 : 0, item.hasAxles ? 1 : 0, item.hasLevels ? 1 : 0];
  // รหัสเดิมที่เคยถูกซ่อน (is_active=0) → นำกลับมาใช้แทนการสร้างซ้ำ ไม่ชน UNIQUE
  const [[hidden]] = await conn.execute(
    'SELECT id FROM stock_items WHERE shop_id = ? AND category_id = ? AND oem_code = ? AND is_active = 0 FOR UPDATE',
    [shopId, item.categoryId, item.oemCode]
  );
  let itemId;
  if (hidden) {
    itemId = hidden.id;
    await conn.execute(
      `UPDATE stock_items SET description = ?, has_sides = ?, has_axles = ?, has_levels = ?, oem_code_right = NULL,
              stock_qty = ?, min_stock = ?, is_active = 1, created_in_session_id = ? WHERE id = ? AND shop_id = ?`,
      [item.description, ...flags, item.stockQty, item.minStock, createdInSessionId, itemId, shopId]
    );
    await conn.execute('DELETE FROM stock_item_positions WHERE item_id = ?', [itemId]);
  } else {
    const [result] = await conn.execute(
      `INSERT INTO stock_items (shop_id, category_id, oem_code, description, has_sides, has_axles, has_levels,
                                stock_qty, min_stock, created_in_session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [shopId, item.categoryId, item.oemCode, item.description, ...flags, item.stockQty, item.minStock, createdInSessionId]
    );
    itemId = result.insertId;
  }
  await replaceFitments(conn, itemId, item.fitments);
  for (const position of item.positions) {
    await conn.execute(
      'INSERT INTO stock_item_positions (item_id, position, qty, oem_code) VALUES (?, ?, ?, ?)',
      [itemId, position, item.stocks[position], item.codes[position]]
    );
  }
  const opening = item.positions.length
    ? item.positions.map((position) => [position, item.stocks[position]])
    : [[null, item.stockQty]];
  for (const [position, qty] of opening) {
    if (qty > 0) {
      await conn.execute(
        `INSERT INTO stock_item_movements (item_id, qty_before, qty_after, reason, position, user_id)
         VALUES (?, 0, ?, 'create', ?, ?)`,
        [itemId, qty, position, userId]
      );
    }
  }
  return { itemId };
}

// An item made from the scan page whose bill line was removed again (typed by mistake) is hidden, so
// สต๊อกรวม does not fill up with codes that never held anything. Only when nothing ever happened to it:
// no stock, no history, no other bill line. Runs in the caller's transaction; returns true when hidden.
async function hideUnusedScanItem(conn, itemId, shopId) {
  const [[item]] = await conn.execute(
    `SELECT i.id FROM stock_items i
     WHERE i.id = ? AND i.shop_id = ? AND i.is_active = 1 AND i.created_in_session_id IS NOT NULL AND i.stock_qty = 0
       AND NOT EXISTS (SELECT 1 FROM stock_item_movements m WHERE m.item_id = i.id)
       AND NOT EXISTS (SELECT 1 FROM stock_receive_lines l WHERE l.item_id = i.id)
     FOR UPDATE`,
    [itemId, shopId]
  );
  if (!item) return false;
  await conn.execute('UPDATE stock_items SET is_active = 0 WHERE id = ? AND shop_id = ?', [itemId, shopId]);
  return true;
}

module.exports = {
  MAX_QTY,
  parseQty,
  cleanText,
  parseCodes,
  primaryCode,
  parseFitments,
  replaceFitments,
  parseNewStockItem,
  insertStockItem,
  hideUnusedScanItem,
};
