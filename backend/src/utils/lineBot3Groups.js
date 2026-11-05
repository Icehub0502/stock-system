// Which LINE group closes bills for which branch. One bot 3 serves every branch: the group a message comes from decides
// the branch, so a group that was never bound can close nothing. Each branch holds one group (app_settings
// line_group_id_bot3). A manager binds it with a short-lived code created on the settings page and typed in the group,
// so nobody in a group can attach it to a branch of their choosing.
const crypto = require('crypto');
const pool = require('../db/pool');

const GROUP_KEY = 'line_group_id_bot3';
const BIND_CODE_KEY = 'line_bot3_bind_code';
const BIND_CODE_MINUTES = 10;

async function shopOfGroup(groupId) {
  if (!groupId) return null;
  const [[row]] = await pool.query(
    `SELECT a.shop_id FROM app_settings a
     JOIN shops s ON s.id = a.shop_id
     WHERE a.\`key\` = ? AND a.value = ? AND s.status = 'active'
     LIMIT 1`,
    [GROUP_KEY, groupId]
  );
  return row ? row.shop_id : null;
}

async function groupOfShop(shopId) {
  const [[row]] = await pool.query('SELECT value FROM app_settings WHERE shop_id = ? AND `key` = ?', [shopId, GROUP_KEY]);
  return (row && row.value) || null;
}

// A new code replaces the branch's earlier one. Stored as "<code>|<expiry in ms>".
async function createBindCode(shopId) {
  const expiresAt = Date.now() + BIND_CODE_MINUTES * 60 * 1000;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = String(crypto.randomInt(100000, 1000000));
    const [taken] = await pool.query(
      'SELECT shop_id FROM app_settings WHERE `key` = ? AND shop_id <> ? AND value LIKE ?',
      [BIND_CODE_KEY, shopId, `${code}|%`]
    );
    if (taken.length > 0) continue;
    await pool.query(
      'INSERT INTO app_settings (shop_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [shopId, BIND_CODE_KEY, `${code}|${expiresAt}`]
    );
    return { code, minutes: BIND_CODE_MINUTES };
  }
  throw new Error('could not create a free bind code');
}

// Binds the group to the branch holding this code. Returns { shopId, shopName }, or null for a wrong or expired code.
// A code works once. A group serves one branch only, so it leaves any branch it was bound to before.
async function bindGroup(groupId, code) {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT a.shop_id, a.value, s.name FROM app_settings a
       JOIN shops s ON s.id = a.shop_id
       WHERE a.\`key\` = ? AND a.value LIKE ? AND s.status = 'active'
       FOR UPDATE`,
      [BIND_CODE_KEY, `${code}|%`]
    );
    const match = rows.find((r) => Number(r.value.split('|')[1]) > Date.now());
    if (!match) {
      await conn.rollback();
      return null;
    }
    // tenant-ok: the group is found by its own id in whichever branch holds it, and it is moving to the branch of the code
    await conn.query('DELETE FROM app_settings WHERE `key` = ? AND value = ?', [GROUP_KEY, groupId]);
    await conn.query(
      'INSERT INTO app_settings (shop_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [match.shop_id, GROUP_KEY, groupId]
    );
    await conn.query('DELETE FROM app_settings WHERE shop_id = ? AND `key` = ?', [match.shop_id, BIND_CODE_KEY]);
    await conn.commit();
    return { shopId: match.shop_id, shopName: match.name };
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (rollbackErr) { console.error('Rollback error:', rollbackErr); }
    }
    throw err;
  } finally {
    if (conn) conn.release();
  }
}

// A code still waiting goes too: a code left on a screen must not bind a group after the manager has unbound
async function unbindGroup(shopId) {
  await pool.query('DELETE FROM app_settings WHERE shop_id = ? AND `key` IN (?, ?)', [shopId, GROUP_KEY, BIND_CODE_KEY]);
}

module.exports = { shopOfGroup, groupOfShop, createBindCode, bindGroup, unbindGroup };
