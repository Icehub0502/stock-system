const express = require('express');
const pool = require('../db/pool');
const { CLOSED_STATUSES, jobStatusLabel } = require('../utils/jobStatusFlow');
const { WORK_BAYS } = require('../utils/workBays');

const router = express.Router();

// ── จอบอร์ดห้องรับรอง (สาธารณะ ไม่ต้องล็อกอิน) ──
//
// ‼️ ข้อมูลลูกค้าถูกตัดออกตั้งแต่ระดับ SQL ไม่ใช่ซ่อนที่หน้าเว็บ — endpoint นี้เปิด
// ให้ใครก็ได้เรียก (จอ TV ในห้องรับรองไม่มีคนล็อกอินให้) ถ้าเลือกคอลัมน์ต้องห้ามมา
// แล้วค่อยไปซ่อนใน React ใครเปิด DevTools/เรียก URL ตรง ๆ ก็เห็นข้อมูลลูกค้าทันที
//
// ห้ามเพิ่มคอลัมน์เหล่านี้เด็ดขาด: customer_name, phone, customer_code, symptom,
// note, total_amount, quotation_no, technician
// (คำเตือนเดียวกันนี้ใช้กับ io.of('/board') ใน realtime.js ด้วย — ห้าม emit ฟิลด์งานใด ๆ บน namespace นั้น)
// สิ่งที่ลูกค้าต้องใช้หารถตัวเองมีแค่: คิว / ทะเบียน / ยี่ห้อ-รุ่น-สี / ช่องยก / สถานะ
// (หลักการเดียวกับ boardPayloadFor ของโปรเจกต์ ChamppowerD)
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT j.id, j.queue_no, j.status, j.bay, j.est_minutes, j.received_at,
             v.license_plate, v.brand, v.model, v.color
      FROM jobs j
      LEFT JOIN vehicles v ON v.id = j.vehicle_id
      WHERE j.job_date = CURDATE()
        AND j.status NOT IN (${CLOSED_STATUSES.map(() => '?').join(',')})
      ORDER BY CAST(j.queue_no AS UNSIGNED), j.id
    `, CLOSED_STATUSES);

    const data = rows.map((r) => ({
      id: r.id,
      queue_no: r.queue_no || '',
      plate: r.license_plate || '',
      brand: r.brand || '',
      model: r.model || '',
      color: r.color || '',
      bay: r.bay || '',
      status: r.status,
      status_label: jobStatusLabel(r.status),
      est_minutes: r.est_minutes,
      received_at: r.received_at,
    }));

    res.json({ success: true, bays: WORK_BAYS, data, server_time: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดข้อมูลบอร์ดไม่สำเร็จ' });
  }
});

module.exports = router;
