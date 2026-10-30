// Owner numbers (owner and above), mounted at /api/owner-stats:
//   GET /summary?shops=1,2   revenue / bills / cars today, this month, this year against the earlier periods, daily /
//                            monthly / yearly series, sales forecast, close rate, customer channels, repeat customers,
//                            claims, top items and brands, unusual events, and the branch comparison.
// Only shops of the owner's own group are ever read (the shop list comes from the database; ?shops only narrows it).
// Cost / profit figures are not here yet: nothing stores what the parts cost.
const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireOwner } = require('../middleware/auth');
const { resolveGroupId } = require('./owner.routes');

const router = express.Router();
router.use(authenticate, requireOwner);

// ── date helpers (plain 'YYYY-MM-DD' strings, no time zones) ────────────────

const pad = (n) => String(n).padStart(2, '0');
const parts = (ymd) => ymd.split('-').map(Number);
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const monthKey = (y, m) => `${y}-${pad(m)}`;

function addDays(dateStr, n) {
  const [y, m, d] = parts(dateStr);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// first day of the month `n` months after the one containing dateStr
function monthStart(dateStr, n = 0) {
  const [y, m] = parts(dateStr);
  const total = y * 12 + (m - 1) + n;
  return ymd(Math.floor(total / 12), (total % 12) + 1, 1);
}

// the same elapsed day-of-month in the month `n` months away (clamped to that month's length)
function sameDayInMonth(dateStr, n) {
  const [, , d] = parts(dateStr);
  const start = monthStart(dateStr, n);
  const [y, m] = parts(start);
  return ymd(y, m, Math.min(d, daysInMonth(y, m)));
}

// ── forecast ────────────────────────────────────────────────────────────────

// monthly: full months in order, [{ month: 'YYYY-MM', revenue }] (the running month is not part of it)
// Returns the projection of the running month (run rate) and of the months up to December (linear trend of the last
// 12 full months, with a band of ±1.28 residual standard deviations ≈ 80%), plus the projected year total.
// With fewer than 3 full months there is no trend: only the run rate of the running month is given.
function buildForecast({ monthly, today, monthToDate, yearToDate }) {
  const [y, m, d] = parts(today);
  const dim = daysInMonth(y, m);
  const series = monthly.slice(-12).map((r) => Number(r.revenue) || 0);
  const n = series.length;
  // nothing sold yet this month: there is no rate to carry on with (a plain 0 would read as a forecast)
  const runRate = d >= 1 && monthToDate > 0 ? (monthToDate / d) * dim : null;
  const out = {
    months_used: n,
    confidence: n >= 6 ? 'ok' : (n >= 3 ? 'low' : 'none'),
    run_rate: runRate === null ? null : Math.round(runRate),
    days_elapsed: d,
    days_in_month: dim,
    months: [],
    year_end: null,
  };
  if (n < 3) return out;

  const xs = series.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = series.reduce((a, b) => a + b, 0) / n;
  const sxx = xs.reduce((a, x) => a + (x - meanX) ** 2, 0);
  const slope = sxx === 0 ? 0 : xs.reduce((a, x, i) => a + (x - meanX) * (series[i] - meanY), 0) / sxx;
  const intercept = meanY - slope * meanX;
  const resid = Math.sqrt(series.reduce((a, v, i) => a + (v - (intercept + slope * i)) ** 2, 0) / (n - 2));
  const band = 1.28 * resid;
  const trendAt = (idx) => Math.max(0, intercept + slope * idx);
  const point = (likely, basis, key) => ({
    month: key, basis,
    likely: Math.round(likely), low: Math.round(Math.max(0, likely - band)), high: Math.round(likely + band),
  });

  // the running month: the run rate once a week has passed, the trend before that
  const currentLikely = d >= 7 && runRate !== null ? runRate : trendAt(n);
  out.months.push(point(currentLikely, d >= 7 && runRate !== null ? 'run_rate' : 'trend', monthKey(y, m)));
  let restLikely = 0;
  let restLow = 0;
  let restHigh = 0;
  for (let k = 1; k <= 6; k += 1) {
    const [fy, fm] = parts(monthStart(today, k));
    const p = point(trendAt(n + k), 'trend', monthKey(fy, fm));
    out.months.push(p);
    if (fy === y) {
      restLikely += p.likely;
      restLow += p.low;
      restHigh += p.high;
    }
  }
  const cur = out.months[0];
  const remaining = (v) => Math.max(0, v - monthToDate);
  out.year_end = {
    likely: Math.round(yearToDate + remaining(cur.likely) + restLikely),
    low: Math.round(yearToDate + remaining(cur.low) + restLow),
    high: Math.round(yearToDate + remaining(cur.high) + restHigh),
  };
  return out;
}

// ── queries ─────────────────────────────────────────────────────────────────

async function sumRange(shopIds, from, to) {
  const [[r]] = await pool.query(
    `SELECT COALESCE(SUM(total_amount), 0) AS revenue, COUNT(*) AS bills, COUNT(DISTINCT vehicle_id, receipt_date) AS cars
     FROM receipts WHERE shop_id IN (?) AND receipt_date BETWEEN ? AND ?`,
    [shopIds, from, to]
  );
  const revenue = Number(r.revenue);
  const cars = Number(r.cars);
  return { revenue, bills: Number(r.bills), cars, avg_per_car: cars > 0 ? Math.round(revenue / cars) : 0 };
}

async function dailySeries(shopIds, from, to) {
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(receipt_date, '%Y-%m-%d') AS day, COALESCE(SUM(total_amount), 0) AS revenue, COUNT(*) AS bills
     FROM receipts WHERE shop_id IN (?) AND receipt_date BETWEEN ? AND ? GROUP BY day`,
    [shopIds, from, to]
  );
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const r = byDay.get(day);
    out.push({ day, revenue: r ? Number(r.revenue) : 0, bills: r ? Number(r.bills) : 0 });
  }
  return out;
}

async function monthlySeries(shopIds, from, to) {
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(receipt_date, '%Y-%m') AS month, COALESCE(SUM(total_amount), 0) AS revenue, COUNT(*) AS bills,
            COUNT(DISTINCT vehicle_id, receipt_date) AS cars
     FROM receipts WHERE shop_id IN (?) AND receipt_date BETWEEN ? AND ? GROUP BY month`,
    [shopIds, from, to]
  );
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const out = [];
  for (let start = from; start <= to; start = monthStart(start, 1)) {
    const [y, m] = parts(start);
    const r = byMonth.get(monthKey(y, m));
    out.push({ month: monthKey(y, m), revenue: r ? Number(r.revenue) : 0, bills: r ? Number(r.bills) : 0, cars: r ? Number(r.cars) : 0 });
  }
  return out;
}

async function loadCloseRate(shopIds, from, to) {
  const [[t]] = await pool.query(
    `SELECT COUNT(*) AS offered_count, COALESCE(SUM(total_amount), 0) AS offered_value,
            COALESCE(SUM(status = 'approved'), 0) AS approved_count,
            COALESCE(SUM(CASE WHEN status = 'approved' THEN total_amount ELSE 0 END), 0) AS approved_value
     FROM quotations WHERE shop_id IN (?) AND quotation_date BETWEEN ? AND ?`,
    [shopIds, from, to]
  );
  const [reasons] = await pool.query(
    `SELECT COALESCE(CASE WHEN q.decline_reason = 'other' THEN 'อื่น ๆ' ELSE dr.label END, 'ไม่ระบุ') AS reason,
            COUNT(*) AS cnt, COALESCE(SUM(q.total_amount), 0) AS value
     FROM quotations q LEFT JOIN decline_reasons dr ON dr.id = q.decline_reason
     WHERE q.shop_id IN (?) AND q.status = 'declined' AND q.quotation_date BETWEEN ? AND ?
     GROUP BY reason ORDER BY value DESC`,
    [shopIds, from, to]
  );
  const offered = Number(t.offered_value);
  const approved = Number(t.approved_value);
  return {
    offered_count: Number(t.offered_count), offered_value: offered,
    approved_count: Number(t.approved_count), approved_value: approved,
    close_rate_value: offered > 0 ? Math.round((approved / offered) * 1000) / 10 : null,
    decline_reasons: reasons.map((r) => ({ reason: r.reason, count: Number(r.cnt), value: Number(r.value) })),
  };
}

router.get('/summary', async (req, res) => {
  try {
    const groupId = await resolveGroupId(req);
    if (!groupId) return res.status(404).json({ error: 'ไม่พบกลุ่มสาขา' });
    const [groupShops] = await pool.query("SELECT id, name FROM shops WHERE group_id = ? AND status = 'active' ORDER BY id", [groupId]);
    const wanted = String(req.query.shops || '').split(',').map(Number).filter(Boolean);
    // ids outside the group are ignored; nothing valid picked = every branch of the group
    const picked = groupShops.filter((s) => wanted.includes(s.id));
    const shops = picked.length ? picked : groupShops;
    if (shops.length === 0) return res.json({ success: true, data: null });
    const shopIds = shops.map((s) => s.id);

    const [[{ today }]] = await pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today");
    const [ty, tm] = parts(today);
    const [[firstDay]] = await pool.query("SELECT DATE_FORMAT(MIN(receipt_date), '%Y-%m-%d') AS first_day FROM receipts WHERE shop_id IN (?)", [shopIds]);
    const monthFrom = monthStart(today);
    const lastMonthFrom = monthStart(today, -1);
    const lastYearMonthFrom = monthStart(today, -12);
    const yearFrom = ymd(ty, 1, 1);
    const lastYearFrom = ymd(ty - 1, 1, 1);
    const lastYearSameDay = ymd(ty - 1, tm, Math.min(parts(today)[2], daysInMonth(ty - 1, tm)));

    const [
      todaySum, yesterdaySum, monthSum, lastMonthSum, lastYearMonthSum, yearSum, lastYearSum,
      daily, monthly, yearlyRows, closeNow, closePrev,
    ] = await Promise.all([
      sumRange(shopIds, today, today),
      sumRange(shopIds, addDays(today, -1), addDays(today, -1)),
      sumRange(shopIds, monthFrom, today),
      sumRange(shopIds, lastMonthFrom, sameDayInMonth(today, -1)),
      sumRange(shopIds, lastYearMonthFrom, sameDayInMonth(today, -12)),
      sumRange(shopIds, yearFrom, today),
      sumRange(shopIds, lastYearFrom, lastYearSameDay),
      dailySeries(shopIds, addDays(today, -29), today),
      monthlySeries(shopIds, monthStart(today, -23), today),
      pool.query(
        `SELECT YEAR(receipt_date) AS year, COALESCE(SUM(total_amount), 0) AS revenue, COUNT(*) AS bills,
                COUNT(DISTINCT vehicle_id, receipt_date) AS cars
         FROM receipts WHERE shop_id IN (?) GROUP BY year ORDER BY year DESC LIMIT 6`,
        [shopIds]
      ),
      loadCloseRate(shopIds, monthFrom, today),
      loadCloseRate(shopIds, lastMonthFrom, addDays(monthFrom, -1)),
    ]);
    const yearly = yearlyRows[0].map((r) => ({ year: Number(r.year), revenue: Number(r.revenue), bills: Number(r.bills), cars: Number(r.cars) })).reverse();

    // full months only (the running month is not finished), oldest first, empty months before the first sale dropped
    const fullMonths = monthly.filter((r) => r.month < monthKey(ty, tm));
    const firstSale = fullMonths.findIndex((r) => r.revenue > 0);
    const forecast = buildForecast({
      monthly: firstSale === -1 ? [] : fullMonths.slice(firstSale),
      today, monthToDate: monthSum.revenue, yearToDate: yearSum.revenue,
    });

    // branch comparison for the running month
    const [branchRows] = await pool.query(
      `SELECT shop_id, COALESCE(SUM(total_amount), 0) AS revenue, COUNT(*) AS bills, COUNT(DISTINCT vehicle_id, receipt_date) AS cars
       FROM receipts WHERE shop_id IN (?) AND receipt_date BETWEEN ? AND ? GROUP BY shop_id`,
      [shopIds, monthFrom, today]
    );
    const [branchPrev] = await pool.query(
      `SELECT shop_id, COALESCE(SUM(total_amount), 0) AS revenue FROM receipts
       WHERE shop_id IN (?) AND receipt_date BETWEEN ? AND ? GROUP BY shop_id`,
      [shopIds, lastMonthFrom, sameDayInMonth(today, -1)]
    );
    const branchById = new Map(branchRows.map((r) => [r.shop_id, r]));
    const prevById = new Map(branchPrev.map((r) => [r.shop_id, Number(r.revenue)]));
    const branches = shops.map((s) => {
      const r = branchById.get(s.id);
      const revenue = r ? Number(r.revenue) : 0;
      const cars = r ? Number(r.cars) : 0;
      return {
        shop_id: s.id, name: s.name, revenue, bills: r ? Number(r.bills) : 0, cars,
        avg_per_car: cars > 0 ? Math.round(revenue / cars) : 0, revenue_prev: prevById.get(s.id) || 0,
      };
    });

    // customers: channel against revenue, new against returning, claims
    const [channels] = await pool.query(
      `SELECT COALESCE(c.found_via, 'unknown') AS channel, COUNT(DISTINCT r.customer_id) AS customers,
              COUNT(*) AS bills, COALESCE(SUM(r.total_amount), 0) AS revenue
       FROM receipts r LEFT JOIN customers c ON c.id = r.customer_id
       WHERE r.shop_id IN (?) AND r.receipt_date BETWEEN ? AND ? GROUP BY channel ORDER BY revenue DESC`,
      [shopIds, monthFrom, today]
    );
    const [[firstTimers]] = await pool.query(
      `SELECT COUNT(*) AS n FROM (SELECT customer_id, MIN(receipt_date) AS first_day FROM receipts WHERE shop_id IN (?) GROUP BY customer_id) t
       WHERE t.first_day BETWEEN ? AND ?`,
      [shopIds, monthFrom, today]
    );
    const [[activeCustomers]] = await pool.query(
      'SELECT COUNT(DISTINCT customer_id) AS n FROM receipts WHERE shop_id IN (?) AND receipt_date BETWEEN ? AND ?',
      [shopIds, monthFrom, today]
    );
    const [[claimRow]] = await pool.query('SELECT COUNT(*) AS n FROM claims WHERE shop_id IN (?) AND claim_date BETWEEN ? AND ?', [shopIds, monthFrom, today]);

    const [topItems] = await pool.query(
      `SELECT i.product_name_snapshot AS name, SUM(i.amount) AS revenue, SUM(i.qty) AS qty
       FROM receipt_items i JOIN receipts r ON r.id = i.receipt_id
       WHERE r.shop_id IN (?) AND r.receipt_date BETWEEN ? AND ? AND i.amount > 0 AND i.product_name_snapshot IS NOT NULL
       GROUP BY i.product_name_snapshot ORDER BY revenue DESC LIMIT 10`,
      [shopIds, monthFrom, today]
    );
    const [topBrands] = await pool.query(
      `SELECT v.brand AS brand, COUNT(DISTINCT r.vehicle_id, r.receipt_date) AS cars, SUM(r.total_amount) AS revenue
       FROM receipts r JOIN vehicles v ON v.id = r.vehicle_id
       WHERE r.shop_id IN (?) AND r.receipt_date BETWEEN ? AND ? GROUP BY v.brand ORDER BY revenue DESC LIMIT 8`,
      [shopIds, monthFrom, today]
    );

    // unusual events of the running month, as lists to open
    const [discounts] = await pool.query(
      `SELECT r.receipt_no, DATE_FORMAT(r.receipt_date, '%Y-%m-%d') AS day, i.product_name_snapshot AS name, i.amount
       FROM receipt_items i JOIN receipts r ON r.id = i.receipt_id
       WHERE r.shop_id IN (?) AND r.receipt_date BETWEEN ? AND ? AND i.amount < 0 ORDER BY i.amount ASC LIMIT 10`,
      [shopIds, monthFrom, today]
    );
    const [[discountTotal]] = await pool.query(
      `SELECT COALESCE(SUM(i.amount), 0) AS total, COUNT(DISTINCT r.id) AS bills
       FROM receipt_items i JOIN receipts r ON r.id = i.receipt_id
       WHERE r.shop_id IN (?) AND r.receipt_date BETWEEN ? AND ? AND i.amount < 0`,
      [shopIds, monthFrom, today]
    );
    const [deleted] = await pool.query(
      `SELECT entity, label, deleted_by_name, DATE_FORMAT(deleted_at, '%Y-%m-%d %H:%i') AS at, restored_at IS NOT NULL AS restored
       FROM deleted_records WHERE shop_id IN (?) AND entity IN ('receipts', 'quotations') AND deleted_at >= ?
       ORDER BY deleted_at DESC LIMIT 15`,
      [shopIds, monthFrom]
    );
    const [stockAdjust] = await pool.query(
      `SELECT i.oem_code, i.description, m.qty_before, m.qty_after, m.reason, m.note, u.full_name,
              DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i') AS at
       FROM stock_item_movements m JOIN stock_items i ON i.id = m.item_id JOIN users u ON u.id = m.user_id
       WHERE i.shop_id IN (?) AND m.reason IN ('adjust', 'set') AND m.created_at >= ? ORDER BY m.created_at DESC LIMIT 15`,
      [shopIds, monthFrom]
    );

    res.json({
      success: true,
      data: {
        today,
        data_since: firstDay.first_day,
        shops: groupShops.map((s) => ({ id: s.id, name: s.name })),
        selected_shop_ids: shopIds,
        periods: {
          today: { ...todaySum, previous: yesterdaySum },
          month: { ...monthSum, previous: lastMonthSum, last_year: lastYearMonthSum },
          year: { ...yearSum, previous: lastYearSum },
        },
        series: { daily, monthly: monthly.slice(-12), yearly },
        forecast,
        sales: { month: closeNow, previous_month: closePrev },
        customers: {
          channels: channels.map((c) => ({ channel: c.channel, customers: Number(c.customers), bills: Number(c.bills), revenue: Number(c.revenue) })),
          active: Number(activeCustomers.n),
          new: Number(firstTimers.n),
          returning: Math.max(0, Number(activeCustomers.n) - Number(firstTimers.n)),
          claims: Number(claimRow.n),
          claim_rate: monthSum.cars > 0 ? Math.round((Number(claimRow.n) / monthSum.cars) * 1000) / 10 : null,
        },
        top_items: topItems.map((r) => ({ name: r.name, revenue: Number(r.revenue), qty: Number(r.qty) })),
        top_brands: topBrands.map((r) => ({ brand: r.brand, cars: Number(r.cars), revenue: Number(r.revenue) })),
        unusual: {
          discount_total: Number(discountTotal.total), discount_bills: Number(discountTotal.bills),
          discounts: discounts.map((d) => ({ ...d, amount: Number(d.amount) })),
          deleted: deleted.map((d) => ({ ...d, restored: Boolean(d.restored) })),
          stock_adjustments: stockAdjust,
        },
        branches,
        cost: { available: false },
      },
    });
  } catch (err) {
    console.error('Error loading owner stats:', err);
    res.status(500).json({ error: 'โหลดตัวเลขเจ้าของไม่สำเร็จ' });
  }
});

module.exports = router;
module.exports.buildForecast = buildForecast; // unit tests
