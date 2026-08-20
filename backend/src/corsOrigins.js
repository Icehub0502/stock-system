// นโยบาย origin ที่อนุญาต ใช้ร่วมกันทั้ง REST (app.js, CORS middleware) และ
// Socket.io (realtime.js, cors option ตอน attach) แยกไว้เป็นไฟล์เดี่ยว ๆ ไม่ผูกกับ
// app.js เพื่อไม่ให้เกิด circular require (app.js -> jobs.routes.js -> realtime.js
// -> app.js) ซึ่งเคยทำให้ isAllowedOrigin เป็น undefined ตอน socket.io เรียกใช้จริง
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN ||
  'https://champ-powerspk.com,https://www.champ-powerspk.com')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// localhost และ IP วง LAN (มือถือช่างเข้าผ่าน https://<ip>:4443 เพื่อสแกน QR)
// ถือเป็น origin ที่เชื่อถือได้เสมอ ไม่ต้องใส่ใน .env
const LOCAL_ORIGIN_REGEX =
  /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

function isAllowedOrigin(origin) {
  // ไม่มี Origin = same-origin / curl / แอปมือถือ → อนุญาต
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (LOCAL_ORIGIN_REGEX.test(origin)) return true;
  return false;
}

module.exports = { isAllowedOrigin, ALLOWED_ORIGINS, LOCAL_ORIGIN_REGEX };
