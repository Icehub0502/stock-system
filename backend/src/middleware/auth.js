const jwt = require('jsonwebtoken');
require('dotenv').config();
const { JWT_SECRET } = require('../config');
const pool = require('../db/pool');

const DEFAULT_SHOP_ID = 1;

// Roles, lowest → highest. A higher role can do everything the lower ones can:
//   technician < office < manager < owner < dev
// office   = daily work (quotations, receipts, queue, stock, customers)
// manager  = + sales/profit/cost figures, cancelling/deleting documents, technicians, part prices, shop settings
// owner    = + user accounts of the shop (and all branches of the owner's group)
// dev      = platform administrator (shops, groups, catalogue); can act inside any shop
const ROLE_RANK = { technician: 1, office: 2, manager: 3, owner: 4, dev: 5 };

function roleRank(role) {
  return ROLE_RANK[role] || 0;
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// shop status is checked on every request (a suspended shop must stop working at once, not when the
// 12-hour token expires), but read from the database at most every few seconds per shop
const SHOP_STATUS_TTL_MS = 5000;
const shopStatusCache = new Map();

async function shopIsActive(shopId) {
  const cached = shopStatusCache.get(shopId);
  if (cached && Date.now() - cached.at < SHOP_STATUS_TTL_MS) return cached.active;
  const [rows] = await pool.query('SELECT status FROM shops WHERE id = ?', [shopId]);
  const active = rows.length > 0 && rows[0].status === 'active';
  shopStatusCache.set(shopId, { active, at: Date.now() });
  return active;
}

function forgetShopStatus(shopId) {
  if (shopId === undefined) shopStatusCache.clear();
  else shopStatusCache.delete(Number(shopId));
}

async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'ไม่พบ token กรุณาเข้าสู่ระบบ' });
  }
  try {
    const payload = verifyToken(token);
    req.user = payload; // { id, username, role, full_name, shop_id }
    // ทุก query ของ route ต้องกรองด้วย req.shopId (ร้านของผู้ที่ล็อกอิน) — token ที่ออกก่อนเริ่มระบบ
    // หลายร้านไม่มี shop_id แต่ตอนนั้นมีร้านเดียว (ร้านที่ 1) จึงถือเป็นร้านที่ 1
    req.shopId = Number(payload.shop_id) || DEFAULT_SHOP_ID;
  } catch (err) {
    return res.status(401).json({ error: 'Token ไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
  }

  try {
    // the platform administrator may still enter a suspended shop (to look at it / fix it)
    if (req.user.role !== 'dev' && !(await shopIsActive(req.shopId))) {
      return res.status(403).json({ error: 'ร้านนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ' });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'ตรวจสอบสถานะร้านไม่สำเร็จ' });
  }
  next();
}

function deny(res) {
  return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ทำรายการนี้' });
}

// requireRole('office') means "office or any higher role": the lowest role listed is the minimum.
// A role list that skips levels (e.g. 'technician' only) still lets higher roles through, because a
// higher role never loses what a lower one can do.
function requireRole(...roles) {
  const minRank = Math.min(...roles.map(roleRank));
  return (req, res, next) => {
    if (!req.user || roleRank(req.user.role) < minRank) return deny(res);
    next();
  };
}

const requireManager = requireRole('manager');
const requireOwner = requireRole('owner');
const requireDev = requireRole('dev');

module.exports = {
  authenticate, requireRole, requireManager, requireOwner, requireDev,
  roleRank, ROLE_RANK, verifyToken, DEFAULT_SHOP_ID, forgetShopStatus,
};
