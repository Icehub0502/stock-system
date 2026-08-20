require('dotenv').config();
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const initDatabase = require('./src/db/init');
const { createApp } = require('./src/app');
const { initRealtime } = require('./src/realtime');

async function main() {
  // เชื่อมต่อ XAMPP MySQL, สร้าง database/ตารางอัตโนมัติถ้ายังไม่มี, และ seed ข้อมูลเริ่มต้น
  await initDatabase();

  const app = createApp();

  const PORT_HTTP = process.env.PORT || process.env.PORT_HTTP || 4000;
  const PORT_HTTPS = process.env.PORT_HTTPS || 4443;
  const certPath = path.join(__dirname, 'certs', 'cert.pem');
  const keyPath = path.join(__dirname, 'certs', 'key.pem');

  const servers = [];

  const httpServer = http.createServer(app).listen(PORT_HTTP, () => {
    console.log(`HTTP server: http://localhost:${PORT_HTTP}`);
  });
  servers.push(httpServer);

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const options = { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
    const httpsServer = https.createServer(options, app).listen(PORT_HTTPS, () => {
      console.log(`HTTPS server: https://localhost:${PORT_HTTPS}`);
      console.log('ใช้ URL นี้ (HTTPS) บนมือถือของช่าง เพื่อให้กล้องสแกน QR ทำงานได้ (getUserMedia ต้องใช้ HTTPS)');
    });
    servers.push(httpsServer);
  } else {
    console.warn('ไม่พบ backend/certs/cert.pem และ backend/certs/key.pem -> HTTPS server จะไม่เปิด');
    console.warn('กล้องสแกน QR บนมือถือจะใช้งานไม่ได้จนกว่าจะสร้าง certificate (ดูวิธีใน README.md)');
  }

  initRealtime(servers);
}

main().catch((err) => {
  console.error('เริ่มเซิร์ฟเวอร์ไม่สำเร็จ:', err.message);
  console.error('ตรวจสอบว่าเปิด XAMPP Control Panel แล้วกด Start ที่ MySQL หรือยัง และค่าใน backend/.env ถูกต้องหรือไม่');
  process.exit(1);
});