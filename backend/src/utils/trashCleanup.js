// Trash retention settings (platform-wide) and the nightly clean-up.
// Automatic clean-up is OFF until the administrator turns it on; the numbers are only used when it is on.
const pool = require('../db/pool');
const { purgeTrashPhotos, purgeTrashRecords } = require('./trash');

const DEFAULTS = { trash_auto_cleanup: '0', trash_keep_days: '365', trash_photo_keep_days: '90' };

async function getTrashSettings() {
  const [rows] = await pool.query(
    "SELECT `key`, value FROM platform_settings WHERE `key` IN ('trash_auto_cleanup','trash_keep_days','trash_photo_keep_days')"
  );
  const raw = { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  return {
    auto_cleanup: raw.trash_auto_cleanup === '1',
    keep_days: Number(raw.trash_keep_days),
    photo_keep_days: Number(raw.trash_photo_keep_days),
  };
}

async function saveTrashSettings({ auto_cleanup, keep_days, photo_keep_days }) {
  const entries = [
    ['trash_auto_cleanup', auto_cleanup ? '1' : '0'],
    ['trash_keep_days', String(keep_days)],
    ['trash_photo_keep_days', String(photo_keep_days)],
  ];
  for (const [key, value] of entries) {
    await pool.query(
      'INSERT INTO platform_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      [key, value]
    );
  }
}

// One clean-up pass (what the hourly timer runs). 0 days = keep forever for that kind.
async function runTrashCleanup() {
  const s = await getTrashSettings();
  if (!s.auto_cleanup) return { skipped: true };
  const photos = s.photo_keep_days > 0 ? await purgeTrashPhotos(s.photo_keep_days) : 0;
  const records = s.keep_days > 0 ? await purgeTrashRecords(s.keep_days) : 0;
  if (photos || records) console.log(`[trash] clean-up: photos of ${photos} record(s), ${records} record(s) removed`);
  return { photos, records };
}

// Checked once an hour; a pass is cheap, and a no-op while the setting is off.
function startTrashCleanupTimer() {
  const timer = setInterval(() => {
    runTrashCleanup().catch((err) => console.error('[trash] clean-up failed:', err));
  }, 60 * 60 * 1000);
  timer.unref();
  return timer;
}

module.exports = { getTrashSettings, saveTrashSettings, runTrashCleanup, startTrashCleanupTimer, DEFAULTS };
