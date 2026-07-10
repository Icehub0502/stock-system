const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

router.get('/', requireRole('office'), async (req, res) => {
  try {
    const { search } = req.query;
    let query = `SELECT si.*, w.warranty_name, w.warranty_year, w.warranty_month, w.warranty_km
                 FROM service_items si
                 LEFT JOIN warranties w ON si.warranty_id = w.id
                 WHERE si.is_active = 1`;
    const params = [];
    if (search) {
      query += ' AND (si.product_name LIKE ? OR si.category LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term);
    }
    query += ' ORDER BY si.category ASC, si.product_name ASC LIMIT 200';
    const [rows] = await pool.execute(query, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error loading service items:', err);
    res.status(500).json({ error: 'โหลดรายการสินค้า/บริการไม่สำเร็จ' });
  }
});

router.get('/:id/components', requireRole('office'), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM service_item_components WHERE service_item_id = ? ORDER BY sort_order ASC, id ASC',
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Error loading set components:', err);
    res.status(500).json({ error: 'โหลดรายการย่อยของชุดไม่สำเร็จ' });
  }
});

async function saveComponents(conn, serviceItemId, components) {
  await conn.execute('DELETE FROM service_item_components WHERE service_item_id = ?', [serviceItemId]);
  let sortOrder = 0;
  for (const comp of components) {
    const name = comp.component_name?.toString().trim();
    if (!name) continue;
    await conn.execute(
      'INSERT INTO service_item_components (service_item_id, component_name, default_qty, sort_order) VALUES (?, ?, ?, ?)',
      [serviceItemId, name, Number(comp.default_qty) > 0 ? Number(comp.default_qty) : 1, sortOrder]
    );
    sortOrder += 1;
  }
}

router.post('/', requireRole('office'), async (req, res) => {
  const { category, product_name, warranty_id, is_set, components } = req.body;
  if (!category || !product_name) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลรายการสินค้า/บริการให้ครบถ้วน' });
  }
  if (is_set && (!Array.isArray(components) || components.filter((c) => c.component_name?.toString().trim()).length === 0)) {
    return res.status(400).json({ error: 'กรุณาเพิ่มรายการย่อยอย่างน้อยหนึ่งรายการสำหรับชุดสินค้า' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // A set carries a warranty for the whole group just like a regular
    // item — price is intentionally NOT stored here; staff fill it in per
    // line when the set is expanded on the receipt.
    const [result] = await conn.execute(
      'INSERT INTO service_items (category, product_name, warranty_id, is_set) VALUES (?, ?, ?, ?)',
      [category, product_name, warranty_id || null, is_set ? 1 : 0]
    );

    if (is_set) {
      await saveComponents(conn, result.insertId, components);
    }

    await conn.commit();
    res.status(201).json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackErr) { console.error('Rollback error:', rollbackErr); }
    }
    console.error('Error creating service item:', err);
    res.status(500).json({ error: 'สร้างรายการสินค้า/บริการไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

router.put('/:id', requireRole('office'), async (req, res) => {
  const { category, product_name, warranty_id, is_active, is_set, components } = req.body;
  if (!category || !product_name) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลรายการสินค้า/บริการให้ครบถ้วน' });
  }
  if (is_set && (!Array.isArray(components) || components.filter((c) => c.component_name?.toString().trim()).length === 0)) {
    return res.status(400).json({ error: 'กรุณาเพิ่มรายการย่อยอย่างน้อยหนึ่งรายการสำหรับชุดสินค้า' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [result] = await conn.execute(
      'UPDATE service_items SET category = ?, product_name = ?, warranty_id = ?, is_active = ?, is_set = ? WHERE id = ?',
      [
        category,
        product_name,
        warranty_id || null,
        is_active ? 1 : 0,
        is_set ? 1 : 0,
        req.params.id
      ]
    );

    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'ไม่พบรายการ' });
    }

    if (is_set) {
      await saveComponents(conn, req.params.id, components);
    } else {
      await conn.execute('DELETE FROM service_item_components WHERE service_item_id = ?', [req.params.id]);
    }

    await conn.commit();
    res.json({ success: true, message: 'อัปเดตรายการสำเร็จ' });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackErr) { console.error('Rollback error:', rollbackErr); }
    }
    console.error('Error updating service item:', err);
    res.status(500).json({ error: 'อัปเดตรายการไม่สำเร็จ' });
  } finally {
    if (conn) conn.release();
  }
});

router.delete('/:id', requireRole('office'), async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM service_items WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'ไม่พบรายการ' });
    }
    res.json({ success: true, message: 'ลบรายการสำเร็จ' });
  } catch (err) {
    console.error('Error deleting service item:', err);
    res.status(500).json({ error: 'ลบรายการไม่สำเร็จ' });
  }
});

module.exports = router;
