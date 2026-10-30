// Activity log for the platform administrator (role dev), mounted at /api/dev/activity:
//   GET /            list, newest first: ?shop_id= &user= (name contains) &user_id= &kind= &entity= &entity_id=
//                    &failed=1 &q= (summary / path contains) &from= &to= (YYYY-MM-DD) &limit= &before_id=
//   GET /summary     who did how much in a period (?from= &to=, default today)
//   GET /:id         one entry in full: what was sent, how the record looked before
const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireDev } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireDev);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = ['create', 'update', 'delete', 'action', 'login'];

function parseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (err) { return text; }
}

router.get('/', async (req, res) => {
  try {
    const where = [];
    const params = [];
    const q = req.query;
    if (q.shop_id) { where.push('a.shop_id = ?'); params.push(Number(q.shop_id)); }
    if (q.user_id) { where.push('a.user_id = ?'); params.push(Number(q.user_id)); }
    if (q.user) {
      const like = `%${String(q.user).slice(0, 60)}%`;
      where.push('(a.username LIKE ? OR a.full_name LIKE ?)');
      params.push(like, like);
    }
    if (q.kind && KINDS.includes(q.kind)) { where.push('a.kind = ?'); params.push(q.kind); }
    if (q.entity) { where.push('a.entity = ?'); params.push(String(q.entity).slice(0, 64)); }
    if (q.entity_id) { where.push('a.entity_id = ?'); params.push(String(q.entity_id).slice(0, 64)); }
    if (q.failed === '1') where.push('a.status >= 400');
    if (q.q) {
      const like = `%${String(q.q).slice(0, 100)}%`;
      where.push('(a.summary LIKE ? OR a.path LIKE ?)');
      params.push(like, like);
    }
    if (DATE_RE.test(q.from || '')) { where.push('a.created_at >= ?'); params.push(`${q.from} 00:00:00`); }
    if (DATE_RE.test(q.to || '')) { where.push('a.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(q.to); }
    if (q.before_id) { where.push('a.id < ?'); params.push(Number(q.before_id)); }
    const limit = Math.min(Number(q.limit) || 100, 200);

    const [rows] = await pool.query(
      `SELECT a.id, DATE_FORMAT(a.created_at, '%Y-%m-%d %H:%i:%s') AS created_at, a.shop_id, s.name AS shop_name,
              a.user_id, a.username, a.full_name, a.role, a.method, a.route, a.status, a.duration_ms, a.kind,
              a.entity, a.entity_id, a.summary, a.ip, (a.before_data IS NOT NULL) AS has_before, (a.request_body IS NOT NULL) AS has_body
       FROM activity_log a LEFT JOIN shops s ON s.id = a.shop_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY a.id DESC LIMIT ?`,
      [...params, limit + 1]
    );
    res.json({
      success: true,
      data: rows.slice(0, limit).map((r) => ({ ...r, has_before: Boolean(r.has_before), has_body: Boolean(r.has_body) })),
      has_more: rows.length > limit,
    });
  } catch (err) {
    console.error('Error loading activity log:', err);
    res.status(500).json({ error: 'โหลดบันทึกกิจกรรมไม่สำเร็จ' });
  }
});

router.get('/summary', async (req, res) => {
  try {
    const [[{ today }]] = await pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today");
    const from = DATE_RE.test(req.query.from || '') ? req.query.from : today;
    const to = DATE_RE.test(req.query.to || '') ? req.query.to : today;
    const [users] = await pool.query(
      `SELECT a.user_id, a.username, a.full_name, a.role, a.shop_id, s.name AS shop_name,
              COUNT(*) AS total, SUM(a.kind = 'create') AS creates, SUM(a.kind = 'update') AS updates,
              SUM(a.kind = 'delete') AS deletes, SUM(a.kind = 'action') AS actions, SUM(a.status >= 400) AS failures,
              DATE_FORMAT(MAX(a.created_at), '%Y-%m-%d %H:%i') AS last_at
       FROM activity_log a LEFT JOIN shops s ON s.id = a.shop_id
       WHERE a.created_at >= ? AND a.created_at < DATE_ADD(?, INTERVAL 1 DAY) AND a.kind <> 'login'
       GROUP BY a.user_id, a.username, a.full_name, a.role, a.shop_id, s.name ORDER BY total DESC LIMIT 100`,
      [`${from} 00:00:00`, to]
    );
    const [[logins]] = await pool.query(
      `SELECT SUM(status = 200) AS ok, SUM(status <> 200) AS failed FROM activity_log
       WHERE kind = 'login' AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`,
      [`${from} 00:00:00`, to]
    );
    res.json({
      success: true,
      data: {
        from,
        to,
        logins: { ok: Number(logins.ok) || 0, failed: Number(logins.failed) || 0 },
        users: users.map((u) => ({
          ...u,
          total: Number(u.total),
          creates: Number(u.creates),
          updates: Number(u.updates),
          deletes: Number(u.deletes),
          actions: Number(u.actions),
          failures: Number(u.failures),
        })),
      },
    });
  } catch (err) {
    console.error('Error loading activity summary:', err);
    res.status(500).json({ error: 'โหลดสรุปกิจกรรมไม่สำเร็จ' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'รหัสไม่ถูกต้อง' });
    const [[row]] = await pool.query(
      `SELECT a.id, DATE_FORMAT(a.created_at, '%Y-%m-%d %H:%i:%s') AS created_at, a.shop_id, s.name AS shop_name, a.user_id,
              a.username, a.full_name, a.role, a.method, a.route, a.path, a.status, a.duration_ms, a.kind, a.entity, a.entity_id,
              a.summary, a.request_body, a.before_data, a.error_text, a.ip, a.user_agent
       FROM activity_log a LEFT JOIN shops s ON s.id = a.shop_id WHERE a.id = ?`,
      [id]
    );
    if (!row) return res.status(404).json({ error: 'ไม่พบรายการ' });
    res.json({ success: true, data: { ...row, request_body: parseJson(row.request_body), before_data: parseJson(row.before_data) } });
  } catch (err) {
    console.error('Error loading activity entry:', err);
    res.status(500).json({ error: 'โหลดรายการไม่สำเร็จ' });
  }
});

module.exports = router;
