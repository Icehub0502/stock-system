const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole, requireManager, roleRank } = require('../middleware/auth');
const { branchCodeOf } = require('../utils/branchCode');
const { isRackText, isRegisterText, warrantyStatus } = require('../utils/warrantyStatus');
const { findWarrantyNumber, numberLabel, relatedDocs } = require('../utils/warrantyNumbers');

// ทะเบียนประกัน: running numbers for rack bills (one number per bill, racks only), and how much warranty is left on
// the racks, suspension sets and ball joints sold. See db/warrantySchema.js.
const router = express.Router();
router.use(authenticate);
router.use(requireRole('office'));

const MAX_ROWS = 500;
const MAX_NO = 99999999;

function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function nextNumber(conn, shopId) {
  const [[shop]] = await conn.query('SELECT warranty_start_no FROM shops WHERE id = ?', [shopId]);
  const [[used]] = await conn.query('SELECT MAX(warranty_no) AS max_no FROM warranty_numbers WHERE shop_id = ?', [shopId]);
  const start = shop?.warranty_start_no ?? null;
  if (start === null) return { start, next: null };
  return { start, next: Math.max(start, (used.max_no || 0) + 1) };
}

// The sold items the register follows, one row per warranty per bill. vehicleId narrows it to one car.
async function loadWarrantyRows(shopId, { vehicleId } = {}) {
  const [items] = await pool.query(
    `SELECT r.id AS receipt_id, r.receipt_no, DATE_FORMAT(r.receipt_date, '%Y-%m-%d') AS receipt_date, r.mileage, r.vehicle_id,
            c.customer_name, c.phone, v.license_plate, v.brand, v.model, v.mileage AS vehicle_mileage,
            COALESCE(ri.product_name_snapshot, s.product_name) AS item_name,
            ri.warranty_name, ri.warranty_year, ri.warranty_month, ri.warranty_km
     FROM receipts r
     JOIN customers c ON c.id = r.customer_id
     LEFT JOIN vehicles v ON v.id = r.vehicle_id
     JOIN receipt_items ri ON ri.receipt_id = r.id
     LEFT JOIN service_items s ON s.id = ri.service_item_id AND s.shop_id = r.shop_id
     WHERE r.shop_id = ? ${vehicleId ? 'AND r.vehicle_id = ?' : ''}
     ORDER BY r.receipt_date DESC, r.id DESC, ri.id`,
    vehicleId ? [shopId, vehicleId] : [shopId]
  );
  const groups = new Map();
  for (const row of items) {
    if (!isRegisterText(row.item_name) && !isRegisterText(row.warranty_name)) continue;
    const key = `${row.receipt_id}|${row.warranty_name || ''}`;
    if (!groups.has(key)) {
      groups.set(key, { ...row, item_names: [], is_rack: false });
    }
    const group = groups.get(key);
    if (row.item_name) group.item_names.push(row.item_name);
    if (isRackText(row.item_name) || isRackText(row.warranty_name)) group.is_rack = true;
  }
  return [...groups.values()].map(({ item_name: dropped, ...group }) => ({
    ...group,
    ...warrantyStatus({
      warrantyYear: group.warranty_year,
      warrantyMonth: group.warranty_month,
      warrantyKm: group.warranty_km,
      startDate: group.receipt_date,
      startKm: group.mileage,
      currentKm: group.vehicle_mileage,
    }),
  }));
}

// every number of the branch, with the receipt it ended up on
async function loadNumbers(shopId) {
  const [rows] = await pool.query(
    `SELECT n.id, n.warranty_no, n.job_id, n.created_by, n.voided_at, n.voided_by,
            COALESCE(n.receipt_id, q.converted_receipt_id) AS resolved_receipt_id,
            j.job_no, rc.receipt_no, c.customer_name, c.phone, v.license_plate, v.brand, v.model,
            DATE_FORMAT(COALESCE(j.job_date, rc.receipt_date), '%Y-%m-%d') AS job_date
     FROM warranty_numbers n
     LEFT JOIN jobs j ON j.id = n.job_id AND j.shop_id = n.shop_id
     LEFT JOIN quotations q ON q.id = j.quotation_id AND q.shop_id = n.shop_id
     LEFT JOIN receipts rc ON rc.id = COALESCE(n.receipt_id, q.converted_receipt_id) AND rc.shop_id = n.shop_id
     LEFT JOIN customers c ON c.id = COALESCE(j.customer_id, rc.customer_id) AND c.shop_id = n.shop_id
     LEFT JOIN vehicles v ON v.id = COALESCE(j.vehicle_id, rc.vehicle_id) AND v.shop_id = n.shop_id
     WHERE n.shop_id = ?
     ORDER BY n.warranty_no DESC`,
    [shopId]
  );
  return rows;
}

router.get('/', async (req, res) => {
  const q = String(req.query.q ?? '').trim().toLowerCase().slice(0, 100);
  const statusFilter = String(req.query.status ?? '');
  try {
    const [rows, numbers, branchCode, numbering] = await Promise.all([
      loadWarrantyRows(req.shopId),
      loadNumbers(req.shopId),
      branchCodeOf(req.shopId),
      nextNumber(pool, req.shopId),
    ]);
    const byReceipt = new Map();
    numbers.filter((n) => !n.voided_at && n.resolved_receipt_id).forEach((n) => byReceipt.set(n.resolved_receipt_id, n));
    const billHasRack = new Set(rows.filter((r) => r.is_rack).map((r) => r.receipt_id));

    const shaped = rows.map((row) => {
      const number = row.is_rack ? byReceipt.get(row.receipt_id) : null;
      return {
        ...row,
        warranty_no: number ? number.warranty_no : null,
        warranty_label: number ? numberLabel(branchCode, number.warranty_no) : null,
        needs_number: row.is_rack && !byReceipt.has(row.receipt_id),
      };
    });
    // a number taken on a job that has no receipt yet, or a number voided: rows of their own, no warranty to count down.
    // A voided row keeps the bill it was on, so the gap in the numbers can be explained.
    const waiting = numbers
      .filter((n) => n.voided_at || (!n.resolved_receipt_id && n.job_id))
      .map((n) => ({
        receipt_id: null,
        job_id: n.job_id,
        job_no: n.job_no,
        receipt_no: n.voided_at ? n.receipt_no : null,
        receipt_date: n.job_date,
        customer_name: n.customer_name,
        phone: n.phone,
        license_plate: n.license_plate,
        brand: n.brand,
        model: n.model,
        warranty_no: n.warranty_no,
        warranty_label: numberLabel(branchCode, n.warranty_no),
        status: n.voided_at ? 'void' : 'waiting',
        voided_by: n.voided_by,
        voided_at: n.voided_at,
        item_names: [],
      }));

    const everything = [...waiting.filter((row) => row.status === 'waiting'), ...shaped];
    const counts = { active: 0, soon: 0, expired: 0, none: 0, waiting: 0, void: 0, needs_number: 0 };
    everything.forEach((row) => {
      counts[row.status] += 1;
      if (row.needs_number) counts.needs_number += 1;
    });
    counts.void = waiting.filter((row) => row.status === 'void').length;

    const voided = waiting.filter((row) => row.status === 'void');
    let list = statusFilter === 'void' ? voided : everything;
    // looking for a number finds it even if it was voided
    if (q && !statusFilter) list = [...everything, ...voided];
    if (statusFilter === 'needs_number') list = list.filter((row) => row.needs_number);
    else if (['active', 'soon', 'expired', 'none', 'waiting'].includes(statusFilter)) list = list.filter((row) => row.status === statusFilter);
    if (q) {
      list = list.filter((row) => [row.license_plate, row.customer_name, row.phone, row.receipt_no, row.job_no, row.warranty_label, ...(row.item_names || [])]
        .some((text) => String(text ?? '').toLowerCase().includes(q)));
    }
    res.json({
      success: true,
      data: {
        rows: list.slice(0, MAX_ROWS),
        total: list.length,
        counts,
        billsWithRack: billHasRack.size,
        branch_code: branchCode,
        start_no: numbering.start,
        next_no: numbering.next,
      },
    });
  } catch (err) {
    console.error('Error loading warranty register:', err);
    res.status(500).json({ error: 'โหลดทะเบียนประกันไม่สำเร็จ' });
  }
});

// The card on a job or a receipt: its number, the next number, and the warranties still running on this car
router.get('/of', async (req, res) => {
  const jobId = parseId(req.query.job_id);
  const receiptId = parseId(req.query.receipt_id);
  if (!jobId === !receiptId) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  try {
    const docs = await relatedDocs(pool, req.shopId, { jobId, receiptId });
    if (!docs) return res.status(404).json({ error: jobId ? 'ไม่พบงานนี้' : 'ไม่พบบิลนี้' });
    const [number, branchCode, numbering] = await Promise.all([
      findWarrantyNumber(pool, req.shopId, docs),
      branchCodeOf(req.shopId),
      nextNumber(pool, req.shopId),
    ]);
    const vehicleRows = docs.vehicleId ? await loadWarrantyRows(req.shopId, { vehicleId: docs.vehicleId }) : [];
    res.json({
      success: true,
      data: {
        has_rack: docs.hasRack,
        warranty_no: number ? number.warranty_no : null,
        warranty_label: number ? numberLabel(branchCode, number.warranty_no) : null,
        number_id: number ? number.id : null,
        branch_code: branchCode,
        start_no: numbering.start,
        next_no: numbering.next,
        vehicle_warranties: vehicleRows.filter((row) => row.status === 'active' || row.status === 'soon'),
      },
    });
  } catch (err) {
    console.error('Error loading warranty number:', err);
    res.status(500).json({ error: 'โหลดเลขประกันไม่สำเร็จ' });
  }
});

// Gives a bill its number: the next one, or a typed one (managers only, to catch up with paper). One bill, one number,
// racks only. Asking again returns the number it already has.
router.post('/assign', async (req, res) => {
  const body = req.body || {};
  const jobId = parseId(body.job_id);
  const receiptId = parseId(body.receipt_id);
  if (!jobId === !receiptId) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  const typed = body.warranty_no === undefined || body.warranty_no === null || body.warranty_no === '' ? null : Number(body.warranty_no);
  if (typed !== null && (!Number.isInteger(typed) || typed < 1 || typed > MAX_NO)) {
    return res.status(400).json({ error: 'เลขประกันต้องเป็นเลขจำนวนเต็มตั้งแต่ 1 ขึ้นไป' });
  }
  if (typed !== null && roleRank(req.user.role) < roleRank('manager')) {
    return res.status(403).json({ error: 'พิมพ์เลขเองได้เฉพาะผู้จัดการ' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    // one number at a time per branch, so two staff never take the same one
    await conn.query('SELECT id FROM shops WHERE id = ? FOR UPDATE', [req.shopId]);

    const fail = async (status, error) => {
      await conn.rollback();
      return res.status(status).json({ error });
    };
    const docs = await relatedDocs(conn, req.shopId, { jobId, receiptId });
    if (!docs) return await fail(404, jobId ? 'ไม่พบงานนี้' : 'ไม่พบบิลนี้');
    if (!docs.hasRack) return await fail(400, 'เลขประกันออกให้เฉพาะงานที่มีการเปลี่ยนแร็ค');

    const branchCode = await branchCodeOf(req.shopId);
    const existing = await findWarrantyNumber(conn, req.shopId, docs);
    if (existing) {
      await conn.rollback();
      return res.json({ success: true, warranty_no: existing.warranty_no, warranty_label: numberLabel(branchCode, existing.warranty_no), already: true });
    }

    let warrantyNo = typed;
    if (warrantyNo === null) {
      const { next } = await nextNumber(conn, req.shopId);
      if (next === null) return await fail(400, 'สาขานี้ยังไม่ได้ตั้งเลขเริ่มต้น ให้ผู้จัดการตั้งที่หน้าทะเบียนประกันก่อน');
      warrantyNo = next;
    }
    await conn.execute(
      'INSERT INTO warranty_numbers (shop_id, warranty_no, job_id, receipt_id, created_by) VALUES (?, ?, ?, ?, ?)',
      [req.shopId, warrantyNo, docs.jobId, docs.jobId ? null : docs.receiptId, req.user.username || null]
    );
    await conn.commit();
    res.status(201).json({ success: true, warranty_no: warrantyNo, warranty_label: numberLabel(branchCode, warrantyNo) });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') {
      const [[taken]] = await pool.query(
        'SELECT voided_at FROM warranty_numbers WHERE shop_id = ? AND warranty_no = ?',
        [req.shopId, body.warranty_no]
      ).catch(() => [[null]]);
      return res.status(409).json({ error: taken?.voided_at ? 'เลขนี้ถูกยกเลิกแล้ว ใช้ซ้ำไม่ได้' : 'เลขนี้ถูกใช้ไปแล้ว' });
    }
    console.error('Error assigning warranty number:', err);
    res.status(500).json({ error: 'ออกเลขประกันไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// A number given by mistake: it stays on record as voided and is not used again
router.post('/numbers/:id/void', requireManager, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  try {
    const [result] = await pool.execute(
      'UPDATE warranty_numbers SET voided_at = NOW(), voided_by = ? WHERE id = ? AND shop_id = ? AND voided_at IS NULL',
      [req.user.username || null, id, req.shopId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'ไม่พบเลขนี้ หรือยกเลิกไปแล้ว' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error voiding warranty number:', err);
    res.status(500).json({ error: 'ยกเลิกเลขไม่สำเร็จ' });
  }
});

// The number this branch counts from. Numbers already given are never touched: the next one is always above them.
router.put('/settings', requireManager, async (req, res) => {
  const startNo = Number(req.body?.start_no);
  if (!Number.isInteger(startNo) || startNo < 1 || startNo > MAX_NO) {
    return res.status(400).json({ error: 'เลขเริ่มต้นต้องเป็นเลขจำนวนเต็มตั้งแต่ 1 ขึ้นไป' });
  }
  try {
    await pool.execute('UPDATE shops SET warranty_start_no = ? WHERE id = ?', [startNo, req.shopId]);
    const { next } = await nextNumber(pool, req.shopId);
    res.json({ success: true, start_no: startNo, next_no: next });
  } catch (err) {
    console.error('Error saving warranty start number:', err);
    res.status(500).json({ error: 'บันทึกเลขเริ่มต้นไม่สำเร็จ' });
  }
});

module.exports = router;
