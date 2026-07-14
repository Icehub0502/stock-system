// Central place for validated environment config.
// เก็บและตรวจค่า secret ที่จำเป็น "ตอนเริ่มระบบ" — ถ้าไม่มีให้แอปหยุดทันที
// ดีกว่าการปล่อย fallback เดา ๆ ที่เปิดช่องให้คนปลอม token ได้
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

// ต้องมี JWT_SECRET ที่ยาวพอเสมอ ห้ามใช้ค่า default/ค่าตัวอย่าง
const INSECURE_SECRETS = new Set([
  'dev_secret_change_me',
  'change_this_secret_in_production',
  'test-secret',
  'test_secret'
]);

if (!JWT_SECRET || JWT_SECRET.length < 16 || INSECURE_SECRETS.has(JWT_SECRET)) {
  // ยกเว้นตอนรันเทสต์ ให้ผ่านด้วยค่า test ที่กำหนดใน .env.test
  const isTest = process.env.NODE_ENV === 'test';
  if (!isTest) {
    throw new Error(
      'JWT_SECRET ไม่ถูกตั้งค่า หรือสั้น/อ่อนเกินไป — ' +
      'ตั้งค่าที่ยาวและสุ่มอย่างน้อย 16 ตัวอักษรใน backend/.env ก่อนเริ่มระบบ ' +
      '(เช่นรัน: openssl rand -hex 32)'
    );
  }
}

module.exports = {
  JWT_SECRET: JWT_SECRET || 'test-only-secret',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '12h'
};
