// Standard prices per vehicle generation, shared by every branch of the same owner (branch group).
//   office+   : resolve a car to its generation, look a price up, link a car to its generation
//   manager+  : list / set / remove standard prices, see the prices staff keep typing and promote them
// See db/priceSchema.js and utils/modelPrices.js.
const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole, requireManager } = require('../middleware/auth');
const { normalizeName } = require('../utils/normalizeName');
const { displayModelName } = require('../utils/modelDisplay');
const { groupIdOf, itemKey, parsePrice, withDisplay, approvedModel } = require('../utils/modelPrices');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('office'));

function serverError(res, err, message) {
  console.error(err);
  return res.status(500).json({ error: message });
}

// the branch group of the logged-in shop; answers 409 itself when there is none
async function requireGroup(req, res) {
  const groupId = await groupIdOf(req.shopId);
  if (!groupId) res.status(409).json({ error: 'ร้านนี้ยังไม่อยู่ในกลุ่มสาขา' });
  return groupId;
}

// ── resolve a car to its generation ─────────────────────────────────────────

// GET /model-prices/resolve?brand=Toyota&model=Vios  (or ?vehicle_model_id=12)
// → { matches: [{ id, brand, model, year_range, display_name }] }. One match = the generation is known; several =
// the typed name fits more than one generation (e.g. plain "Vios"), the staff pick; none = nothing in the book fits.
router.get('/resolve', async (req, res) => {
  try {
    if (req.query.vehicle_model_id) {
      const model = await approvedModel(Number(req.query.vehicle_model_id));
      return res.json({ success: true, data: { matches: model ? [model] : [] } });
    }
    const brand = String(req.query.brand || '').trim();
    const typed = normalizeName(req.query.model);
    if (!brand || !typed) return res.json({ success: true, data: { matches: [] } });
    const [rows] = await pool.query(
      "SELECT id, brand, model, year_range FROM vehicle_models WHERE brand = ? AND status = 'approved' ORDER BY id",
      [brand]
    );
    const matches = rows.filter((r) => normalizeName(r.model) === typed
      || normalizeName(r.year_range ? `${r.model} (${r.year_range})` : r.model) === typed
      || normalizeName(displayModelName(r.model, r.year_range)) === typed).map(withDisplay);
    res.json({ success: true, data: { matches } });
  } catch (err) {
    serverError(res, err, 'ค้นหารุ่นรถไม่สำเร็จ');
  }
});

// POST /model-prices/attach-vehicle { vehicle_id, vehicle_model_id } — remember the generation of a customer's car
router.post('/attach-vehicle', async (req, res) => {
  const vehicleId = Number(req.body?.vehicle_id);
  const modelId = Number(req.body?.vehicle_model_id);
  if (!vehicleId || !modelId) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  try {
    if (!(await approvedModel(modelId))) return res.status(400).json({ error: 'ไม่พบรุ่นรถนี้ในสมุด' });
    const [result] = await pool.query('UPDATE vehicles SET vehicle_model_id = ? WHERE id = ? AND shop_id = ?', [modelId, vehicleId, req.shopId]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'ไม่พบรถ' });
    res.json({ success: true });
  } catch (err) {
    serverError(res, err, 'บันทึกรุ่นรถไม่สำเร็จ');
  }
});

// ── look a price up ─────────────────────────────────────────────────────────

// GET /model-prices/lookup?vehicle_model_id=12&name=โช๊คอัพหน้า → { data: null | { part_price, labor_price, is_set, ... } }
router.get('/lookup', async (req, res) => {
  const modelId = Number(req.query.vehicle_model_id);
  const key = itemKey(req.query.name);
  if (!modelId || !key) return res.json({ success: true, data: null });
  try {
    const groupId = await groupIdOf(req.shopId);
    if (!groupId) return res.json({ success: true, data: null });
    const [[row]] = await pool.query(
      `SELECT id, item_name, part_price, labor_price, is_set FROM model_item_prices
       WHERE group_id = ? AND vehicle_model_id = ? AND item_key = ? AND is_active = 1`,
      [groupId, modelId, key]
    );
    res.json({ success: true, data: row || null });
  } catch (err) {
    serverError(res, err, 'ค้นหาราคามาตรฐานไม่สำเร็จ');
  }
});

// ── manage standard prices (manager+) ───────────────────────────────────────

router.get('/', requireManager, async (req, res) => {
  try {
    const groupId = await requireGroup(req, res);
    if (!groupId) return;
    let sql = `SELECT p.id, p.vehicle_model_id, p.item_name, p.part_price, p.labor_price, p.is_set, p.updated_by, p.updated_at,
                      v.brand, v.model, v.year_range
               FROM model_item_prices p JOIN vehicle_models v ON v.id = p.vehicle_model_id
               WHERE p.group_id = ? AND p.is_active = 1`;
    const params = [groupId];
    if (req.query.vehicle_model_id) { sql += ' AND p.vehicle_model_id = ?'; params.push(Number(req.query.vehicle_model_id)); }
    if (req.query.brand) { sql += ' AND v.brand = ?'; params.push(String(req.query.brand)); }
    const search = String(req.query.search || '').trim().slice(0, 100);
    if (search) { sql += ' AND p.item_name LIKE ?'; params.push(`%${search}%`); }
    sql += ' ORDER BY v.brand, v.model, v.year_range, p.item_name LIMIT 1000';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows.map(withDisplay) });
  } catch (err) {
    serverError(res, err, 'โหลดราคามาตรฐานไม่สำเร็จ');
  }
});

// PUT /model-prices { vehicle_model_id, item_name, part_price, labor_price?, is_set? } — add or change a price.
// Leaving labor_price out keeps the labour already stored; sending null / '' clears it.
router.put('/', requireManager, async (req, res) => {
  const body = req.body || {};
  const modelId = Number(body.vehicle_model_id);
  const name = String(body.item_name || '').trim();
  const key = itemKey(name);
  const partPrice = parsePrice(body.part_price);
  const hasLabor = Object.prototype.hasOwnProperty.call(body, 'labor_price');
  const laborPrice = hasLabor ? parsePrice(body.labor_price) : null;
  if (!modelId || !key) return res.status(400).json({ error: 'กรุณาเลือกรุ่นรถและกรอกชื่อรายการ' });
  if (name.length > 255) return res.status(400).json({ error: 'ชื่อรายการยาวเกินไป' });
  if (partPrice === null) return res.status(400).json({ error: 'ราคาไม่ถูกต้อง' });
  if (hasLabor && body.labor_price !== null && body.labor_price !== '' && laborPrice === null) {
    return res.status(400).json({ error: 'ค่าแรงไม่ถูกต้อง' });
  }
  try {
    const groupId = await requireGroup(req, res);
    if (!groupId) return;
    if (!(await approvedModel(modelId))) return res.status(400).json({ error: 'ไม่พบรุ่นรถนี้ในสมุด' });
    const updatedBy = String(req.user.full_name || req.user.username || '').slice(0, 100) || null;
    const isSet = body.is_set ? 1 : 0;
    await pool.query(
      `INSERT INTO model_item_prices (group_id, vehicle_model_id, item_key, item_name, part_price, labor_price, is_set, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE item_name = VALUES(item_name), part_price = VALUES(part_price), is_set = VALUES(is_set),
         ${hasLabor ? 'labor_price = VALUES(labor_price),' : ''} is_active = 1, updated_by = VALUES(updated_by)`,
      [groupId, modelId, key, name, partPrice, laborPrice, isSet, updatedBy]
    );
    res.json({ success: true });
  } catch (err) {
    serverError(res, err, 'บันทึกราคามาตรฐานไม่สำเร็จ');
  }
});

// DELETE /model-prices/:id — take a price out of use (the row is kept)
router.delete('/:id', requireManager, async (req, res) => {
  try {
    const groupId = await requireGroup(req, res);
    if (!groupId) return;
    const [result] = await pool.query(
      'UPDATE model_item_prices SET is_active = 0 WHERE id = ? AND group_id = ? AND is_active = 1',
      [req.params.id, groupId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'ไม่พบรายการ' });
    res.json({ success: true });
  } catch (err) {
    serverError(res, err, 'ลบราคามาตรฐานไม่สำเร็จ');
  }
});

// ── prices staff keep typing (manager+) ─────────────────────────────────────

// GET /model-prices/suggestions?min=2 — per generation + item: how often it was quoted and at which prices.
// Items whose latest price already equals the standard price are left out. `stable` = the last three prices are equal.
router.get('/suggestions', requireManager, async (req, res) => {
  const minTimes = Math.min(Math.max(Number(req.query.min) || 2, 1), 50);
  try {
    const groupId = await requireGroup(req, res);
    if (!groupId) return;
    const [rows] = await pool.query(
      `SELECT o.vehicle_model_id, o.item_key,
              COUNT(*) AS times, MIN(o.unit_price) AS min_price, MAX(o.unit_price) AS max_price, MAX(o.id) AS last_id,
              SUBSTRING_INDEX(GROUP_CONCAT(o.unit_price ORDER BY o.id DESC SEPARATOR ','), ',', 3) AS recent_prices,
              SUBSTRING_INDEX(GROUP_CONCAT(o.item_name ORDER BY o.id DESC SEPARATOR '|~|'), '|~|', 1) AS item_name
       FROM price_observations o
       WHERE o.group_id = ?
       GROUP BY o.vehicle_model_id, o.item_key
       HAVING COUNT(*) >= ?
       ORDER BY times DESC, last_id DESC
       LIMIT 500`,
      [groupId, minTimes]
    );
    if (rows.length === 0) return res.json({ success: true, data: [] });

    const modelIds = [...new Set(rows.map((r) => r.vehicle_model_id))];
    const [models] = await pool.query('SELECT id, brand, model, year_range FROM vehicle_models WHERE id IN (?)', [modelIds]);
    const modelById = new Map(models.map((m) => [m.id, withDisplay(m)]));
    const [standards] = await pool.query(
      'SELECT vehicle_model_id, item_key, part_price FROM model_item_prices WHERE group_id = ? AND is_active = 1 AND vehicle_model_id IN (?)',
      [groupId, modelIds]
    );
    const standardOf = new Map(standards.map((s) => [`${s.vehicle_model_id}|${s.item_key}`, Number(s.part_price)]));

    const data = [];
    for (const r of rows) {
      const recent = String(r.recent_prices).split(',').map(Number);
      const last = recent[0];
      const standard = standardOf.has(`${r.vehicle_model_id}|${r.item_key}`) ? standardOf.get(`${r.vehicle_model_id}|${r.item_key}`) : null;
      if (standard !== null && standard === last) continue;
      const model = modelById.get(r.vehicle_model_id);
      if (!model) continue;
      data.push({
        vehicle_model_id: r.vehicle_model_id,
        brand: model.brand,
        model_name: model.display_name,
        item_name: r.item_name,
        times: Number(r.times),
        min_price: Number(r.min_price),
        max_price: Number(r.max_price),
        last_price: last,
        recent_prices: recent,
        stable: recent.length >= 3 && recent.every((p) => p === last),
        standard_price: standard,
      });
    }
    res.json({ success: true, data });
  } catch (err) {
    serverError(res, err, 'โหลดราคาที่พนักงานกรอกไม่สำเร็จ');
  }
});

module.exports = router;
