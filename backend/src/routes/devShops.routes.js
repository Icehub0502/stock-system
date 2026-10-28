// Platform administration (role dev only): shops and branch groups, users of every shop, overview, audit log.
// Mounted under /api/dev next to the trash routes (dev.routes.js).
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { authenticate, requireDev, forgetShopStatus } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();
router.use(authenticate, requireDev);

function serverError(res, err, message) {
  console.error(err);
  return res.status(500).json({ error: message });
}

const SHOP_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{1,29}$/;
const DEFAULT_DECLINE_REASONS = ['ราคาสูงไป', 'งบไม่พอ', 'ขอใบเสนอราคา', 'นำรถมาทำวันอื่น'];

// ── shops, groups ───────────────────────────────────────────────────────────

// All shops with their group and a few numbers so quiet or empty shops stand out
router.get('/shops', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.code, s.name, s.status, s.created_at, s.group_id, g.name AS group_name,
              (SELECT COUNT(*) FROM users u WHERE u.shop_id = s.id) AS user_count,
              (SELECT COUNT(*) FROM jobs j WHERE j.shop_id = s.id AND j.job_date = CURDATE()) AS jobs_today,
              (SELECT COUNT(*) FROM receipts r WHERE r.shop_id = s.id AND r.receipt_date = CURDATE()) AS receipts_today,
              GREATEST(
                COALESCE((SELECT MAX(j.created_at) FROM jobs j WHERE j.shop_id = s.id), '1970-01-01'),
                COALESCE((SELECT MAX(r.created_at) FROM receipts r WHERE r.shop_id = s.id), '1970-01-01')
              ) AS last_activity
       FROM shops s JOIN shop_groups g ON g.id = s.group_id
       ORDER BY g.id, s.id`
    );
    res.json({
      success: true,
      data: rows.map((r) => ({ ...r, last_activity: String(r.last_activity).startsWith('1970') ? null : r.last_activity })),
    });
  } catch (err) {
    serverError(res, err, 'โหลดรายชื่อร้านไม่สำเร็จ');
  }
});

router.get('/groups', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT g.id, g.name, COUNT(s.id) AS shop_count FROM shop_groups g LEFT JOIN shops s ON s.group_id = g.id GROUP BY g.id, g.name ORDER BY g.id'
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    serverError(res, err, 'โหลดกลุ่มสาขาไม่สำเร็จ');
  }
});

// Create a shop and its first owner account in one step.
// body: { code, name, group_id | new_group_name, owner: { username, password, full_name } }
router.post('/shops', async (req, res) => {
  const { code, name, group_id, new_group_name, owner } = req.body || {};
  const shopCode = String(code || '').trim().toLowerCase();
  const shopName = String(name || '').trim();
  if (!SHOP_CODE_PATTERN.test(shopCode)) {
    return res.status(400).json({ error: 'รหัสร้านใช้ได้เฉพาะ a-z 0-9 และ - ยาว 2-30 ตัว' });
  }
  if (!shopName) return res.status(400).json({ error: 'กรุณากรอกชื่อร้าน' });
  if (!owner || !String(owner.username || '').trim()) {
    return res.status(400).json({ error: 'กรุณากรอก username ของเจ้าของร้าน' });
  }
  if (String(owner.password || '').length < 8) {
    return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
  }
  if (!group_id && !String(new_group_name || '').trim()) {
    return res.status(400).json({ error: 'กรุณาเลือกกลุ่มสาขา หรือตั้งชื่อกลุ่มใหม่' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let groupId = Number(group_id) || null;
    if (groupId) {
      const [[g]] = await conn.query('SELECT id FROM shop_groups WHERE id = ?', [groupId]);
      if (!g) {
        await conn.rollback();
        return res.status(404).json({ error: 'ไม่พบกลุ่มสาขา' });
      }
    } else {
      const [g] = await conn.query('INSERT INTO shop_groups (name) VALUES (?)', [String(new_group_name).trim()]);
      groupId = g.insertId;
    }

    const [shop] = await conn.query('INSERT INTO shops (code, name, group_id) VALUES (?, ?, ?)', [shopCode, shopName, groupId]);
    const shopId = shop.insertId;
    const [user] = await conn.query(
      'INSERT INTO users (shop_id, username, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)',
      [shopId, String(owner.username).trim(), bcrypt.hashSync(owner.password, 10), String(owner.full_name || '').trim(), 'owner']
    );
    for (let i = 0; i < DEFAULT_DECLINE_REASONS.length; i += 1) {
      await conn.query(
        'INSERT INTO decline_reasons (shop_id, label, sort_order) VALUES (?, ?, ?)',
        [shopId, DEFAULT_DECLINE_REASONS[i], i + 1]
      );
    }

    await conn.commit();
    await logAudit(req, 'create_shop', {
      shopId,
      detail: { code: shopCode, name: shopName, group_id: groupId, owner: String(owner.username).trim() },
    });
    res.status(201).json({ success: true, data: { id: shopId, code: shopCode, group_id: groupId, owner_user_id: user.insertId } });
  } catch (err) {
    try { await conn.rollback(); } catch (rollbackErr) { console.error(rollbackErr); }
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'รหัสร้านนี้มีอยู่แล้ว' });
    serverError(res, err, 'สร้างร้านไม่สำเร็จ');
  } finally {
    conn.release();
  }
});

// Rename, change the login code, move to another group, suspend / re-open
router.patch('/shops/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { name, code, status, group_id } = req.body || {};
  try {
    const [[shop]] = await pool.query('SELECT id FROM shops WHERE id = ?', [id]);
    if (!shop) return res.status(404).json({ error: 'ไม่พบร้าน' });

    const sets = [];
    const params = [];
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อร้าน' });
      sets.push('name = ?');
      params.push(String(name).trim());
    }
    if (code !== undefined) {
      const shopCode = String(code).trim().toLowerCase();
      if (!SHOP_CODE_PATTERN.test(shopCode)) {
        return res.status(400).json({ error: 'รหัสร้านใช้ได้เฉพาะ a-z 0-9 และ - ยาว 2-30 ตัว' });
      }
      sets.push('code = ?');
      params.push(shopCode);
    }
    if (status !== undefined) {
      if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'สถานะไม่ถูกต้อง' });
      // the shop the administrator account itself belongs to cannot be suspended (they would lock themselves out)
      if (status === 'suspended' && id === Number(req.user.home_shop_id || req.shopId)) {
        return res.status(400).json({ error: 'ระงับร้านที่บัญชีของคุณสังกัดอยู่ไม่ได้' });
      }
      sets.push('status = ?');
      params.push(status);
    }
    if (group_id !== undefined) {
      const [[g]] = await pool.query('SELECT id FROM shop_groups WHERE id = ?', [Number(group_id)]);
      if (!g) return res.status(404).json({ error: 'ไม่พบกลุ่มสาขา' });
      sets.push('group_id = ?');
      params.push(g.id);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'ไม่มีข้อมูลที่จะแก้' });

    await pool.query(`UPDATE shops SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    forgetShopStatus(id);
    await logAudit(req, 'update_shop', { shopId: id, detail: { name, code, status, group_id } });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'รหัสร้านนี้มีอยู่แล้ว' });
    serverError(res, err, 'แก้ไขร้านไม่สำเร็จ');
  }
});

// ── users of every shop ─────────────────────────────────────────────────────

router.get('/users', async (req, res) => {
  try {
    const where = [];
    const params = [];
    if (req.query.shop_id) {
      where.push('u.shop_id = ?');
      params.push(Number(req.query.shop_id));
    }
    if (req.query.q) {
      const like = `%${String(req.query.q).slice(0, 60)}%`;
      where.push('(u.username LIKE ? OR u.full_name LIKE ?)');
      params.push(like, like);
    }
    const [rows] = await pool.query(
      `SELECT u.id, u.username, u.full_name, u.role, u.is_active, u.created_at, u.shop_id, s.code AS shop_code, s.name AS shop_name
       FROM users u JOIN shops s ON s.id = u.shop_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY s.id, u.id LIMIT 500`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    serverError(res, err, 'โหลดผู้ใช้ไม่สำเร็จ');
  }
});

// Add an account to any shop. body: { shop_id, username, password, full_name?, role }
router.post('/users', async (req, res) => {
  const { shop_id, password, role } = req.body || {};
  const username = String(req.body?.username || '').trim();
  const fullName = String(req.body?.full_name || '').trim();
  if (!username || username.length > 50) return res.status(400).json({ error: 'กรุณากรอก username (ไม่เกิน 50 ตัวอักษร)' });
  if (fullName.length > 100) return res.status(400).json({ error: 'ชื่อยาวเกินไป' });
  if (String(password || '').length < 8) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
  if (!USER_ROLES.includes(role)) return res.status(400).json({ error: 'สิทธิ์ไม่ถูกต้อง' });
  try {
    const [[shop]] = await pool.query('SELECT id FROM shops WHERE id = ?', [Number(shop_id) || 0]);
    if (!shop) return res.status(404).json({ error: 'ไม่พบร้าน' });
    const [result] = await pool.query(
      'INSERT INTO users (shop_id, username, password_hash, full_name, role) VALUES (?, ?, ?, ?, ?)',
      [shop.id, username, bcrypt.hashSync(String(password), 10), fullName, role]
    );
    await logAudit(req, 'create_user', { shopId: shop.id, detail: { user_id: result.insertId, username, role } });
    res.status(201).json({ success: true, data: { id: result.insertId } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'username นี้มีอยู่แล้วในร้านนี้' });
    serverError(res, err, 'เพิ่มผู้ใช้ไม่สำเร็จ');
  }
});

router.post('/users/:id/reset-password', async (req, res) => {
  const password = (req.body || {}).new_password;
  if (String(password || '').length < 8) {
    return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
  }
  try {
    const [[user]] = await pool.query('SELECT id, shop_id, username FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    // tenant-ok: platform administrator (dev) works across all shops
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(password, 10), user.id]);
    await logAudit(req, 'reset_password', { shopId: user.shop_id, detail: { user_id: user.id, username: user.username } });
    res.json({ success: true });
  } catch (err) {
    serverError(res, err, 'รีเซ็ตรหัสผ่านไม่สำเร็จ');
  }
});

const USER_ROLES = ['technician', 'office', 'manager', 'owner', 'dev'];

// Switch an account off / on, or change its role. A switched-off account cannot log in; a token already
// issued (with its old role) stays valid until it expires.
router.patch('/users/:id', async (req, res) => {
  const { is_active, role } = req.body || {};
  if (is_active !== undefined && typeof is_active !== 'boolean') return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
  if (role !== undefined && !USER_ROLES.includes(role)) return res.status(400).json({ error: 'สิทธิ์ไม่ถูกต้อง' });
  if (is_active === undefined && role === undefined) return res.status(400).json({ error: 'ไม่มีข้อมูลที่จะแก้' });
  try {
    const [[user]] = await pool.query('SELECT id, shop_id, username, role FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    if (user.id === req.user.id) return res.status(400).json({ error: 'แก้บัญชีของตัวเองไม่ได้' });
    if (is_active !== undefined) {
      // tenant-ok: platform administrator (dev) works across all shops
      await pool.query('UPDATE users SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, user.id]);
      await logAudit(req, is_active ? 'enable_user' : 'disable_user', {
        shopId: user.shop_id,
        detail: { user_id: user.id, username: user.username },
      });
    }
    if (role !== undefined && role !== user.role) {
      // tenant-ok: platform administrator (dev) works across all shops
      await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, user.id]);
      await logAudit(req, 'change_role', {
        shopId: user.shop_id,
        detail: { user_id: user.id, username: user.username, from: user.role, to: role },
      });
    }
    res.json({ success: true });
  } catch (err) {
    serverError(res, err, 'แก้ไขผู้ใช้ไม่สำเร็จ');
  }
});

// ── overview + audit log ────────────────────────────────────────────────────

router.get('/overview', async (req, res) => {
  try {
    const [[totals]] = await pool.query(
      `SELECT COUNT(*) AS shops,
              SUM(status = 'active') AS active_shops,
              SUM(status = 'suspended') AS suspended_shops,
              COUNT(DISTINCT group_id) AS groups_count
       FROM shops`
    );
    const [[users]] = await pool.query('SELECT COUNT(*) AS users, SUM(is_active = 0) AS disabled FROM users');
    const [[trash]] = await pool.query(
      'SELECT COUNT(*) AS records, COALESCE(SUM(size_bytes), 0) AS bytes FROM deleted_records WHERE restored_at IS NULL'
    );
    res.json({
      success: true,
      data: {
        shops: Number(totals.shops),
        active_shops: Number(totals.active_shops || 0),
        suspended_shops: Number(totals.suspended_shops || 0),
        groups: Number(totals.groups_count),
        users: Number(users.users),
        disabled_users: Number(users.disabled || 0),
        trash_records: Number(trash.records),
        trash_bytes: Number(trash.bytes),
      },
    });
  } catch (err) {
    serverError(res, err, 'โหลดภาพรวมไม่สำเร็จ');
  }
});

router.get('/audit', async (req, res) => {
  try {
    const where = [];
    const params = [];
    if (req.query.shop_id) {
      where.push('a.shop_id = ?');
      params.push(Number(req.query.shop_id));
    }
    if (req.query.action) {
      where.push('a.action = ?');
      params.push(String(req.query.action));
    }
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const [rows] = await pool.query(
      `SELECT a.id, a.user_id, a.username, a.action, a.shop_id, s.code AS shop_code, a.detail, a.ip, a.created_at
       FROM dev_audit_log a LEFT JOIN shops s ON s.id = a.shop_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY a.id DESC LIMIT ?`,
      [...params, limit]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    serverError(res, err, 'โหลดบันทึกการทำงานไม่สำเร็จ');
  }
});

module.exports = router;
