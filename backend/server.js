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
const transactionRoutes = require('./src/routes/backend_transactions.routes');
const userRoutes = require('./src/routes/users.routes');
const productCostRoutes = require("./src/routes/productCostRoutes");
const wingArms = require('./src/routes/wingArms');
const quotationCustomerRoutes = require('./src/routes/quotation-customers.routes');
const quotationRoutes = require('./src/routes/quotations.routes');
const receiptsRoutes = require('./src/routes/receipts.routes');
const customersRoutes = require('./src/routes/customers.routes');
const vehiclesRoutes = require('./src/routes/vehicles.routes');
const serviceItemsRoutes = require('./src/routes/service-items.routes');
const warrantiesRoutes = require('./src/routes/warranties.routes');
const productsRoutes = require('./src/routes/products.routes');

function listLandingImages(baseDir = path.join(__dirname, 'public'), folderFilter = '') {
  if (!fs.existsSync(baseDir)) return { images: [], folders: [] };

  const normalizedFilter = (folderFilter || '').trim().toLowerCase();
  const folders = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();

  const images = [];
  const availableFolders = [];

  for (const folder of folders) {
    if (normalizedFilter && folder.toLowerCase() !== normalizedFilter) continue;

    const folderPath = path.join(baseDir, folder);
    if (!fs.existsSync(folderPath)) continue;

    const files = fs.readdirSync(folderPath, { withFileTypes: true })
      .filter((entry) => {
        if (!entry.isFile()) return false;
        const name = entry.name;
        if (name.startsWith('.')) return false;
        if (/\.trashed-|\.thumbnails?/i.test(name)) return false;
        return /\.(jpe?g|png|webp|avif|gif)$/i.test(name);
      })
      .map((entry) => entry.name)
      .sort();

    if (files.length > 0) {
      availableFolders.push(folder);
    }

    for (const file of files) {
      images.push({
        folder,
        name: file,
        url: `/landing-assets/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`
      });
    }
  }

  return { images, folders: availableFolders };
}

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
  app.use("/api/product-costs", productCostRoutes);
  app.use('/api/wing-arms', wingArms);
  app.use('/api/quotation-customers', quotationCustomerRoutes);
  app.use('/api/customers', customersRoutes);
  app.use('/api/quotations', quotationRoutes);
  app.use('/api/receipts', receiptsRoutes);
  app.use('/api/vehicles', vehiclesRoutes);
  app.use('/api/service-items', serviceItemsRoutes);
  app.use('/api/warranties', warrantiesRoutes);
  app.use('/api/products', productsRoutes);

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/api/landing-images', (req, res) => {
    const folderFilter = req.query.folder || req.query.brand || '';
    const { images, folders } = listLandingImages(path.join(__dirname, 'public'), folderFilter);
    res.json({ images, count: images.length, folders });
  });

  // Landing page (ยิงแอด)
  const landingPagePath = path.join(__dirname, 'public', 'champ-power-landing.html');
  app.get('/landing', (req, res) => {
    res.sendFile(landingPagePath);
  });
  app.get('/champ-power-landing.html', (req, res) => {
    res.sendFile(landingPagePath);
  });
  app.get('/champ-power-landing', (req, res) => {
    res.redirect('/champ-power-landing.html');
  });
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/landing-assets', express.static(path.join(__dirname, 'public')));

  // เสิร์ฟไฟล์ frontend ที่ build แล้ว (รัน `npm run build` ใน /frontend ก่อน)
  const frontendDist = path.join(__dirname, '../frontend/dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get(/^\/(?!api).*/, (req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  const PORT_HTTP = process.env.PORT || process.env.PORT_HTTP || 4000;
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