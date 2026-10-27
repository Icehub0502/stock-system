const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const { authenticate, DEFAULT_SHOP_ID } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
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
  const { username, password, shop_code } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'กรุณากรอก username และ password' });
  }
  try {
    // ไม่ส่งรหัสร้านมา = ร้านที่ 1 (หน้าล็อกอินเดิมที่ยังไม่มีช่องรหัสร้าน)
    let shopId = DEFAULT_SHOP_ID;
    if (shop_code && String(shop_code).trim()) {
      const [shops] = await pool.execute(
        "SELECT id FROM shops WHERE code = ? AND status = 'active'",
        [String(shop_code).trim().toLowerCase()]
      );
      shopId = shops[0]?.id ?? 0;
    }
    const [rows] = await pool.execute(
      "SELECT * FROM users WHERE username = ? AND shop_id = ? AND is_active = 1 AND shop_id IN (SELECT id FROM shops WHERE status = 'active')",
      [username.trim(), shopId]
    );
    const user = rows[0];
    const passwordMatches = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !passwordMatches) {
      return res.status(401).json({ error: 'username หรือ password ไม่ถูกต้อง' });
    }
    const payload = {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      shop_id: user.shop_id,
      // the shop the account belongs to; shop_id changes when an owner/dev switches branch
      home_shop_id: user.shop_id
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

// Branches the logged-in user may switch to: dev = every shop, owner = the shops of their own group
// (the group is that of the shop the account belongs to), everyone else = none
async function allowedBranches(user) {
  if (user.role === 'dev') {
    const [rows] = await pool.query(
      'SELECT s.id, s.code, s.name, s.status, s.group_id, g.name AS group_name FROM shops s JOIN shop_groups g ON g.id = s.group_id ORDER BY g.id, s.id'
    );
    return rows;
  }
  if (user.role === 'owner') {
    const [rows] = await pool.query(
      `SELECT s.id, s.code, s.name, s.status, s.group_id, g.name AS group_name FROM shops s JOIN shop_groups g ON g.id = s.group_id
       WHERE s.status = 'active' AND s.group_id = (SELECT group_id FROM shops WHERE id = ?) ORDER BY s.id`,
      [user.home_shop_id]
    );
    return rows;
  }
  return [];
}

router.get('/branches', authenticate, async (req, res) => {
  try {
    // the home shop comes from the database, not from the token
    const [[me]] = await pool.query('SELECT id, shop_id, role, is_active FROM users WHERE id = ?', [req.user.id]);
    if (!me || !me.is_active) return res.status(401).json({ error: 'ไม่พบบัญชีผู้ใช้' });
    const branches = await allowedBranches({ role: me.role, home_shop_id: me.shop_id });
    res.json({ success: true, data: { current_shop_id: req.shopId, home_shop_id: me.shop_id, branches } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'โหลดรายการสาขาไม่สำเร็จ' });
  }
});

// Switch the shop the session works in. A new token is issued for the chosen shop; the role stays the
// user's own (so an owner is an owner in every branch of their group).
router.post('/switch-shop', authenticate, async (req, res) => {
  const target = Number((req.body || {}).shop_id);
  if (!Number.isInteger(target) || target <= 0) return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  try {
    // tenant-ok: looks up the caller's own account by id; the account's home shop decides what it may switch to
    const [[me]] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!me || !me.is_active) return res.status(401).json({ error: 'ไม่พบบัญชีผู้ใช้' });
    const branches = await allowedBranches({ role: me.role, home_shop_id: me.shop_id });
    if (!branches.some((b) => b.id === target)) {
      // same answer for 'does not exist' and 'not yours': nothing to learn about other groups
      return res.status(404).json({ error: 'ไม่พบสาขานี้' });
    }
    const payload = {
      id: me.id, username: me.username, full_name: me.full_name, role: me.role,
      shop_id: target, home_shop_id: me.shop_id
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    await logAudit(req, 'switch_shop', { shopId: target, detail: { from: req.shopId } });
    res.json({ token, user: payload });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'สลับสาขาไม่สำเร็จ' });
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
    const homeShopId = Number(req.user.home_shop_id) || req.shopId;
    const [rows] = await pool.execute('SELECT * FROM users WHERE id = ? AND shop_id = ?', [req.user.id, homeShopId]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
      return res.status(401).json({ error: 'รหัสผ่านเดิมไม่ถูกต้อง' });
    }
    await pool.execute(
      'UPDATE users SET password_hash = ? WHERE id = ? AND shop_id = ?',
      [bcrypt.hashSync(new_password, 10), req.user.id, homeShopId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'เปลี่ยนรหัสผ่านไม่สำเร็จ' });
  }
});

module.exports = router;
