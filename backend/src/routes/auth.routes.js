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

module.exports = router;
