// Platform administration (role dev only): the trash of deleted records (shops, users and the audit log
// are in devShops.routes.js).
const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireDev } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { restoreFromTrash, purgeTrashPhotos, purgeTrashRecords, TrashError, ENTITIES } = require('../utils/trash');
const { getTrashSettings, saveTrashSettings } = require('../utils/trashCleanup');
const { deleteUploadedFile } = require('../utils/photoStorage');

const router = express.Router();
router.use(authenticate, requireDev);

function sendError(res, err, fallback) {
  if (err instanceof TrashError) return res.status(err.statusCode).json({ error: err.message });
  console.error(err);
  return res.status(500).json({ error: fallback });
}

// ── trash ───────────────────────────────────────────────────────────────────

// List: ?shop_id= &entity= &q= (label contains) &state=deleted|restored|all &limit= &offset=
router.get('/trash', async (req, res) => {
  try {
    const where = [];
    const params = [];
    if (req.query.shop_id) { where.push('d.shop_id = ?'); params.push(Number(req.query.shop_id)); }
    if (req.query.entity && ENTITIES[req.query.entity]) { where.push('d.entity = ?'); params.push(req.query.entity); }
    if (req.query.q) { where.push('d.label LIKE ?'); params.push(`%${String(req.query.q).slice(0, 100)}%`); }
    const state = req.query.state || 'deleted';
    if (state === 'deleted') where.push('d.restored_at IS NULL');
    if (state === 'restored') where.push('d.restored_at IS NOT NULL');
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const [rows] = await pool.query(
      `SELECT d.id, d.shop_id, s.code AS shop_code, s.name AS shop_name, d.entity, d.record_id, d.label,
              d.deleted_by, d.deleted_by_name, d.deleted_at, d.restored_at, d.size_bytes,
              (d.photo_files IS NOT NULL) AS has_photos, d.photos_purged_at
       FROM deleted_records d LEFT JOIN shops s ON s.id = d.shop_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY d.deleted_at DESC, d.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ success: true, data: rows.map((r) => ({ ...r, entity_name: ENTITIES[r.entity]?.type || r.entity })) });
  } catch (err) {
    sendError(res, err, 'โหลดรายการที่ถูกลบไม่สำเร็จ');
  }
});

// Size of the trash per kind (to see what takes the space)
router.get('/trash/stats', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT entity, COUNT(*) AS records, SUM(size_bytes) AS bytes
       FROM deleted_records GROUP BY entity ORDER BY bytes DESC`
    );
    const [[files]] = await pool.query(
      'SELECT COUNT(*) AS records FROM deleted_records WHERE photo_files IS NOT NULL AND photos_purged_at IS NULL'
    );
    res.json({
      success: true,
      data: {
        by_entity: rows.map((r) => ({
          entity: r.entity,
          entity_name: ENTITIES[r.entity]?.type || r.entity,
          records: Number(r.records),
          bytes: Number(r.bytes),
        })),
        records_with_photo_files: Number(files.records),
      },
    });
  } catch (err) {
    sendError(res, err, 'โหลดขนาดถังขยะไม่สำเร็จ');
  }
});

router.get('/trash/settings', async (req, res) => {
  try {
    res.json({ success: true, data: await getTrashSettings() });
  } catch (err) {
    sendError(res, err, 'โหลดการตั้งค่าไม่สำเร็จ');
  }
});

router.put('/trash/settings', async (req, res) => {
  const { auto_cleanup, keep_days, photo_keep_days } = req.body || {};
  const validDays = (v) => Number.isInteger(v) && v >= 0 && v <= 3650;
  if (typeof auto_cleanup !== 'boolean' || !validDays(keep_days) || !validDays(photo_keep_days)) {
    return res.status(400).json({ error: 'ค่าที่ตั้งไม่ถูกต้อง (จำนวนวัน 0-3650, 0 = เก็บไม่จำกัด)' });
  }
  try {
    await saveTrashSettings({ auto_cleanup, keep_days, photo_keep_days });
    await logAudit(req, 'trash_settings', { detail: { auto_cleanup, keep_days, photo_keep_days } });
    res.json({ success: true, data: await getTrashSettings() });
  } catch (err) {
    sendError(res, err, 'บันทึกการตั้งค่าไม่สำเร็จ');
  }
});

// Delete trash entries (or only their photo files) older than N days — manual, on request
router.post('/trash/purge', async (req, res) => {
  const days = (req.body || {}).older_than_days;
  const photosOnly = !!(req.body || {}).photos_only;
  if (!Number.isInteger(days) || days < 0 || days > 3650) {
    return res.status(400).json({ error: 'กรุณาระบุจำนวนวัน (0-3650)' });
  }
  try {
    if (photosOnly) {
      const photos = await purgeTrashPhotos(days);
      await logAudit(req, 'trash_purge', { detail: { older_than_days: days, photos_only: true, photos } });
      return res.json({ success: true, photos });
    }
    const records = await purgeTrashRecords(days);
    await logAudit(req, 'trash_purge', { detail: { older_than_days: days, records } });
    res.json({ success: true, records });
  } catch (err) {
    sendError(res, err, 'ลบไม่สำเร็จ');
  }
});

router.get('/trash/:id', async (req, res) => {
  try {
    const [[row]] = await pool.query(
      `SELECT d.*, s.code AS shop_code, s.name AS shop_name FROM deleted_records d
       LEFT JOIN shops s ON s.id = d.shop_id WHERE d.id = ?`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'ไม่พบรายการ' });
    const groups = JSON.parse(row.snapshot);
    const readable = (value) => typeof value !== 'object' && !(typeof value === 'string' && value.length > 200);
    res.json({
      success: true,
      data: {
        ...row,
        entity_name: ENTITIES[row.entity]?.type || row.entity,
        snapshot: undefined,
        side_effects: undefined,
        photo_files: undefined,
        // the record itself, then what the database deleted together with it (row counts per table)
        record: groups[0]?.rows[0]
          ? Object.fromEntries(Object.entries(groups[0].rows[0]).filter(([, v]) => readable(v)))
          : null,
        parts: groups.map((g) => ({ table: g.table, rows: g.rows.length })),
      },
    });
  } catch (err) {
    sendError(res, err, 'โหลดรายการไม่สำเร็จ');
  }
});

router.post('/trash/:id/restore', async (req, res) => {
  try {
    const restored = await restoreFromTrash(Number(req.params.id), req.user);
    await logAudit(req, 'trash_restore', { shopId: restored.shop_id, detail: { entity: restored.entity, record_id: restored.record_id } });
    res.json({ success: true, data: restored });
  } catch (err) {
    sendError(res, err, 'กู้คืนไม่สำเร็จ');
  }
});

// Remove one entry for good (its photo files too)
router.delete('/trash/:id', async (req, res) => {
  try {
    const [[row]] = await pool.query(
      'SELECT id, photo_files, photos_purged_at FROM deleted_records WHERE id = ?',
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'ไม่พบรายการ' });
    if (row.photo_files && !row.photos_purged_at) {
      for (const file of JSON.parse(row.photo_files)) deleteUploadedFile(file);
    }
    await pool.query('DELETE FROM deleted_records WHERE id = ?', [row.id]);
    await logAudit(req, 'trash_delete_forever', { detail: { trash_id: row.id } });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err, 'ลบไม่สำเร็จ');
  }
});

module.exports = router;
