const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'กรุณากรอก username และ password' });
  }
  try {
    const [rows] = await pool.execute('SELECT * FROM users WHERE username = ?', [username.trim()]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'username หรือ password ไม่ถูกต้อง' });
    }
    const payload = {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET || 'dev_secret_change_me', {
      expiresIn: process.env.JWT_EXPIRES_IN || '12h'
    });
    res.json({ token, user: payload });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ กรุณาตรวจสอบว่าเชื่อมต่อ MySQL ได้หรือไม่' });
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// Self-service password change — any logged-in user, for their own account
// only (unlike PUT /api/users/:id, which is office-only and can reset
// anyone's password but requires no proof of the old one).
router.put('/change-password', authenticate, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'กรุณากรอกรหัสผ่านเดิมและรหัสผ่านใหม่' });
  }
  if (new_password.length < 4) {
    return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร' });
  }
  try {
    const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
      return res.status(401).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });
    }
    await pool.execute(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [bcrypt.hashSync(new_password, 10), req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เปลี่ยนรหัสผ่านไม่สำเร็จ' });
  }
});

module.exports = router;
