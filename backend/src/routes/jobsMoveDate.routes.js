const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { MAIN_PATH } = require('../utils/jobStatusFlow');
const { emitJobEvent } = require('../realtime');

// ย้ายรถค้างส่งไปแฟ้มวันอื่น (ปุ่ม "ย้ายไปวันถัดไป/วันก่อนหน้า" ในหน้ารถที่ยังไม่ได้ส่งรถ) =
// เปลี่ยน jobs.job_date ของงานที่เลือก ทำเป็น endpoint แยกไฟล์ (ติดตั้งก่อน jobs.routes.js ใน
// app.js ที่ path เดียวกัน /api/jobs) เพื่อไม่ต้องแตะ jobs.routes.js ที่ใหญ่และมีงานอื่นค้างอยู่
//
// ย้ายหลายคันในทรานแซกชันเดียว (ไม่ยิงทีละคันขนาน) เพราะต้องกำหนดเลขคิวของวันปลายทางไม่ให้ชนกัน
const router = express.Router();
router.use(authenticate);

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_JOBS_PER_MOVE = 100;

// เฉพาะรถที่อยู่ในหน้ารถค้างส่ง: ตั้งแต่ 'approved' จนก่อน 'delivered' (ตรงกับ GET /pending-delivery
// ใน jobs.routes.js) งานที่ส่งแล้ว/ไม่ทำ ย้ายวันไม่ได้
const MOVABLE_STATUSES = MAIN_PATH.slice(MAIN_PATH.indexOf('approved'), MAIN_PATH.indexOf('delivered'));

function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_ONLY_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// body: { ids: [jobId...], job_date: 'YYYY-MM-DD' } — เลขคิวเดิมยังใช้ต่อถ้าไม่ซ้ำกับคันอื่นในวันปลายทาง
// ถ้าซ้ำ (หรือไม่มีเลขคิว) ได้เลขถัดไปของวันนั้น
router.patch('/move-date', requireRole('office'), async (req, res) => {
  const rawIds = req.body?.ids;
  const targetDate = req.body?.job_date;
  if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > MAX_JOBS_PER_MOVE || !isValidDate(targetDate)) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  }
  const ids = [...new Set(rawIds.map(Number))];
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [jobs] = await conn.query(
      'SELECT id, job_no, job_date, queue_no, status FROM jobs WHERE id IN (?) ORDER BY job_date, id FOR UPDATE',
      [ids]
    );
    if (jobs.length !== ids.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบงานบางรายการ (อาจถูกลบไปแล้ว) โหลดหน้าใหม่แล้วลองอีกครั้ง' });
    }
    const blocked = jobs.find((j) => !MOVABLE_STATUSES.includes(j.status));
    if (blocked) {
      await conn.rollback();
      return res.status(400).json({ error: `งาน ${blocked.job_no} ไม่ได้อยู่ในสถานะรถค้างส่งแล้ว ย้ายวันไม่ได้` });
    }

    // เลขคิวที่ถูกใช้แล้วในวันปลายทาง (ล็อกแถวกันคนอื่นแทรกตอนกำลังจัดเลขคิว)
    const [targetRows] = await conn.query(
      'SELECT id, queue_no FROM jobs WHERE job_date = ? FOR UPDATE',
      [targetDate]
    );
    const usedQueues = new Set(targetRows.map((r) => r.queue_no).filter((q) => q !== null && q !== ''));
    let maxNumeric = 0;
    usedQueues.forEach((q) => {
      if (/^\d+$/.test(q)) maxNumeric = Math.max(maxNumeric, Number(q));
    });

    const moved = [];
    for (const job of jobs) {
      const currentDate = job.job_date instanceof Date
        ? `${job.job_date.getFullYear()}-${String(job.job_date.getMonth() + 1).padStart(2, '0')}-${String(job.job_date.getDate()).padStart(2, '0')}`
        : String(job.job_date).slice(0, 10);
      if (currentDate === targetDate) continue; // อยู่วันนั้นอยู่แล้ว

      let queueNo = job.queue_no;
      if (!queueNo || usedQueues.has(queueNo)) {
        maxNumeric += 1;
        queueNo = String(maxNumeric);
      }
      usedQueues.add(queueNo);
      if (/^\d+$/.test(queueNo)) maxNumeric = Math.max(maxNumeric, Number(queueNo));

      await conn.execute('UPDATE jobs SET job_date = ?, queue_no = ? WHERE id = ?', [targetDate, queueNo, job.id]);
      moved.push({ id: job.id, fromDate: currentDate, status: job.status, queue_no: queueNo });
    }

    await conn.commit();

    // แจ้งทั้งวันต้นทางและปลายทาง ให้จอบอร์ด/รายการงานของทั้งสองวันรีเฟรช
    moved.forEach((m) => {
      emitJobEvent('job:updated', { jobId: m.id, jobDate: m.fromDate, status: m.status, actorId: req.user.id });
      emitJobEvent('job:updated', { jobId: m.id, jobDate: targetDate, status: m.status, actorId: req.user.id });
    });

    res.json({ success: true, moved: moved.map((m) => ({ id: m.id, queue_no: m.queue_no })), job_date: targetDate });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('Error moving jobs to another date:', err);
    res.status(500).json({ error: 'ย้ายวันไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
