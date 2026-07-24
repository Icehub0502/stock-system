const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config');

const router = express.Router();

// ใช้เทียบแทนตอน username ไม่มีอยู่จริง กันการ short-circuit (return ทันทีโดยไม่เรียก
// bcrypt.compareSync เลย) ที่ทำให้ตอบกลับเร็วกว่ากรณี username มีอยู่จริงแต่ password
// ผิด (bcrypt ใช้เวลา ~50-100ms) — ต่างเวลาตอบขนาดนี้พอให้เดารายชื่อ user ที่มีอยู่จริง
// ในระบบได้ (username enumeration) แม้ความเสี่ยงจะต่ำเพราะเป็นระบบใช้ภายในร้าน + มี
// rate limit กันไว้แล้วก็ตาม แก้ให้ตอบเวลาใกล้เคียงกันทั้งสองกรณีไปเลย
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

// จำกัดการพยายาม login เพื่อกัน brute-force เดารหัสผ่าน
// 10 ครั้ง/IP ต่อ 15 นาที (นับเฉพาะครั้งที่ล็อกอินไม่สำเร็จ)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' }
});

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'กรุณากรอก username และ password' });
  }
  try {
    const [rows] = await pool.execute('SELECT * FROM users WHERE username = ?', [username.trim()]);
    const user = rows[0];
    const passwordMatches = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !passwordMatches) {
      return res.status(401).json({ error: 'username หรือ password ไม่ถูกต้อง' });
    }
    const payload = {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role
    };
    const token = jwt.sign(payload, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN
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
  if (String(new_password).length < 8) {
    return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร' });
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
