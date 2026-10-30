// Records every change made through the API (POST / PUT / PATCH / DELETE by a signed-in user, plus login attempts) in
// activity_log for the platform administrator. Reads (GET) are not recorded.
//
//   - the body is stored with secrets hidden (passwords, tokens, signatures) and files / long text cut short
//   - for edits and deletes of the main records the row as it was BEFORE the change is stored too
//   - the entry is written after the response has gone out, and a failing log never breaks the request
//   - routes that fire all the time (draft autosave, photo upload, LINE chat) keep a summary line only
//   - old entries are removed after ACTIVITY_KEEP_DAYS (default 365)
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

const METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const KEEP_DAYS = Number(process.env.ACTIVITY_KEEP_DAYS) || 365;
const BODY_MAX = 4000;
const BEFORE_MAX = 8000;

// api path segment → table whose row is kept as "before" on edit / delete (static list: safe to put in SQL)
const SNAPSHOT_TABLES = {
  customers: 'customers', vehicles: 'vehicles', quotations: 'quotations', receipts: 'receipts', jobs: 'jobs',
  claims: 'claims', warranties: 'warranties', 'service-items': 'service_items', 'stock-items': 'stock_items',
  technicians: 'technicians', users: 'users',
};
const SNAPSHOT_COLUMNS = { users: 'id, username, full_name, role, shop_id, is_active' }; // never the password hash

const ENTITY_LABEL = {
  customers: 'ลูกค้า', vehicles: 'รถ', quotations: 'ใบเสนอราคา', receipts: 'ใบเสร็จ', jobs: 'งาน/คิว', claims: 'เคลม',
  warranties: 'การรับประกัน', 'service-items': 'รายการสินค้า/บริการ', 'stock-items': 'สต็อก', 'stock-receive': 'รับเข้าสต็อก',
  'stock-deductions': 'ตัดสต็อก', users: 'บัญชีผู้ใช้', technicians: 'ช่าง', 'doc-settings': 'หัวกระดาษ',
  'model-prices': 'ราคามาตรฐาน', settings: 'ตั้งค่า', 'vehicle-models': 'รุ่นรถ', 'product-costs': 'ต้นทุนสินค้า',
  auth: 'บัญชี', dev: 'ผู้ดูแลระบบ', 'quotation-customers': 'ลูกค้าใบเสนอราคา', transactions: 'รายการสต็อก', line: 'LINE',
};
const SUB_ACTION_LABEL = {
  approve: 'อนุมัติ', schedule: 'นัดวัน', deposit: 'รับมัดจำ', decline: 'ลูกค้าไม่ทำ', 'quote-draft': 'ร่างใบเสนอราคา',
  status: 'เปลี่ยนสถานะ', photos: 'รูป', 'part-photos': 'รูปอะไหล่', restore: 'กู้คืน', 'reset-password': 'รีเซ็ตรหัสผ่าน',
  'found-via': 'ช่องทางลูกค้า', 'change-password': 'เปลี่ยนรหัสผ่าน', move: 'ย้ายวัน', 'attach-vehicle': 'ผูกรุ่นรถ',
  signature: 'ลายเซ็น', quotation: 'ใบเสนอราคา', print: 'พิมพ์', purge: 'ล้าง',
};

// routes that are written all the time: no body / snapshot, and at most one entry a minute per user and path
const NOISY = [/\/quote-draft/, /\/signature/, /\/photos/, /\/part-photos/, /^\/api\/line/];
const lastNoisy = new Map();

const SENSITIVE_KEY = /pass|token|secret|authorization|signature|cookie|credential|card/i;

function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.startsWith('data:')) return `[ไฟล์ ${value.length} ตัวอักษร]`;
    return value.length > 500 ? `${value.slice(0, 500)}…(${value.length} ตัวอักษร)` : value;
  }
  if (typeof value !== 'object') return value;
  if (depth > 6) return '[ซ้อนลึกเกินไป]';
  if (Array.isArray(value)) {
    const items = value.slice(0, 50).map((v) => sanitize(v, depth + 1));
    if (value.length > 50) items.push(`…อีก ${value.length - 50} รายการ`);
    return items;
  }
  if (value instanceof Date) return value.toISOString();
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) ? '[ซ่อน]' : sanitize(v, depth + 1);
  return out;
}

function toJson(value, max) {
  if (value === null || value === undefined) return null;
  const text = JSON.stringify(sanitize(value));
  if (text.length <= max) return text;
  return JSON.stringify({ _truncated: true, size: text.length, preview: text.slice(0, max - 100) });
}

// the name that identifies a record, for the summary line
function labelOf(row) {
  if (!row) return null;
  for (const key of ['customer_name', 'quotation_no', 'receipt_no', 'job_no', 'claim_no', 'warranty_name', 'name', 'product_name', 'license_plate', 'username', 'oem_code']) {
    if (row[key]) return String(row[key]);
  }
  return null;
}

function readToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  try { return jwt.verify(header.slice(7), process.env.JWT_SECRET); } catch (err) { return null; }
}

async function loadBefore(req) {
  if (req.method === 'POST' || !readToken(req)) return null;
  const m = /^\/api\/([a-z-]+)\/(\d+)(?:\/|$)/.exec(req.originalUrl.split('?')[0]);
  const table = m && SNAPSHOT_TABLES[m[1]];
  if (!table) return null;
  const [[row]] = await pool.query(`SELECT ${SNAPSHOT_COLUMNS[m[1]] || '*'} FROM \`${table}\` WHERE id = ?`, [m[2]]);
  return row || null;
}

function describe(req, status, before) {
  const url = req.originalUrl.split('?')[0];
  const parts = url.split('/').filter(Boolean); // ['api', 'quotations', '12', 'approve']
  const entity = parts[1] || 'api';
  const sub = parts.slice(2).filter((p) => !/^\d+$/.test(p) && !p.startsWith(':'))[0];
  const entityId = req.params && req.params.id ? String(req.params.id) : (parts[2] && /^\d+$/.test(parts[2]) ? parts[2] : null);
  const isLogin = entity === 'auth' && sub === 'login';
  let kind = 'action';
  if (isLogin) kind = 'login';
  else if (req.method === 'DELETE') kind = 'delete';
  else if (!sub && req.method === 'POST') kind = 'create';
  else if (!sub && (req.method === 'PUT' || req.method === 'PATCH')) kind = 'update';

  const verb = { create: 'เพิ่ม', update: 'แก้ไข', delete: 'ลบ', login: 'เข้าสู่ระบบ', action: 'ทำรายการ' }[kind];
  const label = ENTITY_LABEL[entity] || entity;
  const target = labelOf(before) || labelOf(req.body);
  let summary = isLogin
    ? (status === 200 ? 'เข้าสู่ระบบสำเร็จ' : 'เข้าสู่ระบบไม่สำเร็จ')
    : `${verb}${kind === 'action' && sub ? ` ${SUB_ACTION_LABEL[sub] || sub} ของ` : ''}${label}`;
  if (target) summary += ` “${target}”`;
  else if (entityId) summary += ` #${entityId}`;
  if (status >= 400 && !isLogin) summary += ` (ไม่สำเร็จ ${status})`;
  return { kind, entity, entityId, summary: summary.slice(0, 480) };
}

let lastPurge = 0;
async function purgeOld() {
  if (Date.now() - lastPurge < 24 * 3600 * 1000) return;
  lastPurge = Date.now();
  await pool.query('DELETE FROM activity_log WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY) LIMIT 5000', [KEEP_DAYS]);
}

async function write(req, res, startedAt, before) {
  const url = req.originalUrl.split('?')[0];
  const routePattern = `${req.baseUrl || ''}${(req.route && req.route.path) || ''}` || url;
  const noisy = NOISY.some((re) => re.test(url));
  const user = req.user || null;
  const isLogin = /^\/api\/auth\/login/.test(url);
  // nobody signed in and not a login attempt: not recorded (keeps bots from filling the table)
  if (!user && !isLogin && !/^\/api\/line/.test(url)) return;

  if (noisy) {
    const key = `${user ? user.id : 'x'}|${req.method}|${url}`;
    const now = Date.now();
    if (now - (lastNoisy.get(key) || 0) < 60000) return;
    lastNoisy.set(key, now);
    if (lastNoisy.size > 5000) lastNoisy.clear();
  }

  const info = describe(req, res.statusCode, before);
  const body = noisy || isLogin ? (isLogin ? { username: req.body && req.body.username, shop_code: req.body && req.body.shop_code } : null) : req.body;
  const bodyJson = body && Object.keys(body).length ? toJson(body, BODY_MAX) : null;
  const username = user ? user.username : (isLogin && req.body ? String(req.body.username || '').slice(0, 100) : (/^\/api\/line/.test(url) ? 'LINE bot' : null));
  await pool.query(
    `INSERT INTO activity_log (shop_id, user_id, username, full_name, role, method, route, path, status, duration_ms, kind,
                              entity, entity_id, summary, request_body, before_data, error_text, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user ? (req.shopId || Number(user.shop_id) || null) : null,
      user ? user.id : null, username, user ? (user.full_name || null) : null, user ? user.role : null,
      req.method, routePattern.slice(0, 200), url.slice(0, 500), res.statusCode, Date.now() - startedAt, info.kind,
      info.entity, info.entityId || (info.kind === 'create' && res.locals && res.locals.createdId) || null, info.summary,
      bodyJson, noisy ? null : toJson(before, BEFORE_MAX),
      res.statusCode >= 400 && res.locals && res.locals.errorText ? String(res.locals.errorText).slice(0, 480) : null,
      req.ip ? String(req.ip).slice(0, 64) : null,
      req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 255) : null,
    ]
  );
}

async function activityLogger(req, res, next) {
  if (!METHODS.has(req.method)) return next();
  const startedAt = Date.now();
  let before = null;
  try {
    if (!NOISY.some((re) => re.test(req.originalUrl))) before = await loadBefore(req);
  } catch (err) {
    console.error('activity snapshot failed:', err.message);
  }
  // the error text of a failed request, for the log
  const sendJson = res.json.bind(res);
  res.json = (payload) => {
    if (res.statusCode >= 400 && payload && payload.error) res.locals.errorText = payload.error;
    // the id of what a create just made (so the history of that record starts at its creation)
    if (res.statusCode < 300 && payload) {
      const made = (payload.data && payload.data.id) || payload.id || payload.insertId;
      if (made && /^\d+$/.test(String(made))) res.locals.createdId = String(made);
    }
    return sendJson(payload);
  };
  res.on('finish', () => {
    write(req, res, startedAt, before)
      .then(purgeOld)
      .catch((err) => console.error('activity log failed:', err.message));
  });
  return next();
}

module.exports = { activityLogger, sanitize, toJson };
