// Trash: delete a record but keep a full copy that the platform administrator can restore.
//
//   trashDelete(db, { table, id, shopId, user, ... })  → { deleted: boolean }
//   restoreFromTrash(trashId, user)                    → { entity, record_id }
//
// The copy contains the record plus every row the database deletes together with it (found from the
// ON DELETE CASCADE foreign keys, so no per-table code is needed), and a list of what the delete
// changed on other rows (ON DELETE SET NULL links, plus anything the caller reports as extraEffects).
// Restoring puts the rows back with their original ids and re-applies those changes.
//
// The delete and the copy happen in one transaction: either both happen or neither.

const pool = require('../db/pool');
const { deleteUploadedFile } = require('./photoStorage');

class TrashError extends Error {
  constructor(message, statusCode = 409) {
    super(message);
    this.statusCode = statusCode;
  }
}

// What each trashed table is called on screen. Tables not listed here cannot be trashed.
const ENTITIES = {
  customers: { type: 'ลูกค้า', label: (r) => r.customer_name },
  vehicles: { type: 'รถ', label: (r) => [r.brand, r.model, r.license_plate].filter(Boolean).join(' ') },
  jobs: { type: 'งาน/คิว', label: (r) => [r.job_no, r.queue_no ? `คิว ${r.queue_no}` : ''].filter(Boolean).join(' ') },
  quotations: { type: 'ใบเสนอราคา', label: (r) => r.quotation_no },
  receipts: { type: 'ใบเสร็จ', label: (r) => r.receipt_no },
  claims: { type: 'เคลม', label: (r) => r.claim_no },
  repair_notices: { type: 'ใบแจ้งซ่อม', label: (r) => r.code },
  warranties: { type: 'การรับประกัน', label: (r) => r.warranty_name },
  technicians: { type: 'ช่าง', label: (r) => r.name },
};

// ── foreign-key graph (read once per process) ───────────────────────────────
let fkCache = null;

async function loadForeignKeys(conn) {
  if (fkCache) return fkCache;
  const [rows] = await conn.query(
    `SELECT rc.TABLE_NAME AS child, kcu.COLUMN_NAME AS child_col,
            rc.REFERENCED_TABLE_NAME AS parent, kcu.REFERENCED_COLUMN_NAME AS parent_col,
            rc.DELETE_RULE AS rule
     FROM information_schema.REFERENTIAL_CONSTRAINTS rc
     JOIN information_schema.KEY_COLUMN_USAGE kcu
       ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
      AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
      AND kcu.TABLE_NAME = rc.TABLE_NAME
     WHERE rc.CONSTRAINT_SCHEMA = DATABASE()`
  );
  fkCache = rows;
  return rows;
}

// columns that can be written (generated columns cannot)
async function insertableColumns(conn, table) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND EXTRA NOT LIKE '%GENERATED%'
     ORDER BY ORDINAL_POSITION`,
    [table]
  );
  return rows.map((r) => r.name);
}

// ── JSON-safe row values ────────────────────────────────────────────────────
function encodeValue(v) {
  if (Buffer.isBuffer(v)) return { $b64: v.toString('base64') };
  return v;
}
function decodeValue(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.$b64 === 'string') {
    return Buffer.from(v.$b64, 'base64');
  }
  return v;
}
const encodeRow = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, encodeValue(v)]));

// Collect `table` rows where `col` IN ids, then (recursively) everything cascade-deleted under them.
// groups: [{ table, rows }] parents before children; nulled: [{ table, col, ids }] SET NULL links.
async function collect(conn, table, col, ids, fks, groups, nulled) {
  if (ids.length === 0) return;
  const [rows] = await conn.query(`SELECT * FROM \`${table}\` WHERE \`${col}\` IN (?) FOR UPDATE`, [ids]);
  if (rows.length === 0) return;
  groups.push({ table, rows: rows.map(encodeRow) });

  for (const fk of fks.filter((f) => f.parent === table)) {
    const parentValues = rows.map((r) => r[fk.parent_col]).filter((v) => v !== null && v !== undefined);
    if (parentValues.length === 0) continue;
    if (fk.rule === 'CASCADE') {
      await collect(conn, fk.child, fk.child_col, parentValues, fks, groups, nulled);
    } else if (fk.rule === 'SET NULL') {
      const [linked] = await conn.query(
        `SELECT id FROM \`${fk.child}\` WHERE \`${fk.child_col}\` IN (?)`,
        [parentValues]
      );
      if (linked.length > 0) nulled.push({ table: fk.child, col: fk.child_col, value: parentValues[0], ids: linked.map((r) => r.id) });
    }
  }
}

// Delete one record into the trash.
// db: the pool (the function runs its own transaction) or a connection that is already inside one.
// opts: { table, id, shopId, user, extraEffects, photoFiles, beforeDelete }
//   extraEffects: [{ table, id, set: {col: oldValue}, expect: {col: valueAfterTheDelete} }]
//     — row changes the caller makes next to the delete; restored only if the row still looks like `expect`
//   photoFiles: uploaded file paths that must stay on disk while the copy exists
// Returns { deleted, trashId }; deleted=false when the record does not exist in that shop.
async function trashDelete(db, opts) {
  const entity = ENTITIES[opts.table];
  if (!entity) throw new Error(`trashDelete: ${opts.table} is not a trashable table`);

  const ownConnection = typeof db.getConnection === 'function';
  const conn = ownConnection ? await db.getConnection() : db;
  try {
    if (ownConnection) await conn.beginTransaction();

    // tenant-ok: the shop is part of the WHERE
    const [[row]] = await conn.query(
      `SELECT * FROM \`${opts.table}\` WHERE id = ? AND shop_id = ? FOR UPDATE`,
      [opts.id, opts.shopId]
    );
    if (!row) {
      if (ownConnection) await conn.rollback();
      return { deleted: false };
    }

    const fks = await loadForeignKeys(conn);
    const groups = [];
    const nulled = [];
    await collect(conn, opts.table, 'id', [opts.id], fks, groups, nulled);

    const effects = { nulled, extra: opts.extraEffects || [] };
    const snapshot = JSON.stringify(groups);
    const label = String(entity.label(row) || `#${row.id}`).slice(0, 255);
    const photoFiles = opts.photoFiles && opts.photoFiles.length ? JSON.stringify(opts.photoFiles) : null;
    const userName = opts.user ? (opts.user.full_name || opts.user.username || null) : null;

    const [trash] = await conn.query(
      `INSERT INTO deleted_records
         (shop_id, entity, record_id, label, snapshot, side_effects, photo_files, size_bytes, deleted_by, deleted_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [opts.shopId, opts.table, opts.id, label, snapshot, JSON.stringify(effects), photoFiles,
        Buffer.byteLength(snapshot), opts.user ? opts.user.id : null, userName]
    );

    if (typeof opts.beforeDelete === 'function') await opts.beforeDelete(conn, row);
    // tenant-ok: the shop is part of the WHERE
    await conn.query(`DELETE FROM \`${opts.table}\` WHERE id = ? AND shop_id = ?`, [opts.id, opts.shopId]);

    if (ownConnection) await conn.commit();
    return { deleted: true, trashId: trash.insertId };
  } catch (err) {
    if (ownConnection) {
      try { await conn.rollback(); } catch (rollbackErr) { console.error('trash rollback:', rollbackErr); }
    }
    throw err;
  } finally {
    if (ownConnection) conn.release();
  }
}

function friendlyRestoreError(err) {
  if (err.code === 'ER_DUP_ENTRY') {
    return new TrashError('กู้คืนไม่ได้: มีรายการที่ใช้เลข/รหัสเดียวกันอยู่แล้ว (อาจถูกสร้างใหม่ไปแล้ว)');
  }
  if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_NO_REFERENCED_ROW') {
    return new TrashError('กู้คืนไม่ได้: ข้อมูลที่เกี่ยวข้อง (เช่น ลูกค้าหรือรถ) ถูกลบไปแล้ว ให้กู้รายการนั้นก่อน');
  }
  return err;
}

// Put a trashed record back (with the same ids) and re-apply what its delete changed on other rows.
async function restoreFromTrash(trashId, user) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[trash]] = await conn.query('SELECT * FROM deleted_records WHERE id = ? FOR UPDATE', [trashId]);
    if (!trash) throw new TrashError('ไม่พบรายการ', 404);
    if (trash.restored_at) throw new TrashError('รายการนี้ถูกกู้คืนไปแล้ว');

    const groups = JSON.parse(trash.snapshot);
    for (const group of groups) {
      const writable = new Set(await insertableColumns(conn, group.table));
      for (const row of group.rows) {
        const cols = Object.keys(row).filter((c) => writable.has(c));
        try {
          await conn.query(
            `INSERT INTO \`${group.table}\` (${cols.map((c) => `\`${c}\``).join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
            cols.map((c) => decodeValue(row[c]))
          );
        } catch (err) {
          throw friendlyRestoreError(err);
        }
      }
    }

    const effects = trash.side_effects ? JSON.parse(trash.side_effects) : { nulled: [], extra: [] };
    for (const link of effects.nulled || []) {
      // only links that are still empty (someone may have linked the row to something else meanwhile)
      await conn.query(
        `UPDATE \`${link.table}\` SET \`${link.col}\` = ? WHERE id IN (?) AND \`${link.col}\` IS NULL`,
        [link.value, link.ids]
      );
    }
    for (const fix of effects.extra || []) {
      const setCols = Object.keys(fix.set);
      const expectCols = Object.keys(fix.expect || {});
      await conn.query(
        `UPDATE \`${fix.table}\` SET ${setCols.map((c) => `\`${c}\` = ?`).join(', ')}
         WHERE id = ?${expectCols.map((c) => (fix.expect[c] === null ? ` AND \`${c}\` IS NULL` : ` AND \`${c}\` = ?`)).join('')}`,
        [...setCols.map((c) => fix.set[c]), fix.id, ...expectCols.filter((c) => fix.expect[c] !== null).map((c) => fix.expect[c])]
      );
    }

    await conn.query('UPDATE deleted_records SET restored_at = NOW(), restored_by = ? WHERE id = ?', [user ? user.id : null, trashId]);
    await conn.commit();
    return { entity: trash.entity, record_id: trash.record_id, shop_id: trash.shop_id };
  } catch (err) {
    try { await conn.rollback(); } catch (rollbackErr) { console.error('restore rollback:', rollbackErr); }
    throw err;
  } finally {
    conn.release();
  }
}

// Remove the uploaded photo files of trashed records (the records themselves stay restorable).
// Only entries older than `days` (0 = all). Returns how many records had files removed.
async function purgeTrashPhotos(days) {
  const [rows] = await pool.query(
    `SELECT id, photo_files FROM deleted_records
     WHERE photo_files IS NOT NULL AND photos_purged_at IS NULL
       AND (? = 0 OR deleted_at < DATE_SUB(NOW(), INTERVAL ? DAY))`,
    [days, days]
  );
  for (const r of rows) {
    for (const file of JSON.parse(r.photo_files)) deleteUploadedFile(file);
    await pool.query('UPDATE deleted_records SET photos_purged_at = NOW() WHERE id = ?', [r.id]);
  }
  return rows.length;
}

// Permanently remove trash entries (and their photo files) older than `days`. Returns the count.
async function purgeTrashRecords(days) {
  await purgeTrashPhotos(days);
  const [result] = await pool.query(
    'DELETE FROM deleted_records WHERE deleted_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
    [days]
  );
  return result.affectedRows;
}

module.exports = { trashDelete, restoreFromTrash, purgeTrashPhotos, purgeTrashRecords, TrashError, ENTITIES };
