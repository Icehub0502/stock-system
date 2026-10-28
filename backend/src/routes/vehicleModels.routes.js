const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { normalizeName } = require('../utils/normalizeName');
const { displayModelName } = require('../utils/modelDisplay');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('office'));

// A model is visible to a shop when it is in the shared catalogue ('approved') or it is a model this very
// shop typed in that the administrator has not reviewed yet ('pending'). Other shops never see pending
// models. See db/catalogSchema.js and devCatalog.routes.js (approve / merge / reject).
const VISIBLE = "(status = 'approved' OR (status = 'pending' AND submitted_shop_id = ?))";

// GET /vehicle-models/brands — brands in the catalogue, in the order they were imported
// (lowest id of each brand) so the common brands of the source file come first
router.get('/brands', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT brand, MIN(id) AS first_id
       FROM vehicle_models
       WHERE ${VISIBLE}
       GROUP BY brand
       ORDER BY first_id ASC`,
      [req.shopId]
    );
    res.json({ success: true, data: rows.map((r) => r.brand) });
  } catch (err) {
    console.error('Error loading vehicle model brands:', err);
    res.status(500).json({ error: 'โหลดรายการยี่ห้อไม่สำเร็จ' });
  }
});

// GET /vehicle-models/models?brand=Toyota — models of that brand with a label that includes the year range
// (the same label is used when showing a model and when looking up its parts prices, so the two pages
// cannot disagree on spelling). `pending` marks a model this shop typed in that is still under review.
router.get('/models', async (req, res) => {
  const { brand } = req.query;
  if (!brand) return res.status(400).json({ error: 'กรุณาระบุยี่ห้อ' });
  try {
    const [rows] = await pool.execute(
      `SELECT id, model, year_range, status FROM vehicle_models WHERE brand = ? AND ${VISIBLE} ORDER BY model ASC, year_range ASC, id ASC`,
      [brand, req.shopId]
    );
    const data = rows.map((r) => ({
      id: r.id,
      model: r.model,
      year_range: r.year_range,
      label: r.year_range ? `${r.model} (${r.year_range})` : r.model,
      display_name: displayModelName(r.model, r.year_range),
      pending: r.status === 'pending',
    }));
    res.json({ success: true, data });
  } catch (err) {
    console.error('Error loading vehicle models:', err);
    res.status(500).json({ error: 'โหลดรายการรุ่นรถไม่สำเร็จ' });
  }
});

// POST /vehicle-models — a model that is not in the catalogue, typed in by staff while filling in a job.
// It is NOT added to the shared catalogue: it is stored as 'pending' for this shop only, until the
// administrator approves it. If the typed name matches a model this shop can already see (ignoring case /
// spaces / punctuation) nothing is added and the existing spelling is returned, so a car that is in the
// book but was not found by searching does not get a second entry.
router.post('/', async (req, res) => {
  const brandInput = req.body.brand?.toString().trim();
  const modelInput = req.body.model?.toString().trim();
  if (!brandInput || !modelInput) {
    return res.status(400).json({ error: 'กรุณากรอกยี่ห้อและรุ่นรถ' });
  }
  if (brandInput.length > 100 || modelInput.length > 100) {
    return res.status(400).json({ error: 'ชื่อยี่ห้อหรือรุ่นยาวเกินไป' });
  }
  try {
    const [brandRows] = await pool.query(`SELECT DISTINCT brand FROM vehicle_models WHERE ${VISIBLE}`, [req.shopId]);
    const brand = brandRows.find((r) => normalizeName(r.brand) === normalizeName(brandInput))?.brand || brandInput;

    const [modelRows] = await pool.execute(
      `SELECT model, year_range FROM vehicle_models WHERE brand = ? AND ${VISIBLE}`,
      [brand, req.shopId]
    );
    const typed = normalizeName(modelInput);
    const existing = modelRows.find((r) => normalizeName(r.model) === typed
      || normalizeName(r.year_range ? `${r.model} (${r.year_range})` : r.model) === typed
      || normalizeName(displayModelName(r.model, r.year_range)) === typed);
    if (existing) {
      return res.json({ success: true, data: { brand, model: displayModelName(existing.model, existing.year_range), existed: true } });
    }

    await pool.execute(
      `INSERT INTO vehicle_models (brand, model, year_range, status, submitted_shop_id, submitted_by, submitted_at)
       VALUES (?, ?, NULL, 'pending', ?, ?, NOW())`,
      [brand, modelInput, req.shopId, String(req.user.full_name || req.user.username || '').slice(0, 100) || null]
    );
    res.status(201).json({ success: true, data: { brand, model: modelInput, pending: true } });
  } catch (err) {
    console.error('Error adding vehicle model:', err);
    res.status(500).json({ error: 'เพิ่มรุ่นรถไม่สำเร็จ' });
  }
});

module.exports = router;
