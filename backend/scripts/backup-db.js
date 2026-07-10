// Dumps the production MySQL database to backend/backups/, timestamped,
// and prunes dumps older than RETENTION_DAYS. Meant to run daily via
// Windows Task Scheduler (see backend/scripts/register-backup-task.ps1).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const MYSQLDUMP_PATH = process.env.MYSQLDUMP_PATH || 'C:\\xampp\\mysql\\bin\\mysqldump.exe';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || '3306';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'stock_system';
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 14);

const BACKUP_DIR = path.join(__dirname, '..', 'backups');

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function pruneOldBackups() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.sql'));
  for (const file of files) {
    const filePath = path.join(BACKUP_DIR, file);
    if (fs.statSync(filePath).mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
      console.log(`[backup] removed old backup: ${file}`);
    }
  }
}

function main() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const outFile = path.join(BACKUP_DIR, `${DB_NAME}-${timestamp()}.sql`);
  const args = [
    `--host=${DB_HOST}`,
    `--port=${DB_PORT}`,
    `--user=${DB_USER}`,
    ...(DB_PASSWORD ? [`--password=${DB_PASSWORD}`] : []),
    '--single-transaction',
    '--routines',
    DB_NAME,
  ];

  const out = fs.createWriteStream(outFile);
  const child = execFile(MYSQLDUMP_PATH, args, { maxBuffer: 1024 * 1024 * 1024 });
  child.stdout.pipe(out);
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  child.on('close', (code) => {
    out.close();
    if (code !== 0) {
      console.error(`[backup] mysqldump exited with code ${code}: ${stderr}`);
      try { fs.unlinkSync(outFile); } catch {}
      process.exit(1);
    }
    const sizeKb = (fs.statSync(outFile).size / 1024).toFixed(0);
    console.log(`[backup] wrote ${outFile} (${sizeKb} KB)`);
    try {
      pruneOldBackups();
    } catch (err) {
      console.error('[backup] prune step failed:', err.message);
    }
  });
}

main();
