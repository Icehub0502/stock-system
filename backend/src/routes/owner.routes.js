// Owner view: combined figures of every branch in the owner's group.
// A manager never reaches this (owner and above only), and only shops of the owner's own group are
// ever read — the shop list comes from the database, never from the request.
const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireOwner } = require('../middleware/auth');
const { loadMethodBreakdown } = require('./receipts.routes');

const router = express.Router();
router.use(authenticate, requireOwner);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The group the caller may see: an owner = the group of the shop their account belongs to;
// dev = the group of the shop they are currently in (or ?group_id=).
async function resolveGroupId(req) {
  if (req.user.role === 'dev' && req.query.group_id) return Number(req.query.group_id);
  const homeShopId = req.user.role === 'dev' ? req.shopId : Number(req.user.home_shop_id) || req.shopId;
  const [[home]] = await pool.query('SELECT group_id FROM shops WHERE id = ?', [homeShopId]);
  return home ? home.group_id : null;
}

// GET /api/owner/overview?from=YYYY-MM-DD&to=YYYY-MM-DD  (default: today)
router.get('/overview', async (req, res) => {
  const from = req.query.from || todayStr();
  const to = req.query.to || from;
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to) || from > to) {
    return res.status(400).json({ error: 'ช่วงวันที่ไม่ถูกต้อง' });
  }
  try {
    const groupId = await resolveGroupId(req);
    if (!groupId) return res.status(404).json({ error: 'ไม่พบกลุ่มสาขา' });

    const [shops] = await pool.query(
      'SELECT s.id, s.code, s.name, s.status, g.name AS group_name FROM shops s JOIN shop_groups g ON g.id = s.group_id WHERE s.group_id = ? ORDER BY s.id',
      [groupId]
    );
    const shopIds = shops.map((s) => s.id);
    if (shopIds.length === 0) return res.json({ success: true, data: { from, to, branches: [], total: null } });

    const [receiptRows] = await pool.query(
      `SELECT shop_id, COUNT(*) AS bill_count, COUNT(DISTINCT customer_id) AS customer_count,
              COALESCE(SUM(total_amount), 0) AS total_revenue
       FROM receipts WHERE shop_id IN (?) AND receipt_date BETWEEN ? AND ? GROUP BY shop_id`,
      [shopIds, from, to]
    );
    const [jobRows] = await pool.query(
      'SELECT shop_id, COUNT(*) AS job_count FROM jobs WHERE shop_id IN (?) AND job_date BETWEEN ? AND ? GROUP BY shop_id',
      [shopIds, from, to]
    );
    const receiptsByShop = new Map(receiptRows.map((r) => [r.shop_id, r]));
    const jobsByShop = new Map(jobRows.map((r) => [r.shop_id, r]));

    const branches = [];
    for (const shop of shops) {
      // payment channels: the existing per-day breakdown of the shop, summed over the chosen days
      const perDay = await loadMethodBreakdown("DATE_FORMAT(r.receipt_date, '%Y-%m-%d')", shop.id);
      const byMethod = {};
      for (const [day, methods] of Object.entries(perDay)) {
        if (day < from || day > to) continue;
        for (const [method, v] of Object.entries(methods)) {
          const cur = byMethod[method] || { bill_count: 0, total: 0 };
          byMethod[method] = { bill_count: cur.bill_count + v.bill_count, total: cur.total + v.total };
        }
      }
      const rec = receiptsByShop.get(shop.id);
      branches.push({
        shop_id: shop.id,
        code: shop.code,
        name: shop.name,
        status: shop.status,
        bill_count: Number(rec?.bill_count || 0),
        customer_count: Number(rec?.customer_count || 0),
        total_revenue: Number(rec?.total_revenue || 0),
        job_count: Number(jobsByShop.get(shop.id)?.job_count || 0),
        by_method: byMethod,
      });
    }

    const total = branches.reduce(
      (acc, b) => {
        acc.bill_count += b.bill_count;
        acc.job_count += b.job_count;
        acc.total_revenue += b.total_revenue;
        for (const [method, v] of Object.entries(b.by_method)) {
          const cur = acc.by_method[method] || { bill_count: 0, total: 0 };
          acc.by_method[method] = { bill_count: cur.bill_count + v.bill_count, total: cur.total + v.total };
        }
        return acc;
      },
      { bill_count: 0, job_count: 0, total_revenue: 0, by_method: {} }
    );

    res.json({ success: true, data: { from, to, group_id: groupId, group_name: shops[0].group_name, branches, total } });
  } catch (err) {
    console.error('owner overview failed:', err);
    res.status(500).json({ error: 'โหลดภาพรวมทุกสาขาไม่สำเร็จ' });
  }
});

module.exports = router;
module.exports.resolveGroupId = resolveGroupId; // owner stats use the same group rule
