const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const { jobStatusLabel } = require('../utils/jobStatusFlow');

const router = express.Router();

// ── ติดตามสถานะรถ (สาธารณะ ไม่ต้องล็อกอิน) ──
//
// ‼️ เหมือน board.routes.js — endpoint นี้เปิดให้ใครก็เรียกได้ (ลูกค้าสแกน QR/
// พิมพ์เข้ามาเอง ไม่มีใครล็อกอิน) ต้องพิสูจน์ตัวตนด้วยทะเบียนรถ + เบอร์โทร 4 ตัวท้าย
// ก่อนถึงจะเห็นข้อมูล (ทะเบียนอย่างเดียวไม่พอ เพราะมองเห็นได้จากตัวรถจริง) และ
// ห้ามส่งราคา/ยอดเงินค่าบริการกลับไปเด็ดขาด (deposit เป็นเงินที่ลูกค้าวางเองอยู่แล้ว
// ไม่ใช่ "ราคา" ที่ห้าม แต่ unit_price ของแต่ละรายการห้ามส่ง) และห้ามส่งชื่อช่าง/
// หมายเหตุภายใน (note) — เห็นได้แค่: ข้อมูลรถ, ชื่อลูกค้า(ของตัวเอง), สถานะ/ประวัติ
// สถานะ, รายการที่ทำ (ชื่อ+จำนวน ไม่มีราคา), มัดจำ, รูปรถ/รูปอะไหล่

// จำกัดการค้นหาผิดพลาด กันคนสุ่มเบอร์ 4 ตัวท้าย (10,000 แบบ) ไล่ทีละทะเบียนที่รู้จริง
// — 20 ครั้ง/IP ต่อ 15 นาที นับเฉพาะครั้งที่หาไม่เจอ (ลูกค้าเช็คซ้ำด้วยเบอร์ถูกไม่โดนนับ)
const trackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'ค้นหาบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' },
});

function normalizePlate(plate) {
  return (plate || '').toString().trim().toUpperCase().replace(/\s+/g, '');
}

router.get('/', trackLimiter, async (req, res) => {
  const plate = normalizePlate(req.query.plate);
  const phoneLast4 = (req.query.phone_last4 || '').toString().trim();

  if (!plate) return res.status(400).json({ error: 'กรุณากรอกทะเบียนรถ' });
  if (!/^\d{4}$/.test(phoneLast4)) return res.status(400).json({ error: 'กรุณากรอกเบอร์โทร 4 ตัวท้ายให้ถูกต้อง' });

  try {
    const [vehicleRows] = await pool.execute(
      `SELECT v.id AS vehicle_id, v.license_plate, v.brand, v.model, v.color, c.customer_name
       FROM vehicles v
       JOIN customers c ON c.id = v.customer_id
       WHERE UPPER(REPLACE(v.license_plate, ' ', '')) = ? AND c.phone LIKE CONCAT('%', ?)
       LIMIT 1`,
      [plate, phoneLast4]
    );
    const vehicle = vehicleRows[0];
    if (!vehicle) {
      return res.status(404).json({ error: 'ไม่พบข้อมูล กรุณาตรวจสอบทะเบียนรถและเบอร์โทรอีกครั้ง' });
    }

    // งานที่ยังไม่จบ (ไม่ใช่ delivered/carout) มาก่อนเสมอ ถ้ามีหลายงานเปิดค้าง/จบแล้ว
    // เอาอันล่าสุดของกลุ่มนั้น — ให้ลูกค้าเห็น "งานที่กำลังทำอยู่ตอนนี้" เป็นหลัก ไม่ใช่
    // งานเก่าที่จบไปแล้วเมื่อนานมาแล้ว (ดู "single visit scope" — ไม่โชว์ประวัติทุกครั้ง)
    const [jobRows] = await pool.execute(
      `SELECT j.id, j.job_no, j.queue_no, j.job_date, j.status, j.symptom, j.mileage_in,
              j.received_at, j.closed_at, j.quotation_id,
              q.deposit_amount, q.deposit_date
       FROM jobs j
       LEFT JOIN quotations q ON q.id = j.quotation_id
       WHERE j.vehicle_id = ?
       ORDER BY (j.status NOT IN ('delivered','carout')) DESC, j.job_date DESC, j.id DESC
       LIMIT 1`,
      [vehicle.vehicle_id]
    );
    const job = jobRows[0];
    if (!job) {
      return res.status(404).json({ error: 'ยังไม่มีประวัติการเข้ารับบริการของรถคันนี้' });
    }

    const [history] = await pool.execute(
      'SELECT status, changed_at FROM job_status_history WHERE job_id = ? ORDER BY changed_at, id',
      [job.id]
    );

    const [photos] = await pool.execute(
      "SELECT photo_data, photo_type FROM job_photos WHERE job_id = ? ORDER BY photo_type, sort_order",
      [job.id]
    );

    let items = [];
    if (job.quotation_id) {
      const [itemRows] = await pool.execute(
        'SELECT product_name, quantity FROM quotation_items WHERE quotation_id = ? ORDER BY id',
        [job.quotation_id]
      );
      items = itemRows;
    }

    res.json({
      success: true,
      data: {
        vehicle: {
          license_plate: vehicle.license_plate,
          brand: vehicle.brand,
          model: vehicle.model,
          color: vehicle.color,
        },
        customer_name: vehicle.customer_name,
        job: {
          job_no: job.job_no,
          queue_no: job.queue_no,
          job_date: job.job_date,
          status: job.status,
          status_label: jobStatusLabel(job.status),
          symptom: job.symptom,
          mileage_in: job.mileage_in,
          received_at: job.received_at,
          closed_at: job.closed_at,
        },
        status_history: history.map((h) => ({
          status: h.status,
          status_label: jobStatusLabel(h.status),
          changed_at: h.changed_at,
        })),
        deposit: job.quotation_id && job.deposit_amount
          ? { amount: job.deposit_amount, date: job.deposit_date }
          : null,
        items,
        photos: {
          intake: photos.filter((p) => p.photo_type !== 'part').map((p) => p.photo_data),
          part: photos.filter((p) => p.photo_type === 'part').map((p) => p.photo_data),
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ค้นหาข้อมูลไม่สำเร็จ' });
  }
});

module.exports = router;
