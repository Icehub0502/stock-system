const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const {
  isValidJobStatus,
  CLOSED_STATUSES,
} = require('../utils/jobStatusFlow');
const { ALIGN_BAY, isValidBay } = require('../utils/workBays');

const router = express.Router();
router.use(authenticate);

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// JB-YYMMDD-NNN — เลขรันต่อวัน (รีเซ็ตทุกวัน) ต่างจาก quotation_no ที่รันต่อวันเหมือน
// กันแต่คนละชุด ล็อกด้วย FOR UPDATE ในทรานแซกชันเหมือน generateQuotationNo/
// generateCustomerCode เพื่อกันสองคนกดรับรถพร้อมกันแล้วได้เลขชนกัน
async function generateJobNo(conn, jobDate) {
  const [y, m, d] = jobDate.split('-');
  const prefix = `JB-${y.slice(-2)}${m}${d}-`;
  const [rows] = await conn.execute(
    'SELECT MAX(CAST(SUBSTRING(job_no, -3) AS UNSIGNED)) AS maxNo FROM jobs WHERE job_no LIKE ? FOR UPDATE',
    [`${prefix}%`]
  );
  const next = (rows[0]?.maxNo || 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

// เลขคิวถัดไปของวันนั้น — ใช้ MAX ไม่ใช่ COUNT เพื่อไม่ให้เลขที่พนักงานแก้เอง/ข้ามไป
// ถูกนำกลับมาใช้ซ้ำกับรถคันถัดไป (หลักการเดียวกับ genQueueNo ของ ChamppowerD)
async function nextQueueNo(conn, jobDate) {
  const [rows] = await conn.execute(
    'SELECT MAX(CAST(queue_no AS UNSIGNED)) AS maxQ FROM jobs WHERE job_date = ? FOR UPDATE',
    [jobDate]
  );
  return String((rows[0]?.maxQ || 0) + 1);
}

// รถ 1 คันอยู่ได้ช่องเดียว และงานที่จบแล้ว (ส่งรถ/เอารถลง) ไม่ถือว่ากินช่อง แม้ค่า bay
// จะยังค้างอยู่ในแถว — ผังช่องยกจะได้ไม่โกหกว่ามีรถจอดอยู่ทั้งที่ออกไปแล้ว
async function bayOccupant(conn, bay, excludeJobId = null) {
  const params = [bay, ...CLOSED_STATUSES];
  let sql = `SELECT id, job_no, bay FROM jobs
             WHERE bay = ? AND status NOT IN (${CLOSED_STATUSES.map(() => '?').join(',')})`;
  if (excludeJobId) { sql += ' AND id <> ?'; params.push(excludeJobId); }
  const [rows] = await conn.execute(`${sql} LIMIT 1`, params);
  return rows[0] || null;
}

// ── รายการงาน (ค่าเริ่มต้น = วันนี้) ──
router.get('/', async (req, res) => {
  const jobDate = DATE_ONLY_RE.test(req.query.date || '') ? req.query.date : todayStr();
  try {
    const [rows] = await pool.execute(`
      SELECT j.id, j.job_no, j.queue_no, j.job_date, j.status, j.bay, j.technician,
             j.est_minutes, j.mileage_in, j.symptom, j.note, j.received_at, j.closed_at,
             j.customer_id, j.vehicle_id, j.quotation_id,
             c.customer_name, c.phone,
             v.license_plate, v.brand, v.model, v.color,
             q.quotation_no, q.status AS quotation_status, q.total_amount
      FROM jobs j
      LEFT JOIN customers c ON c.id = j.customer_id
      LEFT JOIN vehicles v ON v.id = j.vehicle_id
      LEFT JOIN quotations q ON q.id = j.quotation_id
      WHERE j.job_date = ?
      ORDER BY CAST(j.queue_no AS UNSIGNED), j.id
    `, [jobDate]);
    res.json({ success: true, date: jobDate, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดรายการงานไม่สำเร็จ' });
  }
});

// ── เลขคิวถัดไป (ให้หน้ารับรถเติมให้อัตโนมัติ) ──
router.get('/next-queue-no', async (req, res) => {
  const jobDate = DATE_ONLY_RE.test(req.query.date || '') ? req.query.date : todayStr();
  try {
    const [rows] = await pool.execute(
      'SELECT MAX(CAST(queue_no AS UNSIGNED)) AS maxQ FROM jobs WHERE job_date = ?',
      [jobDate]
    );
    res.json({ success: true, queue_no: String((rows[0]?.maxQ || 0) + 1) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดเลขคิวไม่สำเร็จ' });
  }
});

// ── ผังช่องยก: ใครอยู่ช่องไหนตอนนี้ ──
router.get('/bays', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT j.id, j.job_no, j.queue_no, j.bay, j.status, j.technician,
             v.license_plate, v.brand, v.model
      FROM jobs j
      LEFT JOIN vehicles v ON v.id = j.vehicle_id
      WHERE j.bay IS NOT NULL AND j.status NOT IN (${CLOSED_STATUSES.map(() => '?').join(',')})
    `, CLOSED_STATUSES);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดผังช่องยกไม่สำเร็จ' });
  }
});

// ── รายละเอียดงาน + ประวัติสถานะ ──
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT j.*, c.customer_name, c.phone, c.customer_code,
             v.license_plate, v.brand, v.model, v.color,
             q.quotation_no, q.status AS quotation_status, q.total_amount
      FROM jobs j
      LEFT JOIN customers c ON c.id = j.customer_id
      LEFT JOIN vehicles v ON v.id = j.vehicle_id
      LEFT JOIN quotations q ON q.id = j.quotation_id
      WHERE j.id = ?
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบงานนี้' });

    const [history] = await pool.execute(`
      SELECT h.status, h.changed_at, u.full_name, u.username
      FROM job_status_history h
      LEFT JOIN users u ON u.id = h.changed_by
      WHERE h.job_id = ?
      ORDER BY h.changed_at, h.id
    `, [req.params.id]);

    res.json({ success: true, data: { ...rows[0], history } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดข้อมูลงานไม่สำเร็จ' });
  }
});

// ── รับรถเข้าคิว ──
// รับ vehicle_id/customer_id ที่มีอยู่แล้วเป็นหลัก (หน้ารับรถค้นทะเบียนเจอก่อน) — ถ้า
// เป็นรถใหม่ หน้าเว็บสร้างลูกค้า/รถผ่าน endpoint เดิม (/customers, /vehicles) ก่อน
// แล้วค่อยส่ง id มาที่นี่ ไม่สร้างซ้ำในนี้เพื่อไม่ให้ตรรกะสร้างลูกค้ากระจายหลายที่
router.post('/', async (req, res) => {
  const {
    vehicle_id = null, customer_id = null, queue_no = null,
    job_date = null, mileage_in = null, symptom = '', note = '',
    technician = null, bay = null, est_minutes = null,
  } = req.body || {};

  if (!vehicle_id) return res.status(400).json({ error: 'กรุณาเลือกรถ' });
  const jobDate = DATE_ONLY_RE.test(job_date || '') ? job_date : todayStr();
  if (bay && !isValidBay(bay)) return res.status(400).json({ error: 'ช่องยกไม่ถูกต้อง' });

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    if (bay) {
      const occupant = await bayOccupant(conn, bay);
      if (occupant) {
        await conn.rollback();
        return res.status(400).json({ error: `ช่อง ${bay} มีรถอยู่แล้ว (${occupant.job_no})` });
      }
    }

    const jobNo = await generateJobNo(conn, jobDate);
    const queueNo = String(queue_no || '').trim() || await nextQueueNo(conn, jobDate);

    const [result] = await conn.execute(
      `INSERT INTO jobs
         (job_no, queue_no, job_date, customer_id, vehicle_id, mileage_in, symptom,
          note, status, bay, technician, est_minutes, created_by)
       VALUES (?,?,?,?,?,?,?,?, 'received', ?,?,?,?)`,
      [jobNo, queueNo, jobDate, customer_id, vehicle_id, mileage_in || null,
       symptom || null, note || null, bay, technician, est_minutes || null, req.user.id]
    );

    await conn.execute(
      'INSERT INTO job_status_history (job_id, status, changed_by) VALUES (?,?,?)',
      [result.insertId, 'received', req.user.id]
    );

    await conn.commit();
    res.status(201).json({ success: true, id: result.insertId, job_no: jobNo, queue_no: queueNo });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'รับรถเข้าคิวไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// ── แก้ไขงาน (ช่าง / ช่องยก / เวลา / อาการ) ──
router.patch('/:id', async (req, res) => {
  const { technician, bay, est_minutes, symptom, note, queue_no, mileage_in } = req.body || {};
  if (bay !== undefined && bay !== null && bay !== '' && !isValidBay(bay)) {
    return res.status(400).json({ error: 'ช่องยกไม่ถูกต้อง' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [rows] = await conn.execute('SELECT * FROM jobs WHERE id = ? FOR UPDATE', [req.params.id]);
    const job = rows[0];
    if (!job) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบงานนี้' });
    }

    const nextBay = bay === undefined ? job.bay : (bay || null);
    if (nextBay && nextBay !== job.bay) {
      const occupant = await bayOccupant(conn, nextBay, job.id);
      if (occupant) {
        await conn.rollback();
        return res.status(400).json({ error: `ช่อง ${nextBay} มีรถอยู่แล้ว (${occupant.job_no})` });
      }
    }

    await conn.execute(
      `UPDATE jobs SET technician = ?, bay = ?, est_minutes = ?, symptom = ?,
                       note = ?, queue_no = ?, mileage_in = ?
       WHERE id = ?`,
      [
        technician === undefined ? job.technician : (technician || null),
        nextBay,
        est_minutes === undefined ? job.est_minutes : (est_minutes || null),
        symptom === undefined ? job.symptom : (symptom || null),
        note === undefined ? job.note : (note || null),
        queue_no === undefined ? job.queue_no : (String(queue_no).trim() || null),
        mileage_in === undefined ? job.mileage_in : (mileage_in || null),
        job.id,
      ]
    );

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'แก้ไขงานไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// ── เปลี่ยนสถานะงาน ──
// ทำ 3 อย่างในทรานแซกชันเดียว: อัปเดตสถานะ, บันทึกประวัติ, จัดการช่องยก — จุด
// ตัดสินใจ 3 ทางแยก (อนุมัติ/นัดวันมาทำ/ไม่อนุมัติ) ไม่ได้ดันสถานะใบเสนอราคา
// ตรงนี้อีกต่อไป (เดิมทำ UPDATE quotations ตรง ๆ ซึ่งข้าม side effect สำคัญไป
// เช่น "อนุมัติ" ต้องสร้างใบเสร็จด้วย ไม่ใช่แค่เปลี่ยน status) — หน้าเว็บ
// (JobDetailPage.jsx) เรียก endpoint เฉพาะของใบเสนอราคาเอง (/approve, /schedule,
// /decline ใน quotations.routes.js) แยกต่างหาก แล้วค่อยเรียก endpoint นี้เพื่อ
// อัปเดตสถานะงานให้ตรงกันทีหลัง
router.patch('/:id/status', async (req, res) => {
  const { status } = req.body || {};
  if (!isValidJobStatus(status)) return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [rows] = await conn.execute('SELECT * FROM jobs WHERE id = ? FOR UPDATE', [req.params.id]);
    const job = rows[0];
    if (!job) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบงานนี้' });
    }

    // เข้าสถานะ "รอตั้งศูนย์" แล้วจองช่องตั้งศูนย์ให้อัตโนมัติถ้าว่าง — ถ้าไม่ว่างก็
    // คาช่องเดิมไว้รอคิว ไม่ไล่คันที่อยู่ก่อนออก (ตามกติกา nextAlignBay ของ ChamppowerD)
    let nextBay = job.bay;
    if (status === 'aligning' && job.bay !== ALIGN_BAY) {
      const occupant = await bayOccupant(conn, ALIGN_BAY, job.id);
      if (!occupant) nextBay = ALIGN_BAY;
    }
    // งานจบแล้วต้องคายช่องยกออก ไม่งั้นผังจะโชว์ว่ามีรถจอดค้างทั้งที่ออกไปแล้ว
    const isClosed = CLOSED_STATUSES.includes(status);
    if (isClosed) nextBay = null;

    await conn.execute(
      'UPDATE jobs SET status = ?, bay = ?, closed_at = ? WHERE id = ?',
      [status, nextBay, isClosed ? new Date() : null, job.id]
    );
    await conn.execute(
      'INSERT INTO job_status_history (job_id, status, changed_by) VALUES (?,?,?)',
      [job.id, status, req.user.id]
    );

    await conn.commit();
    res.json({ success: true, status, bay: nextBay });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'เปลี่ยนสถานะไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// ── ผูกใบเสนอราคาที่มีอยู่แล้วเข้ากับงานนี้ ──
// (หน้าเว็บสร้างใบเสนอราคาผ่าน endpoint เดิมที่ /quotations แล้วส่ง id กลับมาผูกที่นี่
// — ไม่สร้างใบในนี้ เพื่อไม่ให้ตรรกะออกเลขที่/ใบแจ้งซ่อม/บอทไลน์ กระจายเป็นสองทาง)
router.patch('/:id/quotation', async (req, res) => {
  const { quotation_id } = req.body || {};
  if (!quotation_id) return res.status(400).json({ error: 'ไม่พบเลขที่ใบเสนอราคา' });

  try {
    const [quotes] = await pool.execute('SELECT id FROM quotations WHERE id = ?', [quotation_id]);
    if (!quotes.length) return res.status(404).json({ error: 'ไม่พบใบเสนอราคานี้' });

    const [result] = await pool.execute(
      'UPDATE jobs SET quotation_id = ? WHERE id = ?',
      [quotation_id, req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'ไม่พบงานนี้' });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ผูกใบเสนอราคาไม่สำเร็จ' });
  }
});

module.exports = router;
