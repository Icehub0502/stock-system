require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const initDatabase = require('./src/db/init');

const authRoutes = require('./src/routes/auth.routes');
const rackRoutes = require('./src/routes/racks.routes');
const transactionRoutes = require('./src/routes/transactions.routes');
const userRoutes = require('./src/routes/users.routes');

async function main() {
  // เชื่อมต่อ XAMPP MySQL, สร้าง database/ตารางอัตโนมัติถ้ายังไม่มี, และ seed ข้อมูลเริ่มต้น
  await initDatabase();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use('/api/auth', authRoutes);
  app.use('/api/racks', rackRoutes);
  app.use('/api/transactions', transactionRoutes);
  app.use('/api/users', userRoutes);

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  // เสิร์ฟไฟล์ frontend ที่ build แล้ว (รัน `npm run build` ใน /frontend ก่อน)
  const frontendDist = path.join(__dirname, '../frontend/dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get(/^\/(?!api).*/, (req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  const PORT_HTTP = process.env.PORT_HTTP || 4000;
  const PORT_HTTPS = process.env.PORT_HTTPS || 4443;
  const certPath = path.join(__dirname, 'certs', 'cert.pem');
  const keyPath = path.join(__dirname, 'certs', 'key.pem');

  http.createServer(app).listen(PORT_HTTP, () => {
    console.log(`HTTP server: http://localhost:${PORT_HTTP}`);
  });

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const options = { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
    https.createServer(options, app).listen(PORT_HTTPS, () => {
      console.log(`HTTPS server: https://localhost:${PORT_HTTPS}`);
      console.log('ใช้ URL นี้ (HTTPS) บนมือถือของช่าง เพื่อให้กล้องสแกน QR ทำงานได้ (getUserMedia ต้องใช้ HTTPS)');
    });
  } else {
    console.warn('ไม่พบ backend/certs/cert.pem และ backend/certs/key.pem -> HTTPS server จะไม่เปิด');
    console.warn('กล้องสแกน QR บนมือถือจะใช้งานไม่ได้จนกว่าจะสร้าง certificate (ดูวิธีใน README.md)');
  }
}

main().catch((err) => {
  console.error('เริ่มเซิร์ฟเวอร์ไม่สำเร็จ:', err.message);
  console.error('ตรวจสอบว่าเปิด XAMPP Control Panel แล้วกด Start ที่ MySQL หรือยัง และค่าใน backend/.env ถูกต้องหรือไม่');
  process.exit(1);
});
