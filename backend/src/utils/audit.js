// Audit log of administrator actions (shops created/suspended, passwords reset, branch switches,
// trash restored ...). Never throws: a failing log must not break the action it describes.
const pool = require('../db/pool');

async function logAudit(req, action, { shopId = null, detail = null } = {}) {
  try {
    await pool.query(
      'INSERT INTO dev_audit_log (user_id, username, action, shop_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?)',
      [
        req.user ? req.user.id : null,
        req.user ? req.user.username : null,
        action,
        shopId,
        detail === null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)),
        req.ip ? String(req.ip).slice(0, 64) : null,
      ]
    );
  } catch (err) {
    console.error('audit log failed:', err);
  }
}

module.exports = { logAudit };
