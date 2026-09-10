// เก็บรูปเป็นไฟล์บนดิสก์ (backend/uploads/) แทนยัด base64 ตรงเข้าคอลัมน์ LONGTEXT
// ในฐานข้อมูล — job_photos/quote_part_prices.image_data โตจน DB หนักหลายร้อย MB
// (ดูที่มาการตัดสินใจนี้ในบทสนทนากับเจ้าของร้าน) คอลัมน์ยังเป็น LONGTEXT เดิม แค่
// เปลี่ยนสิ่งที่เก็บจาก data URI เต็มๆ มาเป็น URL พาธสั้นๆ (เช่น
// "/uploads/job-photos/<uuid>.jpg") ซึ่ง <img src> ใช้งานได้เหมือนเดิมทุกที่ ไม่ต้อง
// แก้ frontend เลย (ดู app.js ที่ mount express.static ไว้ที่ /uploads)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function ensureSubdir(subfolder) {
  const dir = path.join(UPLOADS_DIR, subfolder);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// value ที่รับมาจากหน้าเว็บ อาจเป็น data URI จริง ๆ (รูปใหม่ที่พึ่งถ่าย/เลือก) หรือ
// เป็น URL พาธที่เคยแปลงเป็นไฟล์ไปแล้วก่อนหน้านี้ (แก้ไขข้อมูลอื่นแต่ไม่เปลี่ยนรูป —
// ต้องส่งค่าเดิมกลับมาผ่านฟอร์มเดิม) หรือ path เก่าจาก import_part_images.js
// (frontend/public/part-images/...) — เคสหลังนี้ไม่ใช่ data: เลย ผ่านทะลุตรง ๆ
function saveDataUrlToFile(value, subfolder) {
  if (typeof value !== 'string' || !value) return null;
  const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(value);
  if (!match) return value; // ไม่ใช่ data URI (เป็น URL พาธอยู่แล้ว) — คงค่าเดิมไว้

  const ext = MIME_TO_EXT[match[1].toLowerCase()] || 'jpg';
  const buffer = Buffer.from(match[2], 'base64');
  const filename = `${crypto.randomUUID()}.${ext}`;
  const dir = ensureSubdir(subfolder);
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `/uploads/${subfolder}/${filename}`;
}

// ลบไฟล์ที่เคยเซฟไว้ (ตอนลบรูป/ลบงาน) — best-effort เท่านั้น ไม่โยน error ต่อถ้าลบ
// ไม่ได้ (ไฟล์หายไปแล้ว/สิทธิ์ไม่พอ ฯลฯ) เพราะแค่พื้นที่ดิสก์ค้าง ไม่ใช่ข้อมูลจริงหาย
// กัน path traversal ตรง ๆ — รับแค่ path ที่ขึ้นต้นด้วย /uploads/ เท่านั้น
function deleteUploadedFile(urlPath) {
  if (typeof urlPath !== 'string' || !urlPath.startsWith('/uploads/')) return;
  const resolved = path.join(UPLOADS_DIR, urlPath.slice('/uploads/'.length));
  if (!resolved.startsWith(UPLOADS_DIR)) return;
  fs.unlink(resolved, () => {}); // เงียบไว้ทั้ง success/error
}

module.exports = { UPLOADS_DIR, saveDataUrlToFile, deleteUploadedFile };
