// A warranty number can sit on a job or on a receipt. Both directions are worked out here, so a number taken on a job
// shows on its receipt, and a receipt that already has one is not given a second through its job.
const { isRackText } = require('./warrantyStatus');

const numberLabel = (branchCode, warrantyNo) => `${branchCode ? `${branchCode} ` : ''}${warrantyNo}`;

// conn: a connection or the pool. Returns { jobId, receiptId, vehicleId, hasRack }, or null when not found in this shop.
async function relatedDocs(conn, shopId, { jobId, receiptId }) {
  let job = null;
  let receipt = null;
  if (jobId) {
    const [[row]] = await conn.query(
      `SELECT j.id, j.vehicle_id, j.quote_draft, j.quotation_id, q.converted_receipt_id
       FROM jobs j LEFT JOIN quotations q ON q.id = j.quotation_id AND q.shop_id = j.shop_id
       WHERE j.id = ? AND j.shop_id = ?`,
      [jobId, shopId]
    );
    if (!row) return null;
    job = row;
  }
  const linkedReceipt = job ? job.converted_receipt_id : receiptId;
  if (linkedReceipt) {
    const [[row]] = await conn.query('SELECT id, vehicle_id FROM receipts WHERE id = ? AND shop_id = ?', [linkedReceipt, shopId]);
    if (!row && receiptId) return null;
    receipt = row || null;
  }
  if (!job && receipt) {
    const [[row]] = await conn.query(
      `SELECT j.id, j.vehicle_id, j.quote_draft, j.quotation_id
       FROM quotations q JOIN jobs j ON j.quotation_id = q.id AND j.shop_id = q.shop_id
       WHERE q.converted_receipt_id = ? AND q.shop_id = ? ORDER BY j.id DESC LIMIT 1`,
      [receipt.id, shopId]
    );
    job = row || null;
  }

  const names = [];
  if (receipt) {
    const [rows] = await conn.query(
      `SELECT COALESCE(ri.product_name_snapshot, s.product_name) AS name
       FROM receipt_items ri LEFT JOIN service_items s ON s.id = ri.service_item_id AND s.shop_id = ?
       WHERE ri.receipt_id = ?`,
      [shopId, receipt.id]
    );
    rows.forEach((row) => names.push(row.name));
  }
  if (job?.quotation_id) {
    const [rows] = await conn.query('SELECT product_name AS name FROM quotation_items WHERE quotation_id = ?', [job.quotation_id]);
    rows.forEach((row) => names.push(row.name));
  }
  if (job?.quote_draft) {
    try {
      const draft = typeof job.quote_draft === 'string' ? JSON.parse(job.quote_draft) : job.quote_draft;
      (draft.items || []).forEach((item) => names.push(item.product_name));
    } catch {
      // a draft that cannot be read says nothing about racks
    }
  }

  return {
    jobId: job ? job.id : null,
    receiptId: receipt ? receipt.id : null,
    vehicleId: job?.vehicle_id || receipt?.vehicle_id || null,
    hasRack: names.some(isRackText),
  };
}

// The live number of these documents, or null
async function findWarrantyNumber(conn, shopId, { jobId, receiptId }) {
  const [rows] = await conn.query(
    `SELECT id, warranty_no FROM warranty_numbers
     WHERE shop_id = ? AND voided_at IS NULL AND (job_id = ? OR receipt_id = ?)
     ORDER BY id LIMIT 1`,
    [shopId, jobId || 0, receiptId || 0]
  );
  return rows[0] || null;
}

module.exports = { numberLabel, relatedDocs, findWarrantyNumber };
