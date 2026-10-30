// Parts suppliers of a branch, mounted at /api/suppliers:
//   GET  /        the active suppliers (any signed-in user: the receive form needs them), guide categories first
//   POST /        add one by name (any signed-in user: staff may type a new shop while receiving); an existing name
//                 (any spelling) is returned instead of a duplicate
//   PUT /:id      rename / change the guide categories / hide or show again (manager and above)
// A supplier is never deleted: bills keep its name, and hiding only takes it out of the list.
const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireManager } = require('../middleware/auth');
const { normalizeName } = require('../utils/normalizeName');

const router = express.Router();
router.use(authenticate);

function cleanName(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

// the supplier of this branch with the same name in any spelling, if there is one
async function findByName(db, shopId, name) {
  const [rows] = await db.query('SELECT id, name, guide_categories, is_active FROM suppliers WHERE shop_id = ?', [shopId]);
  const key = normalizeName(name);
  return rows.find((r) => normalizeName(r.name) === key) || null;
}

// shared with the bill form: the id and stored name for a typed supplier name, created when it is new
async function findOrCreateSupplier(db, shopId, rawName) {
  const name = cleanName(rawName);
  if (!name) return { error: 'กรุณาระบุชื่อร้านอะไหล่' };
  if (name.length > 150) return { error: 'ชื่อร้านยาวเกินไป (ไม่เกิน 150 ตัวอักษร)' };
  const existing = await findByName(db, shopId, name);
  if (existing) {
    if (!existing.is_active) await db.query('UPDATE suppliers SET is_active = 1 WHERE id = ? AND shop_id = ?', [existing.id, shopId]);
    return { id: existing.id, name: existing.name };
  }
  const [result] = await db.query('INSERT INTO suppliers (shop_id, name) VALUES (?, ?)', [shopId, name]);
  return { id: result.insertId, name };
}

router.get('/', async (req, res) => {
  try {
    const all = req.query.all === '1' && ['manager', 'owner', 'dev'].includes(req.user.role);
    const [rows] = await pool.query(
      `SELECT s.id, s.name, s.guide_categories, s.is_active,
              (SELECT COUNT(*) FROM receipt_sessions r WHERE r.supplier_id = s.id AND r.shop_id = s.shop_id) AS bills
       FROM suppliers s WHERE s.shop_id = ? ${all ? '' : 'AND s.is_active = 1'} ORDER BY s.name`,
      [req.shopId]
    );
    res.json({ success: true, data: rows.map((r) => ({ ...r, is_active: Boolean(r.is_active), bills: Number(r.bills) })) });
  } catch (err) {
    console.error('Error loading suppliers:', err);
    res.status(500).json({ error: 'โหลดรายชื่อร้านอะไหล่ไม่สำเร็จ' });
  }
});

router.post('/', async (req, res) => {
  try {
    const result = await findOrCreateSupplier(pool, req.shopId, req.body && req.body.name);
    if (result.error) return res.status(400).json({ error: result.error });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    console.error('Error adding supplier:', err);
    res.status(500).json({ error: 'เพิ่มร้านอะไหล่ไม่สำเร็จ' });
  }
});

router.put('/:id', requireManager, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'รหัสไม่ถูกต้อง' });
    const [[current]] = await pool.query('SELECT id, name, guide_categories, is_active FROM suppliers WHERE id = ? AND shop_id = ?', [id, req.shopId]);
    if (!current) return res.status(404).json({ error: 'ไม่พบร้านอะไหล่' });
    const body = req.body || {};
    const name = body.name === undefined ? current.name : cleanName(body.name);
    if (!name || name.length > 150) return res.status(400).json({ error: 'ชื่อร้านไม่ถูกต้อง' });
    const clash = await findByName(pool, req.shopId, name);
    if (clash && clash.id !== id) return res.status(409).json({ error: 'มีร้านชื่อนี้อยู่แล้ว' });
    const guide = body.guide_categories === undefined ? current.guide_categories : (cleanName(body.guide_categories).slice(0, 255) || null);
    const active = body.is_active === undefined ? current.is_active : (body.is_active ? 1 : 0);
    await pool.query('UPDATE suppliers SET name = ?, guide_categories = ?, is_active = ? WHERE id = ? AND shop_id = ?', [name, guide, active, id, req.shopId]);
    // bills keep the name they were made with; the stored copy follows a rename so the list and the bills agree
    if (name !== current.name) await pool.query('UPDATE receipt_sessions SET supplier_name = ? WHERE supplier_id = ? AND shop_id = ?', [name, id, req.shopId]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating supplier:', err);
    res.status(500).json({ error: 'แก้ไขร้านอะไหล่ไม่สำเร็จ' });
  }
});

module.exports = router;
module.exports.findOrCreateSupplier = findOrCreateSupplier;
