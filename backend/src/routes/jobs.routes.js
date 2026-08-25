const express = require('express');
const QRCode = require('qrcode');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const {
  isValidJobStatus,
  CLOSED_STATUSES,
  MAIN_PATH,
} = require('../utils/jobStatusFlow');
const { ALIGN_BAY, isValidBay } = require('../utils/workBays');
const { generateJobNo } = require('../utils/generateJobNo');
const { emitJobEvent, emitQuotationEvent, emitReceiptEvent } = require('../realtime');
// ใช้ตรรกะออกเลขที่/กรองรายการชุดเดียวกับ quotations.routes.js — กันไม่ให้เลขที่
// เอกสาร/กติกากรองรายการแยกกันเป็น 2 ชุดที่อาจเพี้ยนไม่ตรงกันในอนาคต (ดู
// promoteDraftToQuotation ด้านล่าง ที่ใช้ตอน "โปรโมท" quote_draft เป็นใบเสนอราคาจริง)
const {
  generateQuotationNo, generateReceiptNo, generateRepairNoticeCode,
  buildValidItems, findInvalidItems,
} = require('./quotations.routes');

const router = express.Router();
router.use(authenticate);

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// mysql2 ไม่ auto-parse คอลัมน์ JSON ให้ (คืนเป็น string ดิบเสมอ ต่างจากที่บาง
// driver ทำให้) — ต้อง parse เองทุกจุดที่อ่าน jobs.quote_draft ไม่งั้นโค้ดที่ทำ
// `job.quote_draft || {}` แล้ว spread ต่อจะพังเงียบ ๆ (string ถูก spread เป็น
// index ตัวอักษรแทนที่จะเป็น key จริง)
function parseDraft(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
             q.quotation_no, q.status AS quotation_status, q.total_amount,
             q.deposit_amount, q.deposit_date,
             (SELECT p.photo_data FROM job_photos p WHERE p.job_id = j.id AND p.photo_type = 'intake' ORDER BY p.sort_order LIMIT 1) AS photo_thumb
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
             q.quotation_no, q.status AS quotation_status, q.total_amount,
             q.deposit_amount, q.deposit_date,
             q.customer_signature, q.staff_signature
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

    const [photos] = await pool.execute(
      'SELECT id, photo_data, sort_order, photo_type FROM job_photos WHERE job_id = ? ORDER BY photo_type, sort_order',
      [req.params.id]
    );

    res.json({ success: true, data: { ...rows[0], quote_draft: parseDraft(rows[0].quote_draft), history, photos } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดข้อมูลงานไม่สำเร็จ' });
  }
});

// ── QR ติดตามสถานะรถ (ให้พนักงานพิมพ์แปะห้องรับรอง) ──
// เดิมสร้าง QR แยกต่อคัน (เติมทะเบียนอัตโนมัติ) ต้องพิมพ์ใหม่ทุกครั้งที่มีรถเข้า —
// เจ้าของร้านขอเปลี่ยนเป็น QR เดียวคงที่ ลิงก์แค่หน้า /track เฉย ๆ (ลูกค้าพิมพ์
// ทะเบียน+เบอร์โทร 4 ตัวท้ายเองที่หน้านั้น) พิมพ์ครั้งเดียวแปะทิ้งไว้ถาวรได้เลย —
// ไม่ผูกกับงาน/id ไหนอีกต่อไป ย้ายปุ่มมาไว้ที่หน้ารายการงานวันนี้แทนหน้ารายละเอียดงาน
router.get('/qr/track', async (req, res) => {
  try {
    const trackingUrl = `${req.protocol}://${req.get('host')}/track`;
    const qrDataUrl = await QRCode.toDataURL(trackingUrl, { margin: 1, width: 300 });
    res.json({ success: true, tracking_url: trackingUrl, qr_data_url: qrDataUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'สร้าง QR ไม่สำเร็จ' });
  }
});

// ── บิลอื่นๆ ของงานนี้ — เจ้าของร้านขอให้แยกบิลได้เรื่อยๆ ในคิวเดียว (เช่นลูกค้าทำ
// รายการ 1-3 วันนี้ อีกบิลแยกไว้มัดจำ/นัดวันหลัง หรือแค่ขอใบเสนอราคาไว้เฉยๆ) แทนที่
// จะเพิ่มคอลัมน์ผูกใหม่ ใช้ลูกค้า+รถ+วันเดียวกับงานนี้ค้นหาใบเสนอราคาอื่นที่ตรงกัน
// เอาเลย (ใบเสนอราคาทุกใบมี customer_id/vehicle_id/quotation_date อยู่แล้ว) —
// jobs.quotation_id (ถ้ามี) คือ "บิลหลัก" ที่ผูกกับสถานะคิว ส่วนที่เหลือเป็นบิลแยก
// อิสระ ไม่กระทบสถานะคิว สร้างผ่าน POST /quotations ตรงๆ (ดู ExtraBillModal.jsx)
router.get('/:id/quotations', async (req, res) => {
  try {
    const [[job]] = await pool.query(
      'SELECT customer_id, vehicle_id, job_date, quotation_id FROM jobs WHERE id = ?',
      [req.params.id]
    );
    if (!job) return res.status(404).json({ error: 'ไม่พบงานนี้' });
    if (!job.customer_id || !job.vehicle_id) return res.json({ success: true, data: [] });

    const [rows] = await pool.execute(
      `SELECT id, quotation_no, status, total_amount, deposit_amount, deposit_date,
              scheduled_date, closed_at, converted_receipt_id
       FROM quotations
       WHERE customer_id = ? AND vehicle_id = ? AND quotation_date = ?
       ORDER BY created_at ASC`,
      [job.customer_id, job.vehicle_id, job.job_date]
    );
    const data = rows.map((r) => ({ ...r, is_primary: r.id === job.quotation_id }));
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดรายการบิลไม่สำเร็จ' });
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
    technician = null, bay = null, est_minutes = null, photos = [],
    quotation_id: explicitQuotationId = null,
  } = req.body || {};
  let quotation_id = explicitQuotationId;

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

    // ลูกค้าอาจทักไลน์เข้ามาก่อน (บอทไลน์สร้างใบเสนอราคาที่ยังไม่มีรายการให้อัตโนมัติ
    // — ดู lineWebhook.routes.js) แล้วค่อยขับรถมาที่ร้านจริง — ถ้าไม่เช็คตรงนี้ งานที่
    // รับเข้าคิวจะไม่รู้จักใบเสนอราคานั้นเลย พอกดอนุมัติทีหลัง (promoteDraftToQuotation
    // ด้านล่าง) จะสร้างใบใหม่ซ้อนขึ้นมาอีกใบ ทั้งที่ลูกค้าถือเลขที่ใบเดิมไปแล้ว (เคยเกิด
    // จริง — ใบเสนอราคาที่บอทไลน์สร้างไว้ค้างเป็น pending ว่างเปล่าไม่มีใครอ้างอิงถึง)
    // ผูกอัตโนมัติเฉพาะตอนไม่มีการระบุ quotation_id มาตรง ๆ เท่านั้น (ไม่ทับการเลือก
    // ที่ตั้งใจมาจาก "สร้างคิว" ใน AppointmentsPage.jsx)
    if (!quotation_id && customer_id && vehicle_id) {
      // จำกัดแค่ใบที่สร้างวันเดียวกับที่รับรถเข้าคิว (quotation_date = jobDate) กันไป
      // รื้อใบเสนอราคาเก่าที่ค้าง pending มานานเป็นเดือนของลูกค้าประจำที่ไม่เกี่ยวกับ
      // การมาครั้งนี้เลยขึ้นมาผูกผิด ๆ
      const [[pendingQuote]] = await conn.query(
        `SELECT id FROM quotations
         WHERE customer_id = ? AND vehicle_id = ? AND status = 'pending' AND quotation_date = ?
           AND id NOT IN (SELECT quotation_id FROM jobs WHERE quotation_id IS NOT NULL)
         ORDER BY created_at DESC LIMIT 1`,
        [customer_id, vehicle_id, jobDate]
      );
      if (pendingQuote) quotation_id = pendingQuote.id;
    }

    // สร้างงานจากใบเสนอราคาเดิม (เช่นลูกค้ามัดจำไว้แล้ว วันนัดถึงแล้วมาทำจริง หรือ
    // ผูกอัตโนมัติจากขั้นตอนด้านบน) — ผูก quotation_id ตั้งแต่ตอนสร้างเลย แทนที่จะต้อง
    // เรียก PATCH /:id/quotation แยกอีกที เช็คว่ายังไม่เคยมีงานอื่นผูกใบนี้ไปแล้วก่อน
    // เสมอ กันกดซ้ำสองแท็บแล้วได้งานซ้อนกันสองใบจากใบเดียว
    if (quotation_id) {
      const [[quote]] = await conn.query('SELECT id FROM quotations WHERE id = ? FOR UPDATE', [quotation_id]);
      if (!quote) {
        await conn.rollback();
        return res.status(400).json({ error: 'ไม่พบใบเสนอราคาที่จะผูก' });
      }
      // บล็อกเฉพาะกรณีที่ยังมีงาน "เปิดอยู่" ผูกใบนี้ค้างอยู่ — ใบที่ลูกค้ามัดจำแล้ว
      // ขับรถกลับไปก่อน (งานเดิมจบเป็น carout) ต้องรับรถกลับเข้าคิวใหม่ได้เมื่อถึงวันนัด
      const [[existingLink]] = await conn.query(
        `SELECT id FROM jobs
         WHERE quotation_id = ? AND status NOT IN (${CLOSED_STATUSES.map(() => '?').join(',')})
         LIMIT 1`,
        [quotation_id, ...CLOSED_STATUSES]
      );
      if (existingLink) {
        await conn.rollback();
        return res.status(400).json({ error: 'ใบเสนอราคานี้มีงานที่กำลังดำเนินการอยู่แล้ว' });
      }
    }

    const jobNo = await generateJobNo(conn, jobDate);

    // เลขคิวที่ client ส่งมา (เดาไว้ตอนเปิดฟอร์ม จาก GET /next-queue-no แบบไม่ล็อก)
    // อาจเก่าไปแล้วตอนกด submit จริง — ถ้าพนักงาน 2 คนเปิดฟอร์มพร้อมกันจะได้เลข
    // แนะนำเดียวกัน แล้วทั้งคู่ส่งเลขเดียวกันมาโดยไม่รู้ตัว เดิมโค้ดเชื่อเลขที่ client
    // ส่งมาตรง ๆ เลย (ข้าม nextQueueNo/FOR UPDATE ไปทั้งหมดถ้ามีเลขส่งมา) ทำให้ได้
    // คิวซ้ำกันจริงตามที่เจ้าของร้านแจ้ง — ตอนนี้ล็อกแถวคิววันนี้ไว้ก่อนเสมอ (ไม่ว่า
    // client จะส่งเลขมาหรือไม่) แล้วเช็คว่าเลขที่ขอมาชนกับงานอื่นที่มีอยู่แล้วไหม ถ้าชน
    // เลื่อนไปเลขถัดไปที่ว่างให้อัตโนมัติ (mirror ตรรกะเดียวกับที่ lineWebhook.routes.js
    // ใช้กันคิวจากไลน์ชนกัน)
    const [todayQueueRows] = await conn.execute(
      `SELECT queue_no FROM jobs WHERE job_date = ? AND queue_no REGEXP '^[0-9]+$' FOR UPDATE`,
      [jobDate]
    );
    const requestedQueueNo = String(queue_no || '').trim();
    let queueNo;
    if (requestedQueueNo && /^\d+$/.test(requestedQueueNo) && todayQueueRows.some((r) => r.queue_no === requestedQueueNo)) {
      const maxQ = todayQueueRows.reduce((max, r) => Math.max(max, Number(r.queue_no)), 0);
      queueNo = String(maxQ + 1);
    } else if (requestedQueueNo) {
      queueNo = requestedQueueNo;
    } else {
      const maxQ = todayQueueRows.reduce((max, r) => Math.max(max, Number(r.queue_no)), 0);
      queueNo = String(maxQ + 1);
    }

    const [result] = await conn.execute(
      `INSERT INTO jobs
         (job_no, queue_no, job_date, customer_id, vehicle_id, mileage_in, symptom,
          note, status, bay, technician, est_minutes, created_by, quotation_id)
       VALUES (?,?,?,?,?,?,?,?, 'received', ?,?,?,?,?)`,
      [jobNo, queueNo, jobDate, customer_id, vehicle_id, mileage_in || null,
       symptom || null, note || null, bay, technician, est_minutes || null, req.user.id, quotation_id || null]
    );

    await conn.execute(
      'INSERT INTO job_status_history (job_id, status, changed_by) VALUES (?,?,?)',
      [result.insertId, 'received', req.user.id]
    );

    // รูปรถ (ถ้ามี) — เรียงตามลำดับที่ส่งมา รูปแรก (index 0) คือรูปปกที่จะโชว์บน
    // การ์ดรายการงานวันนี้ (ดู photo_thumb ใน GET /) จำกัดที่ตัวรูป ไม่ใช่จำนวน —
    // หน้าเว็บย่อรูปก่อนส่งมาแล้ว (utils/resizeImage.js) จึงไม่ต้อง validate ขนาดซ้ำ
    if (Array.isArray(photos) && photos.length > 0) {
      for (let i = 0; i < photos.length; i += 1) {
        const dataUrl = photos[i];
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) continue;
        await conn.execute(
          'INSERT INTO job_photos (job_id, photo_data, sort_order) VALUES (?,?,?)',
          [result.insertId, dataUrl, i]
        );
      }
    }

    await conn.commit();
    emitJobEvent('job:created', { jobId: result.insertId, jobDate, status: 'received', actorId: req.user.id });
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
    emitJobEvent('job:updated', { jobId: job.id, jobDate: job.job_date, status: job.status, actorId: req.user.id });
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
    emitJobEvent('job:status-changed', { jobId: job.id, jobDate: job.job_date, status, actorId: req.user.id });
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

    const [jobRows] = await pool.execute('SELECT job_date, status FROM jobs WHERE id = ?', [req.params.id]);
    const jobRow = jobRows[0] || {};
    emitJobEvent('job:quotation-linked', { jobId: req.params.id, jobDate: jobRow.job_date, status: jobRow.status, actorId: req.user.id });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ผูกใบเสนอราคาไม่สำเร็จ' });
  }
});

// ── ลบงาน (ทั้งคิว) ──
// job_photos/job_status_history ลบตามอัตโนมัติ (ON DELETE CASCADE) ไม่ต้องลบเองที่นี่
// บล็อกเฉพาะกรณีมีใบเสนอราคาที่อนุมัติแล้ว+ผูกใบเสร็จอยู่ (ข้อมูลการเงิน) — เหมือน
// กฎเดียวกับ DELETE /quotations/:id ถ้ามีใบเสนอราคาที่ยัง pending/scheduled/declined
// อยู่ (ยังไม่มีใบเสร็จ) ปล่อยให้ลบได้ตามปกติ ใบเสนอราคานั้นจะกลายเป็นรายการลอย
// จัดการต่อได้ที่หน้าใบเสนอราคาโดยตรง ไม่ต้องพึ่งงานนี้อีกต่อไป
router.delete('/:id', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // ล็อกแถว jobs ก่อน (FOR UPDATE) กันแข่งกับ /quotation/approve ที่กำลังผูก
    // ใบเสร็จให้งานนี้พอดี — ถ้าไม่ล็อก อาจเช็คผ่านตอนยังไม่มีใบเสร็จ แล้วมาลบ
    // ทับหลังใบเสร็จเพิ่งถูกสร้างจริง (เช็คแล้วค่อยลบไม่ atomic)
    const [[job]] = await conn.query(
      `SELECT j.id, j.job_date, j.quotation_id, q.status AS quotation_status, q.converted_receipt_id
       FROM jobs j
       LEFT JOIN quotations q ON q.id = j.quotation_id
       WHERE j.id = ? FOR UPDATE`,
      [req.params.id]
    );
    if (!job) { await conn.rollback(); return res.status(404).json({ error: 'ไม่พบงานนี้' }); }
    if (job.quotation_status === 'approved' && job.converted_receipt_id) {
      await conn.rollback();
      return res.status(409).json({ error: 'งานนี้มีใบเสนอราคาที่อนุมัติและมีใบเสร็จผูกอยู่แล้ว กรุณาจัดการที่ใบเสร็จก่อน' });
    }

    const [result] = await conn.execute('DELETE FROM jobs WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) { await conn.rollback(); return res.status(404).json({ error: 'ไม่พบงานนี้' }); }

    await conn.commit();
    emitJobEvent('job:deleted', { jobId: Number(req.params.id), jobDate: job.job_date, actorId: req.user.id });
    res.json({ success: true, message: 'ลบงานสำเร็จ' });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'ลบงานไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// ── รูปรถตอนรับเข้า (photo_type='intake') — เดิมตั้งได้ครั้งเดียวตอนสร้างงานที่
// หน้า "เพิ่มคิว" เท่านั้น ไม่มีทางเพิ่ม/ลบทีหลังเลย พังกับงานที่สร้างจากไลน์ (ยังไม่
// มีรูปตอนสร้าง ตั้งใจให้มาแนบทีหลังตอนรถถึงร้านจริง — ดู lineWebhook.routes.js) และ
// เคสทั่วไปที่ถ่ายรูปตอนรับรถไม่ครบ/ไม่ชัดต้องมาเพิ่มทีหลัง ไม่จำกัดสถานะงาน (ต่างจาก
// รูปอะไหล่ด้านล่างที่ต้องอนุมัติก่อน) เพราะรูปรับเข้าควรเพิ่มได้ตลอดอายุงาน ──
router.post('/:id/photos', async (req, res) => {
  const { photos } = req.body || {};
  if (!Array.isArray(photos) || photos.length === 0) {
    return res.status(400).json({ error: 'กรุณาแนบรูปอย่างน้อย 1 รูป' });
  }
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[job]] = await conn.query('SELECT id, job_date, status FROM jobs WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!job) { await conn.rollback(); return res.status(404).json({ error: 'ไม่พบงานนี้' }); }

    const [[maxRow]] = await conn.query(
      "SELECT MAX(sort_order) AS maxOrder FROM job_photos WHERE job_id = ? AND photo_type = 'intake'",
      [job.id]
    );
    let nextOrder = (maxRow?.maxOrder ?? -1) + 1;

    const insertedIds = [];
    for (const dataUrl of photos) {
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) continue;
      const [result] = await conn.execute(
        "INSERT INTO job_photos (job_id, photo_data, sort_order, photo_type) VALUES (?,?,?,'intake')",
        [job.id, dataUrl, nextOrder]
      );
      insertedIds.push(result.insertId);
      nextOrder += 1;
    }

    await conn.commit();
    emitJobEvent('job:updated', { jobId: job.id, jobDate: job.job_date, status: job.status, actorId: req.user.id });
    res.status(201).json({ success: true, ids: insertedIds });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'เพิ่มรูปรถไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

router.delete('/:id/photos/:photoId', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[job]] = await conn.query('SELECT id, job_date, status FROM jobs WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!job) { await conn.rollback(); return res.status(404).json({ error: 'ไม่พบงานนี้' }); }

    const [result] = await conn.execute(
      "DELETE FROM job_photos WHERE id = ? AND job_id = ? AND photo_type = 'intake'",
      [req.params.photoId, job.id]
    );
    if (!result.affectedRows) { await conn.rollback(); return res.status(404).json({ error: 'ไม่พบรูปนี้' }); }

    await conn.commit();
    emitJobEvent('job:updated', { jobId: job.id, jobDate: job.job_date, status: job.status, actorId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'ลบรูปรถไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

router.patch('/:id/photos/:photoId/move', async (req, res) => {
  const direction = Number(req.body?.direction);
  if (direction !== -1 && direction !== 1) {
    return res.status(400).json({ error: 'ทิศทางไม่ถูกต้อง' });
  }
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[job]] = await conn.query('SELECT id, job_date, status FROM jobs WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!job) { await conn.rollback(); return res.status(404).json({ error: 'ไม่พบงานนี้' }); }

    const [rows] = await conn.query(
      "SELECT id, sort_order FROM job_photos WHERE job_id = ? AND photo_type = 'intake' ORDER BY sort_order",
      [job.id]
    );
    const idx = rows.findIndex((r) => r.id === Number(req.params.photoId));
    const targetIdx = idx + direction;
    if (idx === -1 || targetIdx < 0 || targetIdx >= rows.length) {
      await conn.rollback();
      return res.status(400).json({ error: 'ไม่สามารถย้ายรูปนี้ได้' });
    }

    const current = rows[idx];
    const target = rows[targetIdx];
    await conn.execute('UPDATE job_photos SET sort_order = ? WHERE id = ?', [target.sort_order, current.id]);
    await conn.execute('UPDATE job_photos SET sort_order = ? WHERE id = ?', [current.sort_order, target.id]);

    await conn.commit();
    emitJobEvent('job:updated', { jobId: job.id, jobDate: job.job_date, status: job.status, actorId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'จัดลำดับรูปไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// รูปอะไหล่ของใหม่ (photo_type='part') เพิ่ม/ดูได้เฉพาะงานที่ผ่านจุดอนุมัติไปแล้ว
// เท่านั้น (อนุมัติ/กำลังซ่อม/รอตั้งศูนย์/พร้อมส่ง/ส่งแล้ว) — ก่อนหน้านั้นยังไม่รู้ว่า
// จะได้ทำจริงไหม (อาจเป็นแค่ร่าง/รอลูกค้าตัดสินใจ) ถ่ายรูปอะไหล่ไปก็ไม่มีประโยชน์
const PART_PHOTO_ALLOWED_STATUSES = MAIN_PATH.slice(MAIN_PATH.indexOf('approved'));

function assertPartPhotosAllowed(job, res) {
  if (!PART_PHOTO_ALLOWED_STATUSES.includes(job.status)) {
    res.status(400).json({ error: 'เพิ่มรูปอะไหล่ได้หลังอนุมัติใบเสนอราคาแล้วเท่านั้น' });
    return false;
  }
  return true;
}

// ── รูปอะไหล่ของใหม่ก่อนใส่ — เพิ่ม/ลบ/จัดลำดับได้ตลอด ต่างจากรูปรถตอนรับเข้าคิว
// (intake) ที่ตั้งครั้งเดียวตอนสร้างงาน ให้ลูกค้าดูภายหลังว่าเปลี่ยนอะไหล่ของจริง
// ตรงตามที่เสนอราคาไว้ (ดู PART_PHOTO_ALLOWED_STATUSES ด้านบน) ──
router.post('/:id/part-photos', async (req, res) => {
  const { photos } = req.body || {};
  if (!Array.isArray(photos) || photos.length === 0) {
    return res.status(400).json({ error: 'กรุณาแนบรูปอย่างน้อย 1 รูป' });
  }
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // ล็อกแถวงานไว้ระหว่างคำนวณ sort_order ถัดไป+อินเสิร์ต กันสองคำขออัปโหลด
    // พร้อมกันคำนวณ MAX(sort_order) ตัวเดียวกันแล้วได้เลขซ้ำกัน และห่อทุกอินเสิร์ต
    // ในทรานแซกชันเดียวกันกันเหลือรูปค้างครึ่งๆ กลางๆ ถ้าพังกลางทาง
    const [[job]] = await conn.query('SELECT id, job_date, status FROM jobs WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!job) { await conn.rollback(); return res.status(404).json({ error: 'ไม่พบงานนี้' }); }
    if (!assertPartPhotosAllowed(job, res)) { await conn.rollback(); return; }

    const [[maxRow]] = await conn.query(
      "SELECT MAX(sort_order) AS maxOrder FROM job_photos WHERE job_id = ? AND photo_type = 'part'",
      [job.id]
    );
    let nextOrder = (maxRow?.maxOrder ?? -1) + 1;

    const insertedIds = [];
    for (const dataUrl of photos) {
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) continue;
      const [result] = await conn.execute(
        "INSERT INTO job_photos (job_id, photo_data, sort_order, photo_type) VALUES (?,?,?,'part')",
        [job.id, dataUrl, nextOrder]
      );
      insertedIds.push(result.insertId);
      nextOrder += 1;
    }

    await conn.commit();
    emitJobEvent('job:updated', { jobId: job.id, jobDate: job.job_date, status: job.status, actorId: req.user.id });
    res.status(201).json({ success: true, ids: insertedIds });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'เพิ่มรูปอะไหล่ไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

router.delete('/:id/part-photos/:photoId', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[job]] = await conn.query('SELECT id, job_date, status FROM jobs WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!job) { await conn.rollback(); return res.status(404).json({ error: 'ไม่พบงานนี้' }); }
    if (!assertPartPhotosAllowed(job, res)) { await conn.rollback(); return; }

    const [result] = await conn.execute(
      "DELETE FROM job_photos WHERE id = ? AND job_id = ? AND photo_type = 'part'",
      [req.params.photoId, job.id]
    );
    if (!result.affectedRows) { await conn.rollback(); return res.status(404).json({ error: 'ไม่พบรูปนี้' }); }

    await conn.commit();
    emitJobEvent('job:updated', { jobId: job.id, jobDate: job.job_date, status: job.status, actorId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'ลบรูปอะไหล่ไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// สลับลำดับกับรูปอะไหล่ข้างเคียง (direction: -1 ถอยขึ้น / 1 เลื่อนลง) — เหมือน
// movePhoto ฝั่ง AddJobModal.jsx แต่ต้องยิง API ทีละคู่ เพราะรูปเหล่านี้ถูกบันทึก
// ทีละรูปแล้ว (ไม่ใช่ก้อนเดียวตอนสร้างงานที่ยังจัดเรียงในหน่วยความจำได้ก่อนบันทึก)
router.patch('/:id/part-photos/:photoId/move', async (req, res) => {
  const direction = Number(req.body?.direction);
  if (direction !== -1 && direction !== 1) {
    return res.status(400).json({ error: 'ทิศทางไม่ถูกต้อง' });
  }
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[job]] = await conn.query('SELECT id, job_date, status FROM jobs WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!job) { await conn.rollback(); return res.status(404).json({ error: 'ไม่พบงานนี้' }); }
    if (!assertPartPhotosAllowed(job, res)) { await conn.rollback(); return; }

    const [rows] = await conn.query(
      "SELECT id, sort_order FROM job_photos WHERE job_id = ? AND photo_type = 'part' ORDER BY sort_order",
      [job.id]
    );
    const idx = rows.findIndex((r) => r.id === Number(req.params.photoId));
    const targetIdx = idx + direction;
    if (idx === -1 || targetIdx < 0 || targetIdx >= rows.length) {
      await conn.rollback();
      return res.status(400).json({ error: 'ไม่สามารถย้ายรูปนี้ได้' });
    }

    const current = rows[idx];
    const target = rows[targetIdx];
    await conn.execute('UPDATE job_photos SET sort_order = ? WHERE id = ?', [target.sort_order, current.id]);
    await conn.execute('UPDATE job_photos SET sort_order = ? WHERE id = ?', [current.sort_order, target.id]);

    await conn.commit();
    emitJobEvent('job:updated', { jobId: job.id, jobDate: job.job_date, status: job.status, actorId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'จัดลำดับรูปไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// ── บันทึกร่างรายการ/ราคา/มัดจำก่อนตัดสินใจ ──
// ยังไม่สร้างแถวใน quotations เลย — เก็บไว้ใน jobs.quote_draft (JSON) เท่านั้น
// จนกว่าจะกด อนุมัติ/นัดวันมาทำ/ไม่ทำ อย่างใดอย่างหนึ่ง (ดู POST /:id/quotation/*
// ด้านล่าง) กันไม่ให้ทุกครั้งที่พนักงานติ๊กเลือกอะไหล่สร้างใบเสนอราคาจริงทันที
router.patch('/:id/quote-draft', async (req, res) => {
  const { items, remark, deposit_amount, deposit_date } = req.body || {};

  const invalidItems = findInvalidItems(items);
  if (invalidItems.length > 0) {
    return res.status(400).json({ error: `จำนวนของรายการ "${invalidItems[0].product_name}" ไม่ถูกต้อง กรุณาตรวจสอบ` });
  }
  const validItems = buildValidItems(items);
  if (validItems.length === 0) {
    return res.status(400).json({ error: 'กรุณาเลือกรายการอย่างน้อย 1 รายการ' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // ล็อกแถวไว้ระหว่างอ่าน-แก้-เขียน quote_draft กันพนักงานบันทึกรายการชนกับ
    // ลูกค้า/พนักงานเซ็นชื่อพร้อมกัน (endpoint ลายเซ็นด้านล่างก็ล็อกแบบเดียวกัน) —
    // ไม่งั้นใครเขียนทีหลังจะทับข้อมูลของอีกฝั่งหายไปเงียบ ๆ
    const [[job]] = await conn.query('SELECT id, job_date, quote_draft FROM jobs WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!job) { await conn.rollback(); return res.status(404).json({ error: 'ไม่พบงานนี้' }); }

    const prevDraft = parseDraft(job.quote_draft);
    const nextDraft = {
      ...prevDraft,
      items: validItems.map((i) => ({
        product_name: i.product_name,
        quantity: parseInt(i.quantity || 1),
        unit_price: parseFloat(i.unit_price || 0),
      })),
      remark: remark === undefined ? (prevDraft.remark || null) : (remark || null),
      deposit_amount: deposit_amount === undefined
        ? (prevDraft.deposit_amount ?? null)
        : (deposit_amount === '' || deposit_amount === null ? null : Number(deposit_amount)),
      deposit_date: deposit_date === undefined ? (prevDraft.deposit_date || null) : (deposit_date || null),
    };

    await conn.execute('UPDATE jobs SET quote_draft = ? WHERE id = ?', [JSON.stringify(nextDraft), job.id]);
    await conn.commit();
    emitJobEvent('job:updated', { jobId: job.id, jobDate: job.job_date, status: null, actorId: req.user.id });
    res.json({ success: true, quote_draft: nextDraft });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'บันทึกข้อมูลไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// ── ลายเซ็นลูกค้า/ผู้เสนอราคา บนร่าง (ก่อนมีใบเสนอราคาจริง) ──
// mirror /quotations/:id/signature และ /quotations/:id/staff-signature แต่เขียนลง
// jobs.quote_draft แทน — ลูกค้าเซ็นดูราคาได้แม้ยังไม่ตัดสินใจ ไม่ต้องรอสร้างใบจริงก่อน
router.patch('/:id/quote-draft/signature', async (req, res) => {
  const { signature } = req.body || {};
  if (!signature || !signature.startsWith('data:image/')) {
    return res.status(400).json({ error: 'ข้อมูลลายเซ็นไม่ถูกต้อง' });
  }
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[job]] = await conn.query('SELECT id, job_date, quote_draft FROM jobs WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!job) { await conn.rollback(); return res.status(404).json({ error: 'ไม่พบงานนี้' }); }
    const nextDraft = { ...parseDraft(job.quote_draft), customer_signature: signature };
    await conn.execute('UPDATE jobs SET quote_draft = ? WHERE id = ?', [JSON.stringify(nextDraft), job.id]);
    await conn.commit();
    emitJobEvent('job:updated', { jobId: job.id, jobDate: job.job_date, status: null, actorId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'บันทึกลายเซ็นไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

router.patch('/:id/quote-draft/staff-signature', async (req, res) => {
  const { signature, staff_name } = req.body || {};
  if (!signature || !signature.startsWith('data:image/')) {
    return res.status(400).json({ error: 'ข้อมูลลายเซ็นไม่ถูกต้อง' });
  }
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[job]] = await conn.query('SELECT id, job_date, quote_draft FROM jobs WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!job) { await conn.rollback(); return res.status(404).json({ error: 'ไม่พบงานนี้' }); }
    const nextDraft = { ...parseDraft(job.quote_draft), staff_signature: signature, staff_name: staff_name?.trim() || null };
    await conn.execute('UPDATE jobs SET quote_draft = ? WHERE id = ?', [JSON.stringify(nextDraft), job.id]);
    await conn.commit();
    emitJobEvent('job:updated', { jobId: job.id, jobDate: job.job_date, status: null, actorId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'บันทึกลายเซ็นไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// สร้างใบเสนอราคาจริงจาก quote_draft ของงาน (ใช้ร่วมกันทั้ง 3 เส้นทางตัดสินใจ
// ด้านล่าง: approve/schedule/decline) — mirror ตรรกะ POST /quotations เดิมเท่าที่
// จำเป็น (ไม่รองรับ newCustomer/newVehicle เพราะงานมีลูกค้า/รถอยู่แล้วเสมอตอนถึง
// จุดนี้) ต้องเรียกภายใน transaction ของผู้เรียกเท่านั้น (รับ conn เข้ามา ไม่เปิดเอง)
async function promoteDraftToQuotation(conn, job, { status, scheduledDate, declineReason, declineNote, depositAmount, depositDate } = {}) {
  const draft = parseDraft(job.quote_draft);
  const validItems = buildValidItems(draft.items || []);
  if (validItems.length === 0) {
    const err = new Error('ยังไม่มีรายการสินค้า/บริการที่บันทึกไว้ กรุณากด "บันทึกข้อมูล" ก่อน');
    err.statusCode = 400;
    throw err;
  }

  const quotation_no = await generateQuotationNo(conn);
  const total_amount = validItems.reduce((sum, item) => sum + Number(item.quantity || 1) * Number(item.unit_price || 0), 0);

  const [quotationResult] = await conn.execute(
    `INSERT INTO quotations
       (quotation_no, quotation_date, customer_id, vehicle_id, mileage, remark, product_summary,
        total_amount, queue_no, symptom, deposit_amount, deposit_date, customer_signature,
        staff_signature, staff_name, status, scheduled_date, decline_reason, decline_note)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      quotation_no, todayStr(), job.customer_id, job.vehicle_id, job.mileage_in || 0,
      draft.remark || null, validItems.map((i) => i.product_name).join(', '), total_amount,
      job.queue_no || null, job.symptom || null,
      depositAmount !== undefined ? depositAmount : (draft.deposit_amount ?? null),
      depositDate !== undefined ? depositDate : (draft.deposit_date || null),
      draft.customer_signature || null, draft.staff_signature || null, draft.staff_name || null,
      status, scheduledDate || null, declineReason || null, declineNote || null,
    ]
  );
  const quotation_id = quotationResult.insertId;

  for (const item of validItems) {
    await conn.execute(
      `INSERT INTO quotation_items (quotation_id, product_id, product_name, quantity, unit_price, warranty_name, warranty_year, warranty_month, warranty_km)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [quotation_id, null, item.product_name, parseInt(item.quantity || 1), parseFloat(item.unit_price || 0), null, 0, 0, 0]
    );
  }

  // ใบแจ้งซ่อมคู่กัน เหมือน POST /quotations เดิม — สร้างตอนโปรโมทนี้เลย ไม่ต้องรอ
  // ขั้นอนุมัติ (รถขึ้นทะเบียนในหน้าใบแจ้งซ่อมได้ทันทีที่มีใบเสนอราคาจริงแล้ว)
  if (job.vehicle_id) {
    const rnCode = await generateRepairNoticeCode(conn);
    await conn.execute(
      `INSERT INTO repair_notices (code, customer_id, vehicle_id, quotation_id, notice_date, checklist)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [rnCode, job.customer_id, job.vehicle_id, quotation_id, todayStr(), '{}']
    );
  }

  return { quotation_id, quotation_no, total_amount };
}

// เช็คร่วมกันทั้ง 3 endpoint ด้านล่าง — งานต้องยังไม่มีใบเสนอราคาผูกอยู่ (ถ้ามีแล้ว
// เช่นมาจากไลน์บอทที่สร้างใบเสนอราคาให้ตั้งแต่ต้น ให้ใช้หน้า/endpoint ของใบเสนอราคา
// ปกติแทน — ดู handleApprove/handleSchedule/handleDeclineConfirm ใน
// frontend/src/pages/JobDetailPage.jsx ที่แยกเส้นทางตาม job.quotation_id) และต้องมี
// รถผูกอยู่แล้ว (ใบเสนอราคาต้องมีรถเสมอ)
function assertPromotable(job, res) {
  if (job.quotation_id) {
    res.status(400).json({ error: 'งานนี้มีใบเสนอราคาอยู่แล้ว กรุณาใช้หน้าจัดการใบเสนอราคาปกติ' });
    return false;
  }
  if (!job.vehicle_id) {
    res.status(400).json({ error: 'งานนี้ยังไม่มีข้อมูลรถ ไม่สามารถสร้างใบเสนอราคาได้' });
    return false;
  }
  return true;
}

// ── อนุมัติ: โปรโมท quote_draft เป็นใบเสนอราคาจริง + สร้างใบเสร็จ ในทีเดียว ──
router.post('/:id/quotation/approve', async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[job]] = await conn.query('SELECT * FROM jobs WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!job) { await conn.rollback(); return res.status(404).json({ error: 'ไม่พบงานนี้' }); }
    if (!assertPromotable(job, res)) { await conn.rollback(); return; }

    let promoted;
    try {
      promoted = await promoteDraftToQuotation(conn, job, { status: 'approved' });
    } catch (err) {
      await conn.rollback();
      return res.status(err.statusCode || 500).json({ error: err.message });
    }
    const { quotation_id, total_amount } = promoted;
    const draft = parseDraft(job.quote_draft);

    const receipt_no = await generateReceiptNo(conn);
    const [receiptResult] = await conn.execute(
      `INSERT INTO receipts (receipt_no, receipt_date, customer_id, vehicle_id, mileage, remark, total_amount, customer_signature, deposit_amount, deposit_date)
       VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?)`,
      [receipt_no, job.customer_id, job.vehicle_id, job.mileage_in || 0, draft.remark || null, total_amount, draft.customer_signature || null, draft.deposit_amount ?? null, draft.deposit_date || null]
    );
    const receiptId = receiptResult.insertId;

    const validItems = buildValidItems(draft.items || []);
    for (const item of validItems) {
      const qty = parseInt(item.quantity || 1);
      const price = parseFloat(item.unit_price || 0);
      await conn.execute(
        `INSERT INTO receipt_items (receipt_id, service_item_id, product_name_snapshot, qty, price, amount, warranty_name, warranty_year, warranty_month, warranty_km)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [receiptId, item.product_name, qty, price, qty * price, null, 0, 0, 0]
      );
    }

    await conn.execute("UPDATE quotations SET status = 'approved', converted_receipt_id = ? WHERE id = ?", [receiptId, quotation_id]);
    await conn.execute('UPDATE jobs SET quotation_id = ?, status = ?, quote_draft = NULL WHERE id = ?', [quotation_id, 'approved', job.id]);
    await conn.execute('INSERT INTO job_status_history (job_id, status, changed_by) VALUES (?,?,?)', [job.id, 'approved', req.user.id]);

    await conn.commit();

    emitQuotationEvent('quotation:updated', { quotationId: quotation_id, status: 'approved', actorId: req.user.id });
    emitReceiptEvent('receipt:created', { receiptId, actorId: req.user.id });
    emitJobEvent('job:status-changed', { jobId: job.id, jobDate: job.job_date, status: 'approved', actorId: req.user.id });

    res.json({ success: true, quotation_id, receipt_id: receiptId });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'อนุมัติไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// ── นัดวันมาทำ: โปรโมท quote_draft เป็นใบเสนอราคาจริง สถานะ scheduled ──
router.post('/:id/quotation/schedule', async (req, res) => {
  const { scheduled_date } = req.body || {};
  if (!scheduled_date) return res.status(400).json({ error: 'กรุณาระบุวันที่' });

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[job]] = await conn.query('SELECT * FROM jobs WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!job) { await conn.rollback(); return res.status(404).json({ error: 'ไม่พบงานนี้' }); }
    if (!assertPromotable(job, res)) { await conn.rollback(); return; }

    let promoted;
    try {
      promoted = await promoteDraftToQuotation(conn, job, { status: 'scheduled', scheduledDate: scheduled_date });
    } catch (err) {
      await conn.rollback();
      return res.status(err.statusCode || 500).json({ error: err.message });
    }

    await conn.execute('UPDATE jobs SET quotation_id = ?, status = ?, quote_draft = NULL WHERE id = ?', [promoted.quotation_id, 'scheduled', job.id]);
    await conn.execute('INSERT INTO job_status_history (job_id, status, changed_by) VALUES (?,?,?)', [job.id, 'scheduled', req.user.id]);

    await conn.commit();

    emitQuotationEvent('quotation:updated', { quotationId: promoted.quotation_id, status: 'scheduled', actorId: req.user.id });
    emitJobEvent('job:status-changed', { jobId: job.id, jobDate: job.job_date, status: 'scheduled', actorId: req.user.id });

    res.json({ success: true, quotation_id: promoted.quotation_id });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'บันทึกวันนัดหมายไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// ── มัดจำ: โปรโมท quote_draft เป็นใบเสนอราคาจริง สถานะ no_date + บันทึกยอดมัดจำ ──
// ลูกค้าวางมัดจำแล้วขับรถกลับบ้านไปก่อน (รออะไหล่เข้า) ยังไม่รู้วันที่จะกลับมาทำจริง —
// จึงเป็น 'no_date' ไม่ใช่ 'scheduled' (ถ้ารู้วันแน่นอนแล้วให้กด "นัดวันมาทำ" แทน)
// ฝั่งงานตั้งเป็น 'carout' (เอารถลง) รถออกจากอู่ไปแล้ว หลุดจากคิววันนี้/จอบอร์ด —
// พอถึงวันนัดค่อยกด "สร้างคิว" จากหน้ามัดจำเพื่อรับรถกลับเข้าคิวใหม่
router.post('/:id/quotation/deposit', async (req, res) => {
  const { deposit_amount, deposit_date } = req.body || {};
  const amount = Number(deposit_amount);
  if (!(amount > 0)) return res.status(400).json({ error: 'กรุณากรอกยอดมัดจำให้ถูกต้อง' });

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[job]] = await conn.query('SELECT * FROM jobs WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!job) { await conn.rollback(); return res.status(404).json({ error: 'ไม่พบงานนี้' }); }
    if (!assertPromotable(job, res)) { await conn.rollback(); return; }

    let promoted;
    try {
      promoted = await promoteDraftToQuotation(conn, job, {
        status: 'no_date',
        depositAmount: amount,
        depositDate: deposit_date || todayStr(),
      });
    } catch (err) {
      await conn.rollback();
      return res.status(err.statusCode || 500).json({ error: err.message });
    }

    await conn.execute('UPDATE jobs SET quotation_id = ?, status = ?, bay = NULL, closed_at = NOW(), quote_draft = NULL WHERE id = ?', [promoted.quotation_id, 'carout', job.id]);
    await conn.execute('INSERT INTO job_status_history (job_id, status, changed_by) VALUES (?,?,?)', [job.id, 'carout', req.user.id]);

    await conn.commit();

    emitQuotationEvent('quotation:updated', { quotationId: promoted.quotation_id, status: 'no_date', actorId: req.user.id });
    emitJobEvent('job:status-changed', { jobId: job.id, jobDate: job.job_date, status: 'carout', actorId: req.user.id });

    res.json({ success: true, quotation_id: promoted.quotation_id });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'บันทึกมัดจำไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

// เหตุผลที่ลูกค้าไม่ได้ทำ — mirror DECLINE_REASON_VALUES ใน quotations.routes.js
// (ต้องแก้พร้อมกันทั้งคู่ถ้าจะเพิ่ม/ลดตัวเลือก — ดูคอมเมนต์ต้นทางที่นั่น)
const DECLINE_REASON_VALUES = ['price_high', 'budget', 'quote_only', 'other_day', 'other'];

// ── ไม่ทำ: โปรโมท quote_draft เป็นใบเสนอราคาจริง สถานะ declined ──
router.post('/:id/quotation/decline', async (req, res) => {
  const { reason, note } = req.body || {};
  if (!DECLINE_REASON_VALUES.includes(reason)) {
    return res.status(400).json({ error: 'กรุณาเลือกเหตุผลที่ลูกค้าไม่ได้ทำ' });
  }
  if (reason === 'other' && !note?.trim()) {
    return res.status(400).json({ error: 'กรุณาระบุรายละเอียดเหตุผล' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [[job]] = await conn.query('SELECT * FROM jobs WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!job) { await conn.rollback(); return res.status(404).json({ error: 'ไม่พบงานนี้' }); }
    if (!assertPromotable(job, res)) { await conn.rollback(); return; }

    let promoted;
    try {
      promoted = await promoteDraftToQuotation(conn, job, {
        status: 'declined',
        declineReason: reason,
        declineNote: reason === 'other' ? note.trim() : null,
      });
    } catch (err) {
      await conn.rollback();
      return res.status(err.statusCode || 500).json({ error: err.message });
    }

    await conn.execute('UPDATE jobs SET quotation_id = ?, status = ?, quote_draft = NULL WHERE id = ?', [promoted.quotation_id, 'rejected', job.id]);
    await conn.execute('INSERT INTO job_status_history (job_id, status, changed_by) VALUES (?,?,?)', [job.id, 'rejected', req.user.id]);

    await conn.commit();

    emitQuotationEvent('quotation:updated', { quotationId: promoted.quotation_id, status: 'declined', actorId: req.user.id });
    emitJobEvent('job:status-changed', { jobId: job.id, jobDate: job.job_date, status: 'rejected', actorId: req.user.id });

    res.json({ success: true, quotation_id: promoted.quotation_id });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'บันทึกไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
