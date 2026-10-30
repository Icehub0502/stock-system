// Vehicle history (read only), mounted at /api/vehicle-history:
//   GET /search?search=   find cars (plate / brand / model / customer name / phone / customer code)
//   GET /:id              everything done to one car: receipts with their items, open quotations, claims, the
//                         warranty each sold item carries (and whether it still runs) and the list of parts changed
// Warranty comes from the receipt item as it was sold; when that was never stored (jobs promoted from a draft save no
// warranty on their items) it is looked up from the item's configured warranty by service item id, then by name.
const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { normalizeName } = require('../utils/normalizeName');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('office'));

// categories that are accounting lines, not work done on the car
const NON_WORK_CATEGORIES = new Set(['ส่วนลด', 'ค่าใช้จ่าย']);
const LABOR_PREFIX = 'ค่าแรง';
const OPEN_QUOTATION_STATUSES = ['pending', 'scheduled', 'no_date', 'parts_ready'];

const todayStr = () => new Date().toISOString().slice(0, 10);

// "2026-03-31" + 1 year 6 months → "2027-09-30" (the day is clamped to the end of a shorter month)
function addMonths(dateStr, years, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + (Number(years) || 0) * 12 + (Number(months) || 0);
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

function warrantyLabel({ year, month, km }) {
  const parts = [];
  if (year > 0) parts.push(`${year} ปี`);
  if (month > 0) parts.push(`${month} เดือน`);
  if (km > 0) parts.push(`${km.toLocaleString('en-US')} กม.`);
  return parts.join(' ');
}

// configured warranty of the shop's items, found by service item id or by normalised name
async function loadConfiguredWarranties(shopId) {
  const [rows] = await pool.query(
    `SELECT s.id, s.product_name, s.category, w.warranty_year, w.warranty_month, w.warranty_km
     FROM service_items s
     LEFT JOIN warranties w ON w.id = s.warranty_id AND w.shop_id = s.shop_id
     WHERE s.shop_id = ?`,
    [shopId]
  );
  const byId = new Map();
  const byName = new Map();
  rows.forEach((r) => {
    byId.set(Number(r.id), r);
    const key = normalizeName(r.product_name);
    if (key && !byName.has(key)) byName.set(key, r);
  });
  return { byId, byName };
}

function itemWarranty(item, soldOn, mileage, configured) {
  let year = Number(item.warranty_year) || 0;
  let month = Number(item.warranty_month) || 0;
  let km = Number(item.warranty_km) || 0;
  let source = 'sold';
  if (!year && !month && !km) {
    const cfg = (item.service_item_id && configured.byId.get(Number(item.service_item_id)))
      || configured.byName.get(normalizeName(item.name));
    year = Number(cfg?.warranty_year) || 0;
    month = Number(cfg?.warranty_month) || 0;
    km = Number(cfg?.warranty_km) || 0;
    source = 'configured';
  }
  if (!year && !month && !km) return null;
  const expiresOn = year || month ? addMonths(soldOn, year, month) : null;
  return {
    year, month, km, source,
    label: warrantyLabel({ year, month, km }),
    expires_on: expiresOn,
    km_limit: km > 0 && mileage > 0 ? mileage + km : null,
    active: expiresOn ? expiresOn >= todayStr() : true,
  };
}

router.get('/search', async (req, res) => {
  try {
    const words = String(req.query.search || '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
    // the last term matches the phone without dashes / spaces, so "0891234567" finds "089-123-4567"
    const perWord = "v.license_plate LIKE ? OR v.brand LIKE ? OR v.model LIKE ? OR c.customer_name LIKE ? OR c.phone LIKE ? OR c.customer_code LIKE ? OR REPLACE(REPLACE(c.phone, '-', ''), ' ', '') LIKE ?";
    const where = words.length ? ` AND ${words.map(() => `(${perWord})`).join(' AND ')}` : '';
    const params = [req.shopId, req.shopId, ...words.flatMap((w) => [...Array(6).fill(`%${w}%`), `%${w.replace(/[-\s]/g, '')}%`])];
    const [rows] = await pool.query(
      `SELECT v.id AS vehicle_id, v.brand, v.model, v.color, v.license_plate, v.province,
              c.id AS customer_id, c.customer_name, c.phone,
              (SELECT DATE_FORMAT(MAX(r.receipt_date), '%Y-%m-%d') FROM receipts r WHERE r.vehicle_id = v.id AND r.shop_id = ?) AS last_receipt_date
       FROM vehicles v
       JOIN customers c ON v.customer_id = c.id
       WHERE v.shop_id = ?${where}
       ORDER BY last_receipt_date IS NULL, last_receipt_date DESC, v.id DESC
       LIMIT 30`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error searching vehicle history:', err);
    res.status(500).json({ error: 'ค้นหารถไม่สำเร็จ' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const vehicleId = Number(req.params.id);
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) return res.status(400).json({ error: 'รหัสรถไม่ถูกต้อง' });
    const shopId = req.shopId;

    const [[vehicle]] = await pool.query(
      `SELECT v.id, v.brand, v.model, v.color, v.license_plate, v.province, v.mileage,
              c.id AS customer_id, c.customer_name, c.customer_code, c.phone
       FROM vehicles v JOIN customers c ON v.customer_id = c.id
       WHERE v.id = ? AND v.shop_id = ?`,
      [vehicleId, shopId]
    );
    if (!vehicle) return res.status(404).json({ error: 'ไม่พบรถ' });

    const [receipts] = await pool.query(
      `SELECT id, receipt_no, DATE_FORMAT(receipt_date, '%Y-%m-%d') AS receipt_date, mileage, remark, payment_method,
              technician_name, total_amount
       FROM receipts WHERE vehicle_id = ? AND shop_id = ?
       ORDER BY receipt_date DESC, id DESC LIMIT 200`,
      [vehicleId, shopId]
    );
    const receiptIds = receipts.map((r) => r.id);
    const [receiptItems] = receiptIds.length ? await pool.query(
      `SELECT receipt_id, service_item_id, product_name_snapshot AS name, qty, price, amount,
              warranty_year, warranty_month, warranty_km
       FROM receipt_items WHERE receipt_id IN (?) ORDER BY id`,
      [receiptIds]
    ) : [[]];

    const [quotations] = await pool.query(
      `SELECT id, quotation_no, DATE_FORMAT(quotation_date, '%Y-%m-%d') AS quotation_date, status, symptom,
              converted_receipt_id, total_amount
       FROM quotations WHERE vehicle_id = ? AND shop_id = ?
       ORDER BY quotation_date DESC, id DESC LIMIT 200`,
      [vehicleId, shopId]
    );
    const [jobs] = await pool.query(
      'SELECT id, job_no, quotation_id, symptom, status FROM jobs WHERE vehicle_id = ? AND shop_id = ? ORDER BY id DESC LIMIT 200',
      [vehicleId, shopId]
    );
    const openQuotations = quotations.filter((q) => !q.converted_receipt_id && OPEN_QUOTATION_STATUSES.includes(q.status));
    const [openItems] = openQuotations.length ? await pool.query(
      'SELECT quotation_id, product_name AS name, quantity AS qty, unit_price AS price FROM quotation_items WHERE quotation_id IN (?) ORDER BY id',
      [openQuotations.map((q) => q.id)]
    ) : [[]];

    const [claims] = await pool.query(
      `SELECT id, claim_no, DATE_FORMAT(claim_date, '%Y-%m-%d') AS claim_date, symptom, remark
       FROM claims WHERE vehicle_id = ? AND shop_id = ? ORDER BY claim_date DESC, id DESC LIMIT 100`,
      [vehicleId, shopId]
    );
    const [claimItems] = claims.length ? await pool.query(
      'SELECT claim_id, product_name AS name, quantity AS qty FROM claim_items WHERE claim_id IN (?) ORDER BY id',
      [claims.map((c) => c.id)]
    ) : [[]];

    const configured = await loadConfiguredWarranties(shopId);
    const quotationOfReceipt = new Map(quotations.filter((q) => q.converted_receipt_id).map((q) => [Number(q.converted_receipt_id), q]));
    const jobOfQuotation = new Map(jobs.filter((j) => j.quotation_id).map((j) => [Number(j.quotation_id), j]));

    const visits = receipts.map((r) => {
      const quotation = quotationOfReceipt.get(Number(r.id)) || null;
      const job = quotation ? jobOfQuotation.get(Number(quotation.id)) || null : null;
      const items = receiptItems.filter((i) => i.receipt_id === r.id).map((i) => ({
        name: i.name, qty: i.qty, price: Number(i.price), amount: Number(i.amount),
        warranty: itemWarranty(i, r.receipt_date, Number(r.mileage) || 0, configured),
      }));
      return {
        receipt_id: r.id, receipt_no: r.receipt_no, date: r.receipt_date, mileage: r.mileage, total_amount: Number(r.total_amount),
        technician_name: r.technician_name, remark: r.remark,
        quotation_id: quotation?.id || null, quotation_no: quotation?.quotation_no || null,
        symptom: quotation?.symptom || job?.symptom || null,
        job_id: job?.id || null, job_no: job?.job_no || null,
        items,
      };
    });

    // parts changed on this car (one line per item name, newest first), without discounts / expenses / labour lines
    const changed = new Map();
    visits.forEach((v) => {
      v.items.forEach((i) => {
        const cfg = configured.byName.get(normalizeName(i.name));
        if (!i.name || i.name.startsWith(LABOR_PREFIX) || (cfg && NON_WORK_CATEGORIES.has(cfg.category))) return;
        const row = changed.get(i.name) || { name: i.name, category: cfg?.category || null, times: 0, qty: 0, last_date: v.date, warranty: null };
        row.times += 1;
        row.qty += Number(i.qty) || 0;
        if (!row.warranty && i.warranty) row.warranty = i.warranty;
        changed.set(i.name, row);
      });
    });

    // what still runs: the warranties of items sold, grouped by their terms
    const groups = new Map();
    visits.forEach((v) => {
      v.items.forEach((i) => {
        if (!i.warranty || !i.warranty.active) return;
        const g = groups.get(i.warranty.label) || { label: i.warranty.label, year: i.warranty.year, month: i.warranty.month, km: i.warranty.km, items: [], latest_expires_on: null };
        g.items.push({ name: i.name, sold_on: v.date, expires_on: i.warranty.expires_on, km_limit: i.warranty.km_limit });
        if (i.warranty.expires_on && (!g.latest_expires_on || i.warranty.expires_on > g.latest_expires_on)) g.latest_expires_on = i.warranty.expires_on;
        groups.set(i.warranty.label, g);
      });
    });
    const active_warranties = [...groups.values()].sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month) || b.km - a.km);

    res.json({
      success: true,
      data: {
        vehicle,
        active_warranties,
        changed_items: [...changed.values()],
        visits,
        open_quotations: openQuotations.map((q) => ({
          id: q.id, quotation_no: q.quotation_no, date: q.quotation_date, status: q.status, symptom: q.symptom,
          total_amount: Number(q.total_amount), job_no: jobOfQuotation.get(Number(q.id))?.job_no || null,
          items: openItems.filter((i) => i.quotation_id === q.id).map((i) => ({ name: i.name, qty: i.qty, price: Number(i.price) })),
        })),
        claims: claims.map((c) => ({ ...c, items: claimItems.filter((i) => i.claim_id === c.id).map((i) => ({ name: i.name, qty: i.qty })) })),
      },
    });
  } catch (err) {
    console.error('Error loading vehicle history:', err);
    res.status(500).json({ error: 'โหลดประวัติรถไม่สำเร็จ' });
  }
});

module.exports = router;
