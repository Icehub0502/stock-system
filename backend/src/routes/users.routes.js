const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('office'));

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, username, full_name, role, created_at FROM users ORDER BY id'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดข้อมูลไม่สำเร็จ' });
  }
});

router.post('/', async (req, res) => {
  const { username, password, full_name = '', role } = req.body || {};
  if (!username || !password || !['office', 'technician'].includes(role)) {
    return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง (username, password, role จำเป็นต้องกรอก)' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
  }
  try {
    const [result] = await pool.execute(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
      [String(username).trim(), bcrypt.hashSync(password, 10), String(full_name).trim(), role]
    );
    const [rows] = await pool.execute(
      'SELECT id, username, full_name, role FROM users WHERE id = ?',
      [result.insertId]
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
    const [existingRows] = await pool.execute('SELECT * FROM users WHERE id = ?', [req.params.id]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });

    const { full_name = existing.full_name, role = existing.role, password } = req.body || {};
    if (password && String(password).length < 8) {
      return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
    }
    const password_hash = password ? bcrypt.hashSync(password, 10) : existing.password_hash;

    await pool.execute(
      'UPDATE users SET full_name = ?, role = ?, password_hash = ? WHERE id = ?',
      [full_name, role, password_hash, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'แก้ไขไม่สำเร็จ' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const [existingRows] = await pool.execute('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!existingRows[0]) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    await pool.execute('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'ลบไม่สำเร็จ' });
  }
});

module.exports = router;
