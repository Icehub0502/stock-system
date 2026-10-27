const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { authenticate, requireOwner } = require('../middleware/auth');

const router = express.Router();
// จัดการบัญชี/รหัสผ่าน/role ของทุกคนในร้านได้จากที่นี่ — เจ้าของร้านขึ้นไปเท่านั้น
// บัญชี role 'dev' (ผู้ดูแลระบบ) ไม่โผล่ในรายการและเจ้าของร้านแก้/ลบ/ตั้งเป็น dev ไม่ได้
router.use(authenticate, requireOwner);

const SHOP_ROLES = ['technician', 'office', 'manager', 'owner'];
const isDev = (req) => req.user.role === 'dev';
const assignableRoles = (req) => (isDev(req) ? [...SHOP_ROLES, 'dev'] : SHOP_ROLES);

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, username, full_name, role, created_at FROM users WHERE shop_id = ?${isDev(req) ? '' : " AND role <> 'dev'"} ORDER BY id`,
      [req.shopId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดข้อมูลไม่สำเร็จ' });
  }
});

router.post('/', async (req, res) => {
  const { username, password, full_name = '', role } = req.body || {};
  if (!username || !password || !assignableRoles(req).includes(role)) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง (username, password, role จำเป็นต้องกรอก)' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
  }
  try {
    const [result] = await pool.execute(
      'INSERT INTO users (shop_id, username, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)',
      [req.shopId, String(username).trim(), bcrypt.hashSync(password, 10), String(full_name).trim(), role]
    );
    const [rows] = await pool.execute(
      'SELECT id, username, full_name, role FROM users WHERE id = ? AND shop_id = ?',
      [result.insertId, req.shopId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'username นี้มีอยู่แล้ว' });
    }
    console.error(err);
    res.status(500).json({ error: 'สร้างผู้ใช้ไม่สำเร็จ' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const [existingRows] = await pool.execute('SELECT * FROM users WHERE id = ? AND shop_id = ?', [req.params.id, req.shopId]);
    const existing = existingRows[0];
    if (!existing || (existing.role === 'dev' && !isDev(req))) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });

    const { full_name = existing.full_name, role = existing.role, password } = req.body || {};
    if (!assignableRoles(req).includes(role)) {
      return res.status(400).json({ error: 'role ไม่ถูกต้อง' });
    }
    if (password && String(password).length < 8) {
      return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
    }
    const password_hash = password ? bcrypt.hashSync(password, 10) : existing.password_hash;

    await pool.execute(
      'UPDATE users SET full_name = ?, role = ?, password_hash = ? WHERE id = ? AND shop_id = ?',
      [full_name, role, password_hash, req.params.id, req.shopId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'แก้ไขไม่สำเร็จ' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const [existingRows] = await pool.execute('SELECT * FROM users WHERE id = ? AND shop_id = ?', [req.params.id, req.shopId]);
    if (!existingRows[0] || (existingRows[0].role === 'dev' && !isDev(req))) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    // กันลบบัญชีตัวเองทิ้งเผลอ — จะล็อกตัวเองออกจากหน้าตั้งค่าทันทีโดยไม่มีทาง
    // กู้คืนผ่านเว็บอีก (ต้องเข้า DB ตรง ๆ)
    if (Number(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'ลบบัญชีของตัวเองไม่ได้' });
    }
    await pool.execute('DELETE FROM users WHERE id = ? AND shop_id = ?', [req.params.id, req.shopId]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ลบไม่สำเร็จ' });
  }
});

module.exports = router;
