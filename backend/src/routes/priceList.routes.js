const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole, roleRank } = require('../middleware/auth');
const { groupIdOf, itemKey } = require('../utils/modelPrices');
const { displayModelName } = require('../utils/modelDisplay');
const { normalizeName } = require('../utils/normalizeName');
const { findStockFor } = require('../utils/priceListMatch');

// ราคาขาย: the price list staff look at when a customer asks. It reads standard prices (managed on /model-prices), adds
// the latest price typed on a quotation for what has no standard price yet, and says what is in stock. The list of items
// follows the first branch of the owner (สมุทรปราการ, the owner's decision of 2026-11-06), so a new branch starts with
// everything and a manager or sales takes off what it does not sell. That only hides the item from this branch's list.
// What parts cost is only sent to those allowed to see it: a role below manager never receives it.
const router = express.Router();
router.use(authenticate);
router.use(requireRole('office'));

const MAX_STOCK_SHOWN = 5;

const mayEditList = (user) => user.role !== 'accountant' && (user.role === 'sales' || roleRank(user.role) >= roleRank('manager'));

async function loadStockItems(shopId) {
  const [items] = await pool.query(
    `SELECT i.id, i.oem_code, i.description, i.stock_qty, i.avg_cost, c.name AS category_name
     FROM stock_items i JOIN stock_categories c ON c.id = i.category_id
     WHERE i.shop_id = ? AND i.is_active = 1`,
    [shopId]
  );
  const [fitments] = await pool.query(
    `SELECT f.item_id, f.brand, f.model, f.year_from, f.year_to
     FROM stock_item_fitments f JOIN stock_items i ON i.id = f.item_id
     WHERE i.shop_id = ? AND i.is_active = 1`,
    [shopId]
  );
  const byItem = new Map();
  fitments.forEach((f) => {
    if (!byItem.has(f.item_id)) byItem.set(f.item_id, []);
    byItem.get(f.item_id).push(f);
  });
  return items.map((item) => ({ ...item, fitments: byItem.get(item.id) || [] }));
}

async function loadPriceLines(groupId, shopId) {
  const [standard] = await pool.query(
    `SELECT p.id, p.vehicle_model_id, p.item_key, p.item_name, p.part_price, p.labor_price, p.is_set,
            DATE_FORMAT(p.updated_at, '%Y-%m-%d') AS updated_on, v.brand, v.model, v.year_range
     FROM model_item_prices p JOIN vehicle_models v ON v.id = p.vehicle_model_id
     WHERE p.group_id = ? AND p.is_active = 1`,
    [groupId]
  );
  // the latest typed price of each item per generation; times = how often it was quoted
  const [typed] = await pool.query(
    `SELECT o.vehicle_model_id, o.item_key, o.item_name, o.unit_price, DATE_FORMAT(o.created_at, '%Y-%m-%d') AS updated_on,
            v.brand, v.model, v.year_range, t.times
     FROM price_observations o
     JOIN (SELECT vehicle_model_id, item_key, MAX(id) AS last_id, COUNT(*) AS times
           FROM price_observations WHERE group_id = ? GROUP BY vehicle_model_id, item_key) t ON t.last_id = o.id
     JOIN vehicle_models v ON v.id = o.vehicle_model_id
     WHERE o.group_id = ?`,
    [groupId, groupId]
  );
  const hasStandard = new Set(standard.map((p) => `${p.vehicle_model_id}|${p.item_key}`));

  // the item list of the owner's first branch; this branch's own items only add what the first branch does not have
  const [[first]] = await pool.query('SELECT MIN(id) AS id FROM shops WHERE group_id = ?', [groupId]);
  const [services] = await pool.query(
    `SELECT shop_id, product_name, category, is_set, set_price FROM service_items
     WHERE shop_id IN (?) AND is_active = 1 ORDER BY shop_id = ? DESC, id`,
    [[first.id, shopId], first.id]
  );
  const catalog = new Map();
  services.forEach((s) => {
    const key = itemKey(s.product_name);
    if (key && !catalog.has(key)) catalog.set(key, s);
  });

  const lines = [
    ...standard.map((p) => ({
      ...p,
      key: `s${p.id}`,
      source: 'standard',
      times: null,
      part_price: Number(p.part_price),
      labor_price: p.labor_price === null ? null : Number(p.labor_price),
      is_set: Boolean(p.is_set),
    })),
    ...typed.filter((o) => !hasStandard.has(`${o.vehicle_model_id}|${o.item_key}`)).map((o) => ({
      ...o,
      key: `t${o.vehicle_model_id}-${o.item_key}`,
      source: 'typed',
      times: Number(o.times),
      part_price: Number(o.unit_price),
      labor_price: null,
      is_set: false,
    })),
  ];
  // items on the list with no price for any car yet still show, so nothing is missed and unused ones can be taken off
  const priced = new Set(lines.map((line) => line.item_key));
  catalog.forEach((s, key) => {
    if (priced.has(key)) return;
    const setPrice = s.is_set && Number(s.set_price) > 0 ? Number(s.set_price) : null;
    lines.push({
      key: `c${key}`,
      source: 'catalog',
      times: null,
      item_key: key,
      item_name: s.product_name,
      brand: '',
      model: '',
      year_range: null,
      vehicle_model_id: null,
      part_price: setPrice,
      labor_price: null,
      is_set: Boolean(s.is_set),
      updated_on: null,
    });
  });
  return lines.map((line) => ({ ...line, category: catalog.get(line.item_key)?.category || null }));
}

// GET /price-list : every line; the page filters on the spot, since staff are often on the phone
router.get('/', async (req, res) => {
  const seesCost = roleRank(req.user.role) >= roleRank('manager');
  try {
    const groupId = await groupIdOf(req.shopId);
    if (!groupId) return res.json({ success: true, data: { rows: [], sees_cost: seesCost, may_edit_list: false, hidden: [] } });
    const [lines, stockItems, [hiddenRows]] = await Promise.all([
      loadPriceLines(groupId, req.shopId),
      loadStockItems(req.shopId),
      pool.query('SELECT item_key, item_name FROM price_list_hidden WHERE shop_id = ?', [req.shopId]),
    ]);
    const hiddenKeys = new Set(hiddenRows.map((row) => row.item_key));

    const rows = lines.filter((line) => !hiddenKeys.has(line.item_key)).map((line) => {
      const found = line.source === 'catalog' ? [] : findStockFor(line, stockItems);
      const costs = found.map((s) => s.avg_cost).filter((c) => c !== null).map(Number);
      const row = {
        key: line.key,
        item_key: line.item_key,
        source: line.source,
        times: line.times,
        brand: line.brand,
        vehicle_model_id: line.vehicle_model_id,
        model_name: line.model ? displayModelName(line.model, line.year_range) : '',
        item_name: line.item_name,
        category: line.category,
        is_set: line.is_set,
        part_price: line.part_price,
        labor_price: line.labor_price,
        total_price: line.part_price === null ? null : line.part_price + (line.labor_price || 0),
        updated_on: line.updated_on,
        stock: {
          matched: found.length,
          qty: found.reduce((sum, s) => sum + Number(s.stock_qty), 0),
          items: found.slice(0, MAX_STOCK_SHOWN).map((s) => ({ code: s.oem_code, description: s.description, qty: Number(s.stock_qty) })),
        },
      };
      if (seesCost && costs.length > 0) {
        row.cost_min = Math.min(...costs);
        row.cost_max = Math.max(...costs);
        // below every cost it could be, so the warning never rests on a wrong match alone
        row.below_cost = row.total_price > 0 && row.total_price < row.cost_min;
      }
      return row;
    });

    // items with no car come last
    rows.sort((a, b) => (a.brand === '') - (b.brand === '') || a.brand.localeCompare(b.brand)
      || normalizeName(a.model_name).localeCompare(normalizeName(b.model_name)) || a.item_name.localeCompare(b.item_name, 'th'));
    const mayEdit = mayEditList(req.user);
    res.json({
      success: true,
      data: { rows, sees_cost: seesCost, may_edit_list: mayEdit, hidden: mayEdit ? hiddenRows : [] },
    });
  } catch (err) {
    console.error('Error loading the price list:', err);
    res.status(500).json({ error: 'โหลดราคาขายไม่สำเร็จ' });
  }
});

// Take an item off this branch's list, or put it back. Manager level and sales; the read-only role is refused by rolePolicy.
router.post('/hidden', async (req, res) => {
  if (!mayEditList(req.user)) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ทำรายการนี้' });
  const name = String(req.body?.item_name ?? '').trim().slice(0, 255);
  const key = itemKey(name);
  if (!key) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  try {
    await pool.query(
      'INSERT INTO price_list_hidden (shop_id, item_key, item_name, hidden_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE hidden_by = VALUES(hidden_by)',
      [req.shopId, key, name, req.user.username || null]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('Error hiding a price list item:', err);
    res.status(500).json({ error: 'ลบรายการไม่สำเร็จ' });
  }
});

router.delete('/hidden', async (req, res) => {
  if (!mayEditList(req.user)) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ทำรายการนี้' });
  const key = itemKey(req.body?.item_name);
  if (!key) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  try {
    await pool.query('DELETE FROM price_list_hidden WHERE shop_id = ? AND item_key = ?', [req.shopId, key]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error restoring a price list item:', err);
    res.status(500).json({ error: 'เอารายการกลับไม่สำเร็จ' });
  }
});

module.exports = router;
