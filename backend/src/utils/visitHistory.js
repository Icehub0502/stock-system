const pool = require('../db/pool');
const { jobStatusLabel } = require('./jobStatusFlow');

// รวม "ทุกครั้งที่เข้ามาใช้บริการ" ของลูกค้า/รถคันหนึ่งเป็นไทม์ไลน์เดียว — ใช้ร่วมกัน
// ทั้ง GET /customers/:id/history (filterColumn='customer_id') และ
// GET /vehicles/:id/history (filterColumn='vehicle_id') เพื่อไม่ให้ตรรกะรวมข้อมูล
// แยกกันเป็น 2 ชุดที่อาจเพี้ยนไม่ตรงกัน (เหมือนแนวทางเดียวกับที่ jobs.routes.js
// import helper จาก quotations.routes.js)
//
// แหล่งข้อมูล 2 ทาง: (1) งาน (jobs) ทุกใบที่ตรง filter พร้อมใบเสนอราคา/ใบเสร็จที่
// ผูกอยู่ (ถ้ามี) และ (2) ใบเสนอราคาที่ไม่ได้มาจากงานเลย (เช่นสร้างจากบอทไลน์/หน้า
// ใบเสนอราคาตรง ๆ) — กันไม่ให้ใบเสนอราคาที่ jobs.quotation_id ชี้ถึงไปแล้วถูกดึงมา
// นับซ้ำอีกรอบในส่วน standalone (เห็นเป็น "ครั้งที่มาใช้บริการ" ซ้ำสองรายการทั้งที่
// เป็นครั้งเดียวกัน)
async function buildVisitHistory(filterColumn, filterId) {
  const [jobRows] = await pool.execute(
    `SELECT j.id AS job_id, j.job_no, j.queue_no, j.job_date, j.status, j.symptom, j.mileage_in,
            q.id AS quotation_id, q.quotation_no, q.status AS quotation_status, q.total_amount,
            q.deposit_amount, q.deposit_date, r.receipt_no
     FROM jobs j
     LEFT JOIN quotations q ON q.id = j.quotation_id
     LEFT JOIN receipts r ON r.id = q.converted_receipt_id
     WHERE j.${filterColumn} = ?
     ORDER BY j.job_date DESC, j.id DESC`,
    [filterId]
  );

  const [standaloneRows] = await pool.execute(
    `SELECT q.id AS quotation_id, q.quotation_no, q.quotation_date, q.status AS quotation_status,
            q.total_amount, q.deposit_amount, q.deposit_date, r.receipt_no
     FROM quotations q
     LEFT JOIN receipts r ON r.id = q.converted_receipt_id
     WHERE q.${filterColumn} = ?
       AND q.id NOT IN (SELECT quotation_id FROM jobs WHERE quotation_id IS NOT NULL)
     ORDER BY q.quotation_date DESC, q.id DESC`,
    [filterId]
  );

  const quotationIds = [...jobRows, ...standaloneRows].map((r) => r.quotation_id).filter(Boolean);
  let itemsByQuotation = {};
  if (quotationIds.length > 0) {
    const [itemRows] = await pool.query(
      'SELECT quotation_id, product_name, quantity, unit_price FROM quotation_items WHERE quotation_id IN (?) ORDER BY id',
      [quotationIds]
    );
    itemsByQuotation = itemRows.reduce((acc, it) => {
      (acc[it.quotation_id] ||= []).push({
        product_name: it.product_name,
        quantity: it.quantity,
        unit_price: it.unit_price,
      });
      return acc;
    }, {});
  }

  const visits = [
    ...jobRows.map((r) => ({
      type: 'job',
      job_no: r.job_no,
      queue_no: r.queue_no,
      date: r.job_date,
      status: r.status,
      status_label: jobStatusLabel(r.status),
      symptom: r.symptom,
      mileage: r.mileage_in,
      quotation_no: r.quotation_no,
      total_amount: r.total_amount,
      deposit_amount: r.deposit_amount,
      deposit_date: r.deposit_date,
      receipt_no: r.receipt_no,
      items: r.quotation_id ? (itemsByQuotation[r.quotation_id] || []) : [],
    })),
    ...standaloneRows.map((r) => ({
      type: 'quotation',
      job_no: null,
      queue_no: null,
      date: r.quotation_date,
      status: r.quotation_status,
      status_label: null,
      symptom: null,
      mileage: null,
      quotation_no: r.quotation_no,
      total_amount: r.total_amount,
      deposit_amount: r.deposit_amount,
      deposit_date: r.deposit_date,
      receipt_no: r.receipt_no,
      items: itemsByQuotation[r.quotation_id] || [],
    })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  return visits;
}

module.exports = { buildVisitHistory };
