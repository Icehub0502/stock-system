// Branch manager page data (manager and above), mounted at /api/manager:
//   GET /today   cars in the shop by status (stuck / late ones flagged), quotations worth chasing, today's money by
//                payment method, deposits not yet closed, stock at or under its minimum.
// Everything is read for the caller's own shop only (req.shopId).
const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireManager } = require('../middleware/auth');
const { loadMethodBreakdown } = require('./receipts.routes');

const router = express.Router();
router.use(authenticate, requireManager);

// A car in the shop longer than this many days is "stuck" and shown in red
const STUCK_DAYS = 3;
// Quotations this old (days) are no longer chased from this page
const CHASE_WINDOW_DAYS = 60;
// Reasons the customer gave when they declined that mean "not now" (the sale can still be won back)
const WIN_BACK_REASONS = ['ขอใบเสนอราคา', 'นำรถมาทำวันอื่น', 'งบไม่พอ'];

// job status → the group the manager sees (rejected / delivered / carout are not in the shop any more)
const STATUS_GROUPS = [
  { key: 'inspect', label: 'รอตรวจ', statuses: ['received', 'inspecting'] },
  { key: 'decide', label: 'รอลูกค้าตัดสินใจ', statuses: ['quoted'] },
  { key: 'waiting', label: 'อนุมัติแล้ว รออะไหล่/รอเริ่มซ่อม', statuses: ['approved'] },
  { key: 'repair', label: 'กำลังซ่อม', statuses: ['repairing', 'aligning'] },
  { key: 'ready', label: 'เสร็จรอรับ', statuses: ['ready'] },
  { key: 'scheduled', label: 'นัดวันมาทำ', statuses: ['scheduled'] },
];

router.get('/today', async (req, res) => {
  try {
    const shopId = req.shopId;
    const [[{ today }]] = await pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today");

    const [jobRows] = await pool.query(
      `SELECT j.id, j.job_no, j.queue_no, j.status, j.bay, j.technician, j.symptom,
              DATEDIFF(CURDATE(), DATE(COALESCE(j.received_at, j.job_date))) AS days_in_shop,
              DATE_FORMAT(q.scheduled_date, '%Y-%m-%d') AS scheduled_date,
              v.license_plate, v.brand, v.model, c.customer_name, c.phone
       FROM jobs j
       LEFT JOIN vehicles v ON v.id = j.vehicle_id
       LEFT JOIN customers c ON c.id = j.customer_id
       LEFT JOIN quotations q ON q.id = j.quotation_id
       WHERE j.shop_id = ? AND j.status IN (?)
       ORDER BY j.id DESC LIMIT 300`,
      [shopId, STATUS_GROUPS.flatMap((g) => g.statuses)]
    );
    const groups = STATUS_GROUPS.map((g) => ({ key: g.key, label: g.label, cars: [] }));
    const groupOf = new Map(STATUS_GROUPS.flatMap((g, i) => g.statuses.map((s) => [s, i])));
    jobRows.forEach((j) => {
      const days = Number(j.days_in_shop) || 0;
      const lateAppointment = Boolean(j.scheduled_date && j.scheduled_date < today);
      // cars booked for a later day are not "stuck" while they wait for that day
      const stuck = j.status !== 'scheduled' && days > STUCK_DAYS;
      groups[groupOf.get(j.status)].cars.push({
        ...j, days_in_shop: days,
        overdue: stuck || lateAppointment,
        overdue_reason: lateAppointment ? 'late_appointment' : (stuck ? 'stuck' : null),
      });
    });
    // red cars first, then the ones that waited longest
    groups.forEach((g) => g.cars.sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.days_in_shop - a.days_in_shop));
    const overdueCount = groups.reduce((n, g) => n + g.cars.filter((c) => c.overdue).length, 0);

    const [chaseRows] = await pool.query(
      `SELECT q.id, q.quotation_no, q.status, q.total_amount, q.symptom,
              DATE_FORMAT(q.quotation_date, '%Y-%m-%d') AS quotation_date,
              DATEDIFF(CURDATE(), q.quotation_date) AS age_days,
              dr.label AS decline_label,
              v.license_plate, v.brand, v.model, c.customer_name, c.phone
       FROM quotations q
       LEFT JOIN customers c ON c.id = q.customer_id
       LEFT JOIN vehicles v ON v.id = q.vehicle_id
       LEFT JOIN decline_reasons dr ON dr.id = q.decline_reason
       WHERE q.shop_id = ? AND q.converted_receipt_id IS NULL
         AND q.quotation_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         AND (q.status IN ('pending', 'no_date') OR (q.status = 'declined' AND dr.label IN (?)))
       ORDER BY q.total_amount DESC LIMIT 100`,
      [shopId, CHASE_WINDOW_DAYS, WIN_BACK_REASONS]
    );
    const chase = chaseRows.map((q) => ({
      ...q, total_amount: Number(q.total_amount), age_days: Number(q.age_days) || 0,
      kind: q.status === 'declined' ? 'later' : 'waiting',
    }));

    const [[todayTotals]] = await pool.query(
      'SELECT COUNT(*) AS bill_count, COALESCE(SUM(total_amount), 0) AS total FROM receipts WHERE shop_id = ? AND receipt_date = CURDATE()',
      [shopId]
    );
    const breakdown = await loadMethodBreakdown("DATE_FORMAT(r.receipt_date, '%Y-%m-%d')", shopId);
    const byMethod = Object.entries(breakdown[today] || {}).map(([method, v]) => ({ method, bill_count: v.bill_count, total: v.total }));

    const [depositRows] = await pool.query(
      `SELECT q.id, q.quotation_no, q.deposit_amount, DATE_FORMAT(q.deposit_date, '%Y-%m-%d') AS deposit_date,
              v.license_plate, v.brand, v.model, c.customer_name, c.phone
       FROM quotations q
       LEFT JOIN customers c ON c.id = q.customer_id
       LEFT JOIN vehicles v ON v.id = q.vehicle_id
       WHERE q.shop_id = ? AND q.deposit_amount > 0 AND q.closed_at IS NULL
         AND q.status <> 'declined' AND q.converted_receipt_id IS NULL
       ORDER BY q.deposit_date DESC, q.id DESC LIMIT 50`,
      [shopId]
    );

    const [[lowCount]] = await pool.query(
      'SELECT COUNT(*) AS n FROM stock_items WHERE shop_id = ? AND is_active = 1 AND stock_qty <= min_stock',
      [shopId]
    );
    const [lowRows] = await pool.query(
      `SELECT i.id, i.oem_code, i.description, i.stock_qty, i.min_stock, cat.name AS category
       FROM stock_items i LEFT JOIN stock_categories cat ON cat.id = i.category_id
       WHERE i.shop_id = ? AND i.is_active = 1 AND i.stock_qty <= i.min_stock
       ORDER BY (i.stock_qty - i.min_stock) ASC, i.id ASC LIMIT 15`,
      [shopId]
    );

    res.json({
      success: true,
      data: {
        today,
        stuck_days: STUCK_DAYS,
        cars: { groups, total: jobRows.length, overdue_count: overdueCount },
        chase: { items: chase, total_value: chase.reduce((s, q) => s + q.total_amount, 0) },
        money: { bill_count: Number(todayTotals.bill_count), total: Number(todayTotals.total), by_method: byMethod },
        deposits: {
          items: depositRows.map((d) => ({ ...d, deposit_amount: Number(d.deposit_amount) })),
          total: depositRows.reduce((s, d) => s + Number(d.deposit_amount), 0),
        },
        stock: { low_count: Number(lowCount.n), items: lowRows },
      },
    });
  } catch (err) {
    console.error('Error loading manager page:', err);
    res.status(500).json({ error: 'โหลดหน้าผู้จัดการไม่สำเร็จ' });
  }
});

module.exports = router;
