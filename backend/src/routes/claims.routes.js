const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);
router.use(requireRole('office'));

// เลขที่เคลม CLM-YYMMDD-NNN ผูกกับวันที่ (ไม่ใช่เลขวิ่งรวมทั้งระบบเหมือน
// repair_notices) เพราะ "วันนี้เคลมใบที่เท่าไหร่" เป็นข้อมูลที่มีความหมายกับหน้างาน
// มากกว่าเลขวิ่งเปล่า ๆ — FOR UPDATE ล็อกกันคำขอพร้อมกันได้เลขซ้ำ (เหมือน
// generateCode ใน repairNotices.routes.js)
async function generateClaimNo(conn = pool) {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '').slice(2); // YYMMDD
  const prefix = `CLM-${dateStr}-`;
  const [rows] = await conn.execute(
    "SELECT MAX(CAST(SUBSTRING(claim_no, ?) AS UNSIGNED)) AS maxNo FROM claims WHERE claim_no LIKE ? FOR UPDATE",
    [prefix.length + 1, `${prefix}%`]
  );
  const nextNumber = (rows[0]?.maxNo || 0) + 1;
  return `${prefix}${String(nextNumber).padStart(3, '0')}`;
}

router.get('/next-code', async (req, res) => {
  try {
    const claim_no = await generateClaimNo();
    res.json({ success: true, claim_no });
  } catch (err) {
    console.error('Error generating claim no:', err);
    res.status(500).json({ error: 'ไม่สามารถสร้างเลขที่เคลมได้' });
  }
});

router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    const params = [];
    let whereClause = '';
    if (search && search.trim()) {
      const words = search.trim().split(/\s+/).filter(Boolean);
      const perWordClause = 'v.license_plate LIKE ? OR c.customer_name LIKE ? OR c.phone LIKE ?';
      whereClause = `WHERE ${words.map(() => `(${perWordClause})`).join(' AND ')}`;
      words.forEach((w) => params.push(`%${w}%`, `%${w}%`, `%${w}%`));
    }
    const [rows] = await pool.execute(
      `SELECT cl.id, cl.claim_no, cl.claim_date, cl.symptom, cl.created_at,
              c.customer_name, c.phone,
              v.brand, v.model, v.license_plate,
              (SELECT COUNT(*) FROM claim_items ci WHERE ci.claim_id = cl.id) AS item_count
       FROM claims cl
       JOIN customers c ON cl.customer_id = c.id
       JOIN vehicles v ON cl.vehicle_id = v.id
       ${whereClause}
       ORDER BY cl.created_at DESC
       LIMIT 300`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error loading claims:', err);
    res.status(500).json({ error: 'โหลดรายการเคลมไม่สำเร็จ' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const [[claim]] = await pool.execute(
      `SELECT cl.*, c.customer_name, c.phone,
              v.brand, v.model, v.color, v.license_plate, v.mileage
       FROM claims cl
       JOIN customers c ON cl.customer_id = c.id
       JOIN vehicles v ON cl.vehicle_id = v.id
       WHERE cl.id = ?`,
      [req.params.id]
    );
    if (!claim) return res.status(404).json({ error: 'ไม่พบเคลม' });
    const [items] = await pool.execute(
      'SELECT id, product_name, quantity, unit_price FROM claim_items WHERE claim_id = ? ORDER BY id ASC',
      [req.params.id]
    );
    res.json({ success: true, data: { ...claim, items } });
  } catch (err) {
    console.error('Error loading claim:', err);
    res.status(500).json({ error: 'โหลดเคลมไม่สำเร็จ' });
  }
});

router.post('/', async (req, res) => {
  const { customer_id, vehicle_id, claim_date, symptom, remark, items = [] } = req.body || {};
  if (!customer_id || !vehicle_id) {
    return res.status(400).json({ error: 'กรุณาเลือกลูกค้าและรถก่อน' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const claim_no = await generateClaimNo(conn);
    const [result] = await conn.execute(
      `INSERT INTO claims (claim_no, customer_id, vehicle_id, claim_date, symptom, remark, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        claim_no,
        customer_id,
        vehicle_id,
        claim_date || new Date().toISOString().slice(0, 10),
        symptom || null,
        remark || null,
        req.user.id,
      ]
    );
    const claimId = result.insertId;
    for (const it of items) {
      if (!it.product_name) continue;
      await conn.execute(
        'INSERT INTO claim_items (claim_id, product_name, quantity, unit_price) VALUES (?, ?, ?, ?)',
        [claimId, it.product_name, Number(it.quantity) || 1, Number(it.unit_price) || 0]
      );
    }
    await conn.commit();
    res.status(201).json({ success: true, id: claimId, claim_no });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackErr) { console.error('Rollback error:', rollbackErr); }
    }
    console.error('Error creating claim:', err);
    res.status(500).json({ error: 'สร้างเคลมไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

router.put('/:id', async (req, res) => {
  const { customer_id, vehicle_id, claim_date, symptom, remark, items = [] } = req.body || {};
  if (!customer_id || !vehicle_id) {
    return res.status(400).json({ error: 'กรุณาเลือกลูกค้าและรถก่อน' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `UPDATE claims SET customer_id = ?, vehicle_id = ?, claim_date = ?, symptom = ?, remark = ? WHERE id = ?`,
      [customer_id, vehicle_id, claim_date || new Date().toISOString().slice(0, 10), symptom || null, remark || null, req.params.id]
    );
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบเคลม' });
    }
    // แทนที่รายการอะไหล่ทั้งหมด — ง่ายกว่า diff ทีละแถว เหมือนที่ใบเสนอราคาแก้ไข
    // รายการก็ใช้วิธีนี้ (ดู quotations.routes.js PUT /:id)
    await conn.execute('DELETE FROM claim_items WHERE claim_id = ?', [req.params.id]);
    for (const it of items) {
      if (!it.product_name) continue;
      await conn.execute(
        'INSERT INTO claim_items (claim_id, product_name, quantity, unit_price) VALUES (?, ?, ?, ?)',
        [req.params.id, it.product_name, Number(it.quantity) || 1, Number(it.unit_price) || 0]
      );
    }
    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackErr) { console.error('Rollback error:', rollbackErr); }
    }
    console.error('Error updating claim:', err);
    res.status(500).json({ error: 'แก้ไขเคลมไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM claims WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'ไม่พบเคลม' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting claim:', err);
    res.status(500).json({ error: 'ลบเคลมไม่สำเร็จ' });
  }
});

module.exports = router;
