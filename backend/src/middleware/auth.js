const jwt = require('jsonwebtoken');
require('dotenv').config();
const { JWT_SECRET } = require('../config');

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'ไม่พบ token กรุณาเข้าสู่ระบบ' });
  }
  try {
    const payload = verifyToken(token);
    req.user = payload; // { id, username, role, full_name }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token ไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ทำรายการนี้' });
    }
    next();
  };
}

// เจ้าของร้าน (username 'ice') เท่านั้น — ใช้กับหน้า "ตั้งค่า" และ endpoint ที่จัดการ
// บัญชีผู้ใช้/ความลับของระบบ ซึ่งอ่อนไหวกว่าสิทธิ์ office ทั่วไป ไม่ผูกกับ role เพราะ
// ระบบยังไม่มี role แยกสำหรับเจ้าของร้านโดยเฉพาะ (มีแค่ office/technician)
function requireOwner(req, res, next) {
  if (!req.user || req.user.username !== 'ice') {
    return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ทำรายการนี้' });
  }
  next();
}

module.exports = { authenticate, requireRole, requireOwner, verifyToken };
