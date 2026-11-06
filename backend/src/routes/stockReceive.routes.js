const express = require('express');
const QRCode = require('qrcode');
const pool = require('../db/pool');
const { authenticate, requireRole, requireManager, roleRank } = require('../middleware/auth');
const { emitStockEvent, emitStockTxEvent } = require('../realtime');
const { positionsFor, positionLabel } = require('../utils/stockPositions');
const { recomputeItemCost, parseUnitCost } = require('../utils/stockCost');
const { parseQty, cleanText, parseNewStockItem, insertStockItem, hideUnusedScanItem } = require('../utils/stockItemCreate');
const { sideMarkers, likelySide, findPairs, oppositePosition, compactCode } = require('../utils/scanPairs');

// รับเข้าสต๊อกรวมตามบิล (หน้าสแกน /scan โหมดรับเข้า) + พิมพ์ QR ของสต๊อกรวม
//
// การรับเข้าเป็น 2 จังหวะ: สแกน/กรอกจำนวน = เก็บเป็น "รายการรอยืนยัน" (stock_receive_lines)
// แก้จำนวน/ลบได้ ยังไม่แตะสต๊อก → กด "เสร็จสิ้น" (commit) ถึงบวกยอดจริงทั้งบิลในทรานแซกชันเดียว
// และบันทึกเป็นประวัติ 'receive' ของแต่ละชิ้น
//
// สร้าง/แก้/ลบรายการรอยืนยัน + ยืนยัน เปิดให้เจ้าของบิลหรือ office (ช่างสแกนรับของได้เหมือนระบบเดิม)
// ส่วนยกเลิกรายการที่บวกสต๊อกไปแล้ว/ดึง QR เฉพาะ office
const router = express.Router();
router.use(authenticate);

const MAX_QTY = 1000000;
const MAX_BATCH_CODES = 200; // one round of continuous scanning, a bill is never this long

function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// หนึ่งแถวผลลัพธ์ = หนึ่งตำแหน่งที่สแกน/ค้นเจอ (ของธรรมดา position = null)
// ใช้ได้ทั้งตอนสแกน (ตรงรหัส) และค้นเอง (ตรงข้อความ)
// tenant-ok: every caller appends "WHERE i.shop_id = ? ..."
const MATCH_SELECT = `
  SELECT i.id AS item_id, c.name AS category_name, i.description, i.min_stock,
         i.has_sides, i.has_axles, i.has_levels,
         p.position, p.oem_code AS position_code, i.oem_code AS item_code,
         COALESCE(p.qty, i.stock_qty) AS qty
  FROM stock_items i
  JOIN stock_categories c ON c.id = i.category_id
  LEFT JOIN stock_item_positions p ON p.item_id = i.id
`;

function shapeMatch(row) {
  const code = row.position ? row.position_code : row.item_code;
  return {
    item_id: row.item_id,
    position: row.position || null,
    position_label: positionLabel(row.position),
    code: code || null,
    category_name: row.category_name,
    description: row.description,
    qty: Number(row.qty),
    min_stock: row.min_stock,
  };
}

// ข้อความที่ได้จากการสแกน → รหัสที่ใช้ค้นหา: ป้าย QR ของแร็คเป็นรหัสล้วน ๆ แต่ป้ายปีกนกที่ติดของไปแล้ว
// เข้ารหัสเป็น JSON ({"id":..,"sku":"..","name":".."}) ต้องแกะ sku ออกมา ไม่งั้นป้ายปีกนกเดิมทุกใบ
// สแกนไม่เจอในสต๊อกรวม (JSON อาจยาวเกิน 100 ตัวเพราะมีชื่อรายการ จึงแกะก่อนเช็คความยาว)
function extractScanCode(raw) {
  const text = String(raw ?? '').trim();
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      const code = parsed && (parsed.sku ?? parsed.model_code ?? parsed.code);
      if (typeof code === 'string' && code.trim()) return code.trim();
    } catch {
      // ไม่ใช่ JSON จริง — ใช้ข้อความเดิม
    }
  }
  return text;
}

// ค้นหาด้วยรหัสที่สแกนได้ (ตรงทั้งสตริง ไม่สนตัวพิมพ์เล็กใหญ่ตาม collation) — ป้าย QR เดิมที่ติดของ
// ไปแล้วสแกนเจอเหมือนเดิม (ทั้งแบบรหัสล้วนและแบบ JSON) ถ้ารหัสซ้ำกันหลายรายการคืนทุกตัวให้ผู้ใช้เลือก
router.get('/lookup', async (req, res) => {
  const rawCode = String(req.query.code ?? '');
  if (rawCode.length > 2000) return res.status(400).json({ error: 'รหัสไม่ถูกต้อง' });
  const code = extractScanCode(rawCode);
  if (!code || code.length > 100) return res.status(400).json({ error: 'รหัสไม่ถูกต้อง' });
  try {
    const [rows] = await pool.execute(
      `${MATCH_SELECT}
       WHERE i.shop_id = ? AND i.is_active = 1
         AND ((p.item_id IS NOT NULL AND p.oem_code = ?) OR (p.item_id IS NULL AND i.oem_code = ?))
       ORDER BY i.id, p.position
       LIMIT 20`,
      [req.shopId, code, code]
    );
    res.json({ matches: rows.map(shapeMatch) });
  } catch (err) {
    console.error('Error looking up stock code:', err);
    res.status(500).json({ error: 'ค้นหารหัสไม่สำเร็จ' });
  }
});

// ค้นเองเมื่อ QR เสีย: รหัส/รายละเอียด/รุ่นรถ (จำกัด 40 แถว)
router.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 100);
  if (q.length < 2) return res.json({ matches: [] });
  const like = `%${q}%`;
  try {
    const [rows] = await pool.execute(
      `${MATCH_SELECT}
       WHERE i.shop_id = ? AND i.is_active = 1
         AND (i.oem_code LIKE ? OR i.description LIKE ? OR p.oem_code LIKE ?
              OR EXISTS (SELECT 1 FROM stock_item_fitments f WHERE f.item_id = i.id
                         AND CONCAT(f.brand, ' ', f.model) LIKE ?))
       ORDER BY c.sort_order, i.oem_code, p.position
       LIMIT 40`,
      [req.shopId, like, like, like, like]
    );
    res.json({ matches: rows.map(shapeMatch) });
  } catch (err) {
    console.error('Error searching stock for receive:', err);
    res.status(500).json({ error: 'ค้นหาไม่สำเร็จ' });
  }
});

// บิลต้องเป็นของผู้ใช้คนนี้ (หรือผู้ใช้เป็น office) — คืนแถวบิล หรือ null
async function loadOwnedSession(conn, sessionId, user, shopId, { lock = false } = {}) {
  const [[session]] = await conn.execute(
    `SELECT id, user_id, invoice_no FROM receipt_sessions WHERE id = ? AND shop_id = ?${lock ? ' FOR UPDATE' : ''}`,
    [sessionId, shopId]
  );
  if (!session) return { status: 404, error: 'ไม่พบบิลนี้' };
  if (roleRank(user.role) < roleRank('office') && session.user_id !== user.id) return { status: 403, error: 'บิลนี้ไม่ใช่ของคุณ' };
  return { session };
}

function lineSelect(where) {
  return `SELECT l.id, l.receipt_session_id, l.item_id, l.position, l.qty, l.unit_cost, l.created_at,
                 i.description, i.stock_qty, c.name AS category_name,
                 COALESCE(p.oem_code, i.oem_code) AS code,
                 COALESCE(p.qty, i.stock_qty) AS current_qty
          FROM stock_receive_lines l
          JOIN stock_items i ON i.id = l.item_id
          JOIN stock_categories c ON c.id = i.category_id
          LEFT JOIN stock_item_positions p ON p.item_id = l.item_id AND p.position = l.position
          WHERE i.shop_id = ? AND ${where}`;
}

function shapeLine(row) {
  return {
    id: row.id,
    item_id: row.item_id,
    position: row.position,
    position_label: positionLabel(row.position),
    qty: row.qty,
    unit_cost: row.unit_cost === null || row.unit_cost === undefined ? null : Number(row.unit_cost),
    code: row.code,
    description: row.description,
    category_name: row.category_name,
    current_qty: Number(row.current_qty),
    created_at: row.created_at,
  };
}

// เพิ่มรายการรอยืนยันเข้าบิล (ยังไม่บวกสต๊อก) — สแกนชิ้น/ตำแหน่งเดิมซ้ำในบิลเดียวกัน = รวมจำนวนใน
// แถวเดิม (แก้ได้ทีหลัง) แทนที่จะเกิดแถวซ้ำ
// A different price per piece starts its own line, so one price never silently replaces another.
// Runs in the caller's transaction; returns { lineId, qty, merged } or { status, error }.
async function addPendingLine(conn, { sessionId, itemId, position, qty, unitCost, userId, shopId }) {
  const [[item]] = await conn.execute(
    'SELECT id, has_sides, has_axles, has_levels FROM stock_items WHERE id = ? AND shop_id = ? AND is_active = 1',
    [itemId, shopId]
  );
  if (!item) return { status: 404, error: 'ไม่พบรายการนี้ในสต๊อกรวม' };
  const validPositions = positionsFor(item.has_sides, item.has_axles, item.has_levels);
  if (validPositions.length > 0 ? !validPositions.includes(position) : position !== null) {
    return {
      status: 400,
      error: validPositions.length > 0 ? 'รายการนี้แยกตำแหน่ง ต้องระบุตำแหน่งให้ถูกต้อง' : 'รายการนี้ไม่แยกตำแหน่ง',
    };
  }

  const [[existing]] = await conn.execute(
    `SELECT id, qty FROM stock_receive_lines
     WHERE receipt_session_id = ? AND item_id = ? AND position <=> ? AND applied_at IS NULL
       ${unitCost === null ? '' : 'AND unit_cost <=> ?'}
     ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    unitCost === null ? [sessionId, itemId, position] : [sessionId, itemId, position, unitCost]
  );
  if (existing) {
    const lineQty = existing.qty + qty;
    if (lineQty > MAX_QTY) return { status: 400, error: 'จำนวนรวมสูงเกินไป' };
    await conn.execute('UPDATE stock_receive_lines SET qty = ?, unit_cost = COALESCE(?, unit_cost) WHERE id = ?', [lineQty, unitCost, existing.id]);
    return { lineId: existing.id, qty: lineQty, merged: true };
  }
  const [ins] = await conn.execute(
    'INSERT INTO stock_receive_lines (receipt_session_id, item_id, position, qty, user_id, unit_cost) VALUES (?, ?, ?, ?, ?, ?)',
    [sessionId, itemId, position, qty, userId, unitCost]
  );
  return { lineId: ins.insertId, qty, merged: false };
}

router.post('/lines', async (req, res) => {
  const itemId = parseId(req.body?.item_id);
  const position = req.body?.position ?? null;
  const qty = Number(req.body?.qty);
  const sessionId = parseId(req.body?.receipt_session_id);
  if (!itemId || !sessionId || !Number.isInteger(qty) || qty <= 0 || qty > MAX_QTY
      || (position !== null && typeof position !== 'string')) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  }
  const cost = parseUnitCost(req.body?.unit_cost);
  if (cost.error) return res.status(400).json({ error: cost.error });

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const owned = await loadOwnedSession(conn, sessionId, req.user, req.shopId, { lock: true });
    if (owned.error) {
      await conn.rollback();
      return res.status(owned.status).json({ error: owned.error });
    }

    const added = await addPendingLine(conn, {
      sessionId, itemId, position, qty, unitCost: cost.value, userId: req.user.id, shopId: req.shopId,
    });
    if (added.error) {
      await conn.rollback();
      return res.status(added.status).json({ error: added.error });
    }
    const [[line]] = await conn.execute(lineSelect('l.id = ?'), [req.shopId, added.lineId]);
    await conn.commit();
    res.status(added.merged ? 200 : 201).json({ success: true, merged: added.merged, line: shapeLine(line), qty: added.qty });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('Error adding stock receive line:', err);
    res.status(500).json({ error: 'เพิ่มรายการไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// One new item as sent by the scan page: the new-item fields of POST /stock-items + unit_cost, and qty (plain
// item) or qtys ({ position: qty }). Opening stock is always 0 here: what arrives goes through the bill.
// Returns { item, receive, unitCost } or { error }; receive = [position, qty] of each bill line to add.
function parseNewItemReceive(body) {
  const cost = parseUnitCost(body.unit_cost);
  if (cost.error) return { error: cost.error };
  const parsed = parseNewStockItem({ ...body, stocks: undefined, stock_qty: 0 });
  if (parsed.error) return { error: parsed.error };
  const { item } = parsed;

  if (item.positions.length === 0) {
    const qty = parseQty(body.qty, 1);
    if (qty === null) return { error: 'กรุณาใส่จำนวนที่รับเข้าตั้งแต่ 1 ชิ้นขึ้นไป' };
    return { item, receive: [[null, qty]], unitCost: cost.value };
  }
  const receive = [];
  for (const position of item.positions) {
    const raw = body.qtys ? body.qtys[position] : undefined;
    const qty = raw === undefined || raw === '' ? 0 : parseQty(raw);
    if (qty === null) return { error: 'จำนวนต้องเป็นเลขจำนวนเต็มตั้งแต่ 0 ขึ้นไป' };
    if (qty > 0) receive.push([position, qty]);
  }
  if (receive.length === 0) return { error: 'กรุณาใส่จำนวนที่รับเข้าอย่างน้อยหนึ่งตำแหน่ง' };
  return { item, receive, unitCost: cost.value };
}

function typedCodesOf(item) {
  return [...new Set([item.oemCode, ...Object.values(item.codes)].filter(Boolean))];
}

// Items of this shop already using one of these codes (another category, or a position code of another item)
async function findItemsWithCodes(shopId, codes) {
  const [rows] = await pool.query(
    `${MATCH_SELECT}
     WHERE i.shop_id = ? AND i.is_active = 1
       AND ((p.item_id IS NOT NULL AND p.oem_code IN (?)) OR (p.item_id IS NULL AND i.oem_code IN (?)))
     ORDER BY i.id, p.position`,
    [shopId, codes, codes]
  );
  return rows;
}

// Creates a parsed item and puts what arrived on the bill as pending lines, in the caller's transaction.
// Returns { itemId, lineIds } or { status, error }.
async function insertItemWithLines(conn, { sessionId, parsed, userId, shopId }) {
  const created = await insertStockItem(conn, { shopId, userId, item: parsed.item, createdInSessionId: sessionId });
  if (created.error) return created;
  const lineIds = [];
  for (const [position, qty] of parsed.receive) {
    const [ins] = await conn.execute(
      'INSERT INTO stock_receive_lines (receipt_session_id, item_id, position, qty, user_id, unit_cost) VALUES (?, ?, ?, ?, ?, ?)',
      [sessionId, created.itemId, position, qty, userId, parsed.unitCost]
    );
    lineIds.push(ins.insertId);
  }
  return { itemId: created.itemId, lineIds };
}

// A code that is not in สต๊อกรวม yet, typed in on the scan page: creates the item (opening stock 0) and
// puts the received quantity on the bill as pending lines in one transaction. The stock is added when the
// bill is confirmed, like any scanned line, so cost and history stay tied to the bill.
// Body: the new-item fields of POST /stock-items (category_id, oem_code / codes, description, has_*,
// min_stock, fitments) + receipt_session_id, unit_cost, and qty (plain item) or qtys ({ position: qty }).
router.post('/new-item', requireRole('office'), async (req, res) => {
  const body = req.body || {};
  const sessionId = parseId(body.receipt_session_id);
  if (!sessionId) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  const parsed = parseNewItemReceive(body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  let conn;
  try {
    // a code typed here may already be in stock (another category, or a position code of another item):
    // send those back so the user picks the existing item instead of creating a second one
    const existing = await findItemsWithCodes(req.shopId, typedCodesOf(parsed.item));
    if (existing.length > 0) {
      return res.status(409).json({
        code: 'CODE_EXISTS',
        error: 'รหัสนี้มีอยู่ในสต๊อกรวมแล้ว — เลือกรายการเดิมแทน',
        matches: existing.slice(0, 20).map(shapeMatch),
      });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const owned = await loadOwnedSession(conn, sessionId, req.user, req.shopId, { lock: true });
    if (owned.error) {
      await conn.rollback();
      return res.status(owned.status).json({ error: owned.error });
    }
    const created = await insertItemWithLines(conn, { sessionId, parsed, userId: req.user.id, shopId: req.shopId });
    if (created.error) {
      await conn.rollback();
      return res.status(created.status).json({ error: created.error });
    }
    const [lines] = await conn.query(`${lineSelect('l.id IN (?)')} ORDER BY l.id`, [req.shopId, created.lineIds]);
    await conn.commit();
    emitStockEvent('stock:item-created', { shopId: req.shopId, entityType: 'stock_item', entityId: created.itemId, actorId: req.user.id });
    res.status(201).json({ success: true, item_id: created.itemId, lines: lines.map(shapeLine) });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'รหัส OEM นี้มีอยู่ในหมวดนี้แล้ว' });
    }
    console.error('Error creating stock item from receive:', err);
    res.status(500).json({ error: 'เพิ่มรายการใหม่ไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// ── continuous scanning ────────────────────────────────────────────────
// Scans pile up in the browser first; these two routes turn the pile into bill lines once a person has checked it.

// Sorts one round of scanned codes for the review screen:
//   known   the code belongs to exactly one item or position
//   choose  several items use this code, or only a differently written code matched (ABC-123 / abc123)
//   attach  a new code whose other side is already in stock, on an item with that side's code still blank
//   pairs   two new codes that look like the left and right of one part
//   singles other new codes (partner: the other side exists as a separate item, which cannot be joined)
// Nothing is saved here.
router.post('/batch/resolve', async (req, res) => {
  const raw = req.body?.codes;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_BATCH_CODES) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  }
  const invalid = [];
  const byUpper = new Map();
  for (const value of raw) {
    const code = extractScanCode(value);
    if (!code || code.length > 100) invalid.push(String(value ?? '').slice(0, 100));
    else if (!byUpper.has(code.toUpperCase())) byUpper.set(code.toUpperCase(), code);
  }
  const codes = [...byUpper.values()];
  const result = { known: [], choose: [], attach: [], pairs: [], singles: [], invalid };
  if (codes.length === 0) return res.json(result);

  try {
    const exact = new Map();
    for (const row of (await findItemsWithCodes(req.shopId, codes)).map(shapeMatch)) {
      const key = row.code.toUpperCase();
      if (!exact.has(key)) exact.set(key, []);
      exact.get(key).push(row);
    }
    let remaining = [];
    for (const code of codes) {
      const matches = exact.get(code.toUpperCase());
      if (!matches) remaining.push(code);
      else if (matches.length === 1) result.known.push({ code, match: matches[0] });
      else result.choose.push({ code, matches, loose: false });
    }

    // codes written differently from stock, compared without separators: never matched automatically
    const compacts = [...new Set(remaining.map(compactCode).filter(Boolean))];
    if (compacts.length > 0) {
      const strip = (col) => `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${col}, ' ', ''), '-', ''), '_', ''), '.', ''), '/', '')`;
      const [looseRows] = await pool.query(
        `${MATCH_SELECT}
         WHERE i.shop_id = ? AND i.is_active = 1
           AND ((p.item_id IS NOT NULL AND ${strip('p.oem_code')} IN (?)) OR (p.item_id IS NULL AND ${strip('i.oem_code')} IN (?)))
         ORDER BY i.id, p.position`,
        [req.shopId, compacts, compacts]
      );
      const loose = new Map();
      for (const row of looseRows.map(shapeMatch)) {
        const key = compactCode(row.code);
        if (!loose.has(key)) loose.set(key, []);
        loose.get(key).push(row);
      }
      remaining = remaining.filter((code) => {
        const matches = loose.get(compactCode(code));
        if (matches) result.choose.push({ code, matches, loose: true });
        return !matches;
      });
    }

    // the other side of a new code already in stock
    const partnerCodes = [...new Set(remaining.flatMap((code) => sideMarkers(code).map((m) => m.partner)))];
    const partners = new Map();
    const blankPositions = new Set();
    if (partnerCodes.length > 0) {
      const partnerRows = await findItemsWithCodes(req.shopId, partnerCodes);
      for (const row of partnerRows.map(shapeMatch)) {
        const key = row.code.toUpperCase();
        if (!partners.has(key)) partners.set(key, []);
        partners.get(key).push(row);
      }
      const itemIds = [...new Set(partnerRows.map((row) => row.item_id))];
      if (itemIds.length > 0) {
        const [positions] = await pool.query(
          "SELECT item_id, position FROM stock_item_positions WHERE item_id IN (?) AND (oem_code IS NULL OR oem_code = '')",
          [itemIds]
        );
        for (const row of positions) blankPositions.add(`${row.item_id}|${row.position}`);
      }
    }
    const partnerHints = new Map();
    remaining = remaining.filter((code) => {
      for (const { partner } of sideMarkers(code)) {
        const rows = partners.get(partner);
        if (rows?.length !== 1) continue;
        const position = oppositePosition(rows[0].position);
        if (position && blankPositions.has(`${rows[0].item_id}|${position}`)) {
          result.attach.push({
            code,
            item_id: rows[0].item_id,
            position,
            position_label: positionLabel(position),
            partner_code: rows[0].code,
            partner_label: rows[0].position_label,
            category_name: rows[0].category_name,
            description: rows[0].description,
          });
          return false;
        }
        partnerHints.set(code, { code: rows[0].code, description: rows[0].description });
      }
      return true;
    });

    const { pairs, singles } = findPairs(remaining);
    result.pairs = pairs;
    result.singles = singles.map((code) => ({ code, side: likelySide(code), partner: partnerHints.get(code) || null }));
    res.json(result);
  } catch (err) {
    console.error('Error resolving scanned codes:', err);
    res.status(500).json({ error: 'ตรวจรายการที่สแกนไม่สำเร็จ' });
  }
});

// Puts one checked round on the bill as pending lines, all or nothing. Stock moves only when the bill is confirmed.
// Body: receipt_session_id,
//   known     [{ item_id, position, qty }]
//   attach    [{ item_id, position, code, qty }]  fills that position's blank code, then adds the line
//   new_items [the fields of POST /stock-receive/new-item]
router.post('/batch/apply', requireRole('office'), async (req, res) => {
  const body = req.body || {};
  const sessionId = parseId(body.receipt_session_id);
  const known = body.known ?? [];
  const attach = body.attach ?? [];
  const newItems = body.new_items ?? [];
  if (!sessionId || !Array.isArray(known) || !Array.isArray(attach) || !Array.isArray(newItems)) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  }
  const total = known.length + attach.length + newItems.length;
  if (total === 0 || total > MAX_BATCH_CODES) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });

  const parseRow = (row) => {
    const itemId = parseId(row?.item_id);
    const qty = parseQty(row?.qty, 1);
    const position = row?.position ?? null;
    if (!itemId || qty === null || (position !== null && typeof position !== 'string')) return null;
    return { itemId, qty, position };
  };
  const knownRows = known.map(parseRow);
  const attachRows = attach.map((row) => {
    const parsed = parseRow(row);
    const code = cleanText(row?.code, 100);
    return parsed && parsed.position && code ? { ...parsed, code } : null;
  });
  if (knownRows.includes(null) || attachRows.includes(null)) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });

  const parsedItems = newItems.map((row) => parseNewItemReceive(row || {}));
  const badItem = parsedItems.find((p) => p.error);
  if (badItem) return res.status(400).json({ error: badItem.error });

  // two new entries with one code would make two items, or fail halfway on a duplicate key
  const newCodes = [...attachRows.map((row) => row.code), ...parsedItems.flatMap((p) => typedCodesOf(p.item))];
  if (new Set(newCodes.map((code) => code.toUpperCase())).size !== newCodes.length) {
    return res.status(400).json({ error: 'มีรหัสซ้ำกันในรายการใหม่' });
  }

  let conn;
  try {
    if (newCodes.length > 0) {
      const existing = await findItemsWithCodes(req.shopId, newCodes);
      if (existing.length > 0) {
        return res.status(409).json({
          code: 'CODE_EXISTS',
          error: `รหัส ${shapeMatch(existing[0]).code} มีอยู่ในสต๊อกรวมแล้ว — กดตรวจรายการอีกครั้ง`,
          matches: existing.slice(0, 20).map(shapeMatch),
        });
      }
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const fail = async (status, error) => {
      await conn.rollback();
      return res.status(status).json({ error });
    };
    const owned = await loadOwnedSession(conn, sessionId, req.user, req.shopId, { lock: true });
    if (owned.error) return await fail(owned.status, owned.error);

    const shared = { sessionId, userId: req.user.id, shopId: req.shopId };
    const lineIds = new Set();
    const updatedItems = new Set();
    const createdItems = [];

    for (const row of knownRows) {
      const added = await addPendingLine(conn, { ...shared, itemId: row.itemId, position: row.position, qty: row.qty, unitCost: null });
      if (added.error) return await fail(added.status, added.error);
      lineIds.add(added.lineId);
    }
    for (const row of attachRows) {
      const [[slot]] = await conn.execute(
        `SELECT p.oem_code FROM stock_item_positions p JOIN stock_items i ON i.id = p.item_id
         WHERE p.item_id = ? AND p.position = ? AND i.shop_id = ? AND i.is_active = 1 FOR UPDATE`,
        [row.itemId, row.position, req.shopId]
      );
      if (!slot) return await fail(404, 'ไม่พบตำแหน่งนี้ในสต๊อกรวม');
      if (slot.oem_code) return await fail(409, 'ตำแหน่งนี้มีรหัสแล้ว — กดตรวจรายการอีกครั้ง');
      await conn.execute('UPDATE stock_item_positions SET oem_code = ? WHERE item_id = ? AND position = ?', [row.code, row.itemId, row.position]);
      const added = await addPendingLine(conn, { ...shared, itemId: row.itemId, position: row.position, qty: row.qty, unitCost: null });
      if (added.error) return await fail(added.status, added.error);
      lineIds.add(added.lineId);
      updatedItems.add(row.itemId);
    }
    for (const parsed of parsedItems) {
      const created = await insertItemWithLines(conn, { ...shared, parsed });
      if (created.error) return await fail(created.status, created.error);
      created.lineIds.forEach((id) => lineIds.add(id));
      createdItems.push(created.itemId);
    }

    const [lines] = await conn.query(`${lineSelect('l.id IN (?)')} ORDER BY l.id`, [req.shopId, [...lineIds]]);
    await conn.commit();
    createdItems.forEach((entityId) => emitStockEvent('stock:item-created', { shopId: req.shopId, entityType: 'stock_item', entityId, actorId: req.user.id }));
    updatedItems.forEach((entityId) => emitStockEvent('stock:item-updated', { shopId: req.shopId, entityType: 'stock_item', entityId, actorId: req.user.id }));
    res.status(201).json({ success: true, created: createdItems.length, lines: lines.map(shapeLine) });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'มีรหัสซ้ำในหมวดนี้ — กดตรวจรายการอีกครั้ง' });
    console.error('Error applying scanned batch:', err);
    res.status(500).json({ error: 'เพิ่มรายการเข้าบิลไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// รายการรอยืนยันของบิล (ใช้ตอนเปิดบิลเดิมต่อ)
router.get('/sessions/:id/lines', async (req, res) => {
  const sessionId = parseId(req.params.id);
  if (!sessionId) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  try {
    const owned = await loadOwnedSession(pool, sessionId, req.user, req.shopId);
    if (owned.error) return res.status(owned.status).json({ error: owned.error });
    const [rows] = await pool.execute(
      `${lineSelect('l.receipt_session_id = ? AND l.applied_at IS NULL')} ORDER BY l.id`,
      [req.shopId, sessionId]
    );
    res.json({ lines: rows.map(shapeLine) });
  } catch (err) {
    console.error('Error loading pending receive lines:', err);
    res.status(500).json({ error: 'โหลดรายการไม่สำเร็จ' });
  }
});

async function loadOwnedPendingLine(conn, lineId, user, shopId) {
  const [[line]] = await conn.execute(
    `SELECT l.id, l.receipt_session_id, l.item_id, l.position, l.qty, s.user_id AS session_user_id
     FROM stock_receive_lines l JOIN receipt_sessions s ON s.id = l.receipt_session_id
     WHERE l.id = ? AND s.shop_id = ? AND l.applied_at IS NULL FOR UPDATE`,
    [lineId, shopId]
  );
  if (!line) return { status: 404, error: 'ไม่พบรายการนี้ (อาจถูกยืนยันหรือลบไปแล้ว)' };
  if (roleRank(user.role) < roleRank('office') && line.session_user_id !== user.id) return { status: 403, error: 'บิลนี้ไม่ใช่ของคุณ' };
  return { line };
}

// แก้จำนวนของรายการรอยืนยัน (พนักงานกรอกผิด)
router.patch('/lines/:id', async (req, res) => {
  const lineId = parseId(req.params.id);
  const hasCost = req.body && Object.prototype.hasOwnProperty.call(req.body, 'unit_cost');
  const hasQty = req.body && req.body.qty !== undefined;
  const qty = Number(req.body?.qty);
  const cost = parseUnitCost(req.body?.unit_cost);
  if (cost.error) return res.status(400).json({ error: cost.error });
  if (!lineId || (!hasCost && !hasQty) || (hasQty && (!Number.isInteger(qty) || qty <= 0 || qty > MAX_QTY))) {
    return res.status(400).json({ error: 'จำนวนต้องเป็นเลขจำนวนเต็มตั้งแต่ 1 ขึ้นไป' });
  }
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const found = await loadOwnedPendingLine(conn, lineId, req.user, req.shopId);
    if (found.error) {
      await conn.rollback();
      return res.status(found.status).json({ error: found.error });
    }
    if (hasQty) await conn.execute('UPDATE stock_receive_lines SET qty = ? WHERE id = ?', [qty, lineId]);
    if (hasCost) await conn.execute('UPDATE stock_receive_lines SET unit_cost = ? WHERE id = ?', [cost.value, lineId]);
    await conn.commit();
    res.json({ success: true, qty: hasQty ? qty : undefined, unit_cost: hasCost ? cost.value : undefined });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('Error updating stock receive line:', err);
    res.status(500).json({ error: 'แก้จำนวนไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// ลบรายการรอยืนยัน (ยังไม่เคยบวกสต๊อก จึงไม่มีอะไรต้องคืน)
router.delete('/lines/:id', async (req, res) => {
  const lineId = parseId(req.params.id);
  if (!lineId) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const found = await loadOwnedPendingLine(conn, lineId, req.user, req.shopId);
    if (found.error) {
      await conn.rollback();
      return res.status(found.status).json({ error: found.error });
    }
    await conn.execute('DELETE FROM stock_receive_lines WHERE id = ?', [lineId]);
    // a code created from this bill that never held anything goes back out of สต๊อกรวม
    const hidden = await hideUnusedScanItem(conn, found.line.item_id, req.shopId);
    await conn.commit();
    if (hidden) emitStockEvent('stock:item-updated', { shopId: req.shopId, entityType: 'stock_item', entityId: found.line.item_id, actorId: req.user.id });
    res.json({ success: true, item_hidden: hidden });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('Error deleting stock receive line:', err);
    res.status(500).json({ error: 'ลบรายการไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// บวกสต๊อกจริงของรายการรอยืนยันหนึ่งแถว (อยู่ในทรานแซกชันของผู้เรียก) — คืน { itemId } หรือ { status, error }
async function applyLine(conn, line, userId, shopId) {
  const [[item]] = await conn.execute(
    `SELECT id, description, has_sides, has_axles, has_levels, stock_qty
     FROM stock_items WHERE id = ? AND shop_id = ? AND is_active = 1 FOR UPDATE`,
    [line.item_id, shopId]
  );
  if (!item) return { status: 400, error: 'มีรายการที่ถูกซ่อนหรือลบออกจากสต๊อกรวมไปแล้ว — ลบรายการนั้นออกจากบิลก่อนยืนยัน' };

  let before = item.stock_qty;
  let after;
  let total;
  if (line.position) {
    const [[row]] = await conn.execute(
      'SELECT qty FROM stock_item_positions WHERE item_id = ? AND position = ? FOR UPDATE',
      [line.item_id, line.position]
    );
    if (!row) return { status: 400, error: `"${item.description}" ไม่มีตำแหน่งนี้แล้ว — ลบรายการนี้ออกจากบิลก่อนยืนยัน` };
    before = row.qty;
    after = before + line.qty;
    await conn.execute(
      'UPDATE stock_item_positions SET qty = ? WHERE item_id = ? AND position = ?',
      [after, line.item_id, line.position]
    );
    const [[sum]] = await conn.execute(
      'SELECT COALESCE(SUM(qty), 0) AS total FROM stock_item_positions WHERE item_id = ?',
      [line.item_id]
    );
    total = Number(sum.total);
  } else {
    after = before + line.qty;
    total = after;
  }
  if (after > MAX_QTY) return { status: 400, error: `จำนวนรวมของ "${item.description}" สูงเกินไป` };

  await conn.execute('UPDATE stock_items SET stock_qty = ? WHERE id = ? AND shop_id = ?', [total, line.item_id, shopId]);
  const [mv] = await conn.execute(
    `INSERT INTO stock_item_movements (item_id, qty_before, qty_after, reason, position, receipt_session_id, user_id)
     VALUES (?, ?, ?, 'receive', ?, ?, ?)`,
    [line.item_id, before, after, line.position, line.receipt_session_id, userId]
  );
  await conn.execute('UPDATE stock_receive_lines SET applied_at = NOW(), movement_id = ? WHERE id = ?', [mv.insertId, line.id]);
  return { itemId: line.item_id };
}

// เสร็จสิ้น: บวกสต๊อกทุกรายการรอยืนยันของบิลในทรานแซกชันเดียว (พังตรงไหน = ไม่บวกเลยสักรายการ)
router.post('/sessions/:id/commit', async (req, res) => {
  const sessionId = parseId(req.params.id);
  if (!sessionId) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const owned = await loadOwnedSession(conn, sessionId, req.user, req.shopId, { lock: true });
    if (owned.error) {
      await conn.rollback();
      return res.status(owned.status).json({ error: owned.error });
    }
    const [lines] = await conn.execute(
      'SELECT id, receipt_session_id, item_id, position, qty FROM stock_receive_lines WHERE receipt_session_id = ? AND applied_at IS NULL ORDER BY id FOR UPDATE',
      [sessionId]
    );
    if (lines.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'ไม่มีรายการรอยืนยันในบิลนี้' });
    }
    const itemIds = new Set();
    let totalQty = 0;
    for (const line of lines) {
      const result = await applyLine(conn, line, req.user.id, req.shopId);
      if (result.error) {
        await conn.rollback();
        return res.status(result.status).json({ error: result.error });
      }
      itemIds.add(result.itemId);
      totalQty += line.qty;
    }
    for (const itemId of itemIds) await recomputeItemCost(conn, itemId, req.shopId);
    await conn.commit();

    itemIds.forEach((itemId) => {
      emitStockEvent('stock:item-updated', { shopId: req.shopId, entityType: 'stock_item', entityId: itemId, actorId: req.user.id });
    });
    emitStockTxEvent('stock:tx-created', { shopId: req.shopId, txType: 'IN', entityType: 'stock_item', entityId: null, actorId: req.user.id });
    res.json({ success: true, applied: lines.length, total_qty: totalQty });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('Error committing stock receive session:', err);
    res.status(500).json({ error: 'บันทึกรับเข้าไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// ยกเลิกรายการรับเข้าที่ "บวกสต๊อกไปแล้ว" (สแกนผิดแล้วเพิ่งมารู้ทีหลัง) — หักยอดคืนถ้าไม่ทำให้ติดลบ
// แถวเดิมไม่ลบ แค่ตีตรา voided_at และเพิ่มแถวปรับยอดเพื่อให้ประวัติของชิ้นนั้นเดินต่อเนื่อง
router.delete('/movements/:id', requireManager, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const result = await voidReceiveMovement(conn, id, req.user.id, req.shopId);
    if (result.error) {
      await conn.rollback();
      return res.status(result.status).json({ error: result.error });
    }
    await conn.commit();
    emitStockEvent('stock:item-updated', { shopId: req.shopId, entityType: 'stock_item', entityId: result.itemId, actorId: req.user.id });
    emitStockTxEvent('stock:tx-deleted', { shopId: req.shopId, txType: 'IN', entityType: 'stock_item', entityId: result.itemId, actorId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('Error voiding receive movement:', err);
    res.status(500).json({ error: 'ลบรายการไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// ใช้ร่วมกับการลบบิลทั้งใบ (backend_transactions.routes.js) — ต้องอยู่ในทรานแซกชันของผู้เรียก
// คืน { itemId } เมื่อสำเร็จ หรือ { status, error }
async function voidReceiveMovement(conn, movementId, userId, shopId) {
  const [[mv]] = await conn.execute(
    `SELECT m.id, m.item_id, m.position, m.qty_before, m.qty_after, m.receipt_session_id
     FROM stock_item_movements m JOIN stock_items i ON i.id = m.item_id
     WHERE m.id = ? AND i.shop_id = ? AND m.reason = 'receive' AND m.voided_at IS NULL FOR UPDATE`,
    [movementId, shopId]
  );
  if (!mv) return { status: 404, error: 'ไม่พบรายการนี้' };
  const delta = mv.qty_after - mv.qty_before;

  const [[item]] = await conn.execute(
    'SELECT id, description, stock_qty FROM stock_items WHERE id = ? AND shop_id = ? FOR UPDATE',
    [mv.item_id, shopId]
  );
  if (!item) return { status: 404, error: 'ไม่พบรายการในสต๊อกรวม' };

  let current = item.stock_qty;
  if (mv.position) {
    const [[row]] = await conn.execute(
      'SELECT qty FROM stock_item_positions WHERE item_id = ? AND position = ? FOR UPDATE',
      [mv.item_id, mv.position]
    );
    current = row ? row.qty : 0;
  }
  const next = current - delta;
  if (next < 0) {
    return {
      status: 400,
      error: `ลบไม่ได้ — "${item.description}" ถูกใช้ไปแล้ว ถ้าลบรายการนี้สต๊อกจะติดลบ (คงเหลือ ${current})`,
    };
  }

  let total = next;
  if (mv.position) {
    await conn.execute('UPDATE stock_item_positions SET qty = ? WHERE item_id = ? AND position = ?', [next, mv.item_id, mv.position]);
    const [[sum]] = await conn.execute(
      'SELECT COALESCE(SUM(qty), 0) AS total FROM stock_item_positions WHERE item_id = ?',
      [mv.item_id]
    );
    total = Number(sum.total);
  }
  await conn.execute('UPDATE stock_items SET stock_qty = ? WHERE id = ? AND shop_id = ?', [total, mv.item_id, shopId]);
  await conn.execute('UPDATE stock_item_movements SET voided_at = NOW() WHERE id = ?', [movementId]);
  await conn.execute(
    `INSERT INTO stock_item_movements (item_id, qty_before, qty_after, reason, position, note, user_id)
     VALUES (?, ?, ?, 'adjust', ?, 'ยกเลิกรายการรับเข้า', ?)`,
    [mv.item_id, current, next, mv.position, userId]
  );
  // the bill line behind this receive stops counting in the item's cost
  const [marked] = await conn.execute(
    'UPDATE stock_receive_lines SET voided_at = NOW() WHERE movement_id = ? AND voided_at IS NULL',
    [movementId]
  );
  if (marked.affectedRows === 0 && mv.receipt_session_id) {
    // closed before movement_id was recorded: the closed line of the same bill, item, position and quantity
    await conn.execute(
      `UPDATE stock_receive_lines SET voided_at = NOW()
       WHERE receipt_session_id = ? AND item_id = ? AND position <=> ? AND qty = ?
         AND applied_at IS NOT NULL AND voided_at IS NULL AND movement_id IS NULL
       ORDER BY id LIMIT 1`,
      [mv.receipt_session_id, mv.item_id, mv.position, delta]
    );
  }
  await recomputeItemCost(conn, mv.item_id, shopId);
  return { itemId: mv.item_id };
}

// ป้าย QR ของรายการที่เลือก: ของแยกตำแหน่ง = หนึ่งป้ายต่อหนึ่งรหัสของแต่ละตำแหน่ง (ข้ามตำแหน่ง
// ที่ยังไม่มีรหัส) ของธรรมดา = หนึ่งป้ายต่อรหัสหลัก QR เป็นรหัสล้วน ๆ เหมือนป้ายเดิมของระบบเก่า
router.get('/qrcodes', requireRole('office'), async (req, res) => {
  const ids = String(req.query.ids ?? '').split(',').map(parseId).filter(Boolean).slice(0, 300);
  if (ids.length === 0) return res.status(400).json({ error: 'กรุณาเลือกรายการ' });
  try {
    const [rows] = await pool.query(
      `${MATCH_SELECT} WHERE i.shop_id = ? AND i.is_active = 1 AND i.id IN (?) ORDER BY i.id, p.position`,
      [req.shopId, ids]
    );
    const wanted = rows.map(shapeMatch).filter((m) => m.code);
    const labels = await Promise.all(wanted.map(async (m) => ({
      item_id: m.item_id,
      position: m.position,
      code: m.code,
      // ชื่อบนป้าย: รายละเอียด + ตำแหน่ง (ถ้ามี) ให้รู้ว่ารหัสนี้คือด้านไหนตอนแปะของ
      name: m.position_label ? `${m.description} (${m.position_label})` : m.description,
      qrcode: await QRCode.toDataURL(m.code, { width: 300, margin: 1 }),
    })));
    res.json({ labels });
  } catch (err) {
    console.error('Error building stock QR labels:', err);
    res.status(500).json({ error: 'สร้าง QR code ไม่สำเร็จ' });
  }
});

// ── costs ──────────────────────────────────────────────────────────────

// What still has no cost: closed bill lines without a price, and stock on the shelf that has no cost at all
router.get('/costs/missing', requireRole('office'), async (req, res) => {
  try {
    const [lines] = await pool.query(
      `SELECT l.id, l.qty, l.position, i.id AS item_id, i.description, i.oem_code, c.name AS category_name,
              s.invoice_no, s.supplier_name, DATE_FORMAT(COALESCE(s.bill_date, DATE(s.created_at)), '%Y-%m-%d') AS bill_date
       FROM stock_receive_lines l
       JOIN receipt_sessions s ON s.id = l.receipt_session_id
       JOIN stock_items i ON i.id = l.item_id JOIN stock_categories c ON c.id = i.category_id
       WHERE s.shop_id = ? AND i.shop_id = ? AND l.applied_at IS NOT NULL AND l.voided_at IS NULL AND l.unit_cost IS NULL
       ORDER BY l.id DESC LIMIT 300`,
      [req.shopId, req.shopId]
    );
    const [items] = await pool.query(
      `SELECT i.id, i.description, i.oem_code, i.stock_qty, c.name AS category_name
       FROM stock_items i JOIN stock_categories c ON c.id = i.category_id
       WHERE i.shop_id = ? AND i.is_active = 1 AND i.stock_qty > 0 AND i.avg_cost IS NULL
       ORDER BY c.name, i.description LIMIT 300`,
      [req.shopId]
    );
    res.json({ success: true, data: { lines, items } });
  } catch (err) {
    console.error('Error loading missing costs:', err);
    res.status(500).json({ error: 'โหลดรายการที่ยังไม่มีต้นทุนไม่สำเร็จ' });
  }
});

// Price per piece of a line on a bill that is already closed (forgotten at the time)
router.put('/costs/lines/:id', requireRole('office'), async (req, res) => {
  const lineId = parseId(req.params.id);
  const cost = parseUnitCost(req.body?.unit_cost);
  if (!lineId || cost.error || cost.value === null) return res.status(400).json({ error: cost.error || 'กรุณากรอกต้นทุนต่อชิ้น' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [[line]] = await conn.execute(
      `SELECT l.id, l.item_id, l.applied_at, l.voided_at FROM stock_receive_lines l JOIN receipt_sessions s ON s.id = l.receipt_session_id
       WHERE l.id = ? AND s.shop_id = ? FOR UPDATE`,
      [lineId, req.shopId]
    );
    if (!line) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบรายการ' });
    }
    if (line.voided_at) {
      await conn.rollback();
      return res.status(400).json({ error: 'รายการนี้ถูกยกเลิกการรับเข้าไปแล้ว' });
    }
    await conn.execute('UPDATE stock_receive_lines SET unit_cost = ? WHERE id = ?', [cost.value, lineId]);
    if (line.applied_at) await recomputeItemCost(conn, line.item_id, req.shopId);
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('Error saving line cost:', err);
    res.status(500).json({ error: 'บันทึกต้นทุนไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// Cost typed by hand for stock bought before costs were recorded (used until a bill line with a cost exists)
router.put('/costs/items/:id', requireManager, async (req, res) => {
  const itemId = parseId(req.params.id);
  const cost = parseUnitCost(req.body?.manual_cost);
  if (!itemId || cost.error) return res.status(400).json({ error: cost.error || 'ข้อมูลไม่ถูกต้อง' });
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [result] = await conn.execute('UPDATE stock_items SET manual_cost = ? WHERE id = ? AND shop_id = ?', [cost.value, itemId, req.shopId]);
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบรายการนี้ในสต๊อก' });
    }
    await recomputeItemCost(conn, itemId, req.shopId);
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('Error saving item cost:', err);
    res.status(500).json({ error: 'บันทึกต้นทุนไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
module.exports.voidReceiveMovement = voidReceiveMovement;
