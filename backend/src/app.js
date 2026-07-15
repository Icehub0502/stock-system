// Builds the Express app (routes + middleware) without starting any HTTP
// listener, so both server.js (real boot) and tests (supertest) can reuse
// the exact same app wiring instead of two versions drifting apart.
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

// รายชื่อ origin ที่อนุญาตให้เรียก API ข้ามโดเมนได้ (คั่นด้วย , ใน .env)
// ปกติ frontend ถูกเสิร์ฟจาก Express ตัวเดียวกัน (same-origin) จึงไม่ต้องพึ่ง CORS
// ค่านี้ไว้เผื่อกรณีเรียกจากโดเมน/มือถือแยก ค่า default คือโดเมนโปรดักชัน
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

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    // origin ที่ไม่อนุญาต: ไม่ส่ง CORS header (เบราว์เซอร์จะบล็อกเอง) แต่ไม่โยน error
    // เพื่อไม่ให้ request พังทั้งก้อน/ไม่รก log ด้วย stack trace
    return callback(null, false);
  }
};

const authRoutes = require('./routes/auth.routes');
const rackRoutes = require('./routes/racks.routes');
const transactionRoutes = require('./routes/backend_transactions.routes');
const userRoutes = require('./routes/users.routes');
const productCostRoutes = require('./routes/productCostRoutes');
const wingArms = require('./routes/wingArms');
const quotationCustomerRoutes = require('./routes/quotation-customers.routes');
const quotationRoutes = require('./routes/quotations.routes');
const receiptsRoutes = require('./routes/receipts.routes');
const customersRoutes = require('./routes/customers.routes');
const vehiclesRoutes = require('./routes/vehicles.routes');
const serviceItemsRoutes = require('./routes/service-items.routes');
const warrantiesRoutes = require('./routes/warranties.routes');
const productsRoutes = require('./routes/products.routes');
const repairNoticesRoutes = require('./routes/repairNotices.routes');
const lineWebhookRoutes = require('./routes/lineWebhook.routes');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const FRONTEND_DIST = path.join(__dirname, '..', '..', 'frontend', 'dist');

function listLandingImages(baseDir = PUBLIC_DIR, folderFilter = '') {
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

function createApp() {
  const app = express();
  // อยู่หลัง nginx reverse proxy: เชื่อ X-Forwarded-For จาก proxy ชั้นแรก
  // เพื่อให้ rate-limit และ req.ip เห็น IP จริงของผู้ใช้ ไม่ใช่ IP ของ nginx
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // helmet: ตั้ง security headers (HSTS, X-Frame-Options, X-Content-Type-Options ฯลฯ)
  // ปิด CSP/COEP ไว้ก่อน เพราะ SPA + รูปจาก Google Fonts/landing อาจโดนบล็อก — ค่อยเปิดเมื่อ audit ครบ
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors(corsOptions));
  // เก็บ raw body ไว้ด้วย — LINE webhook ต้องใช้ตรวจลายเซ็น HMAC (X-Line-Signature)
  // ซึ่งคำนวณจาก body ดิบก่อน parse (ดู routes/lineWebhook.routes.js)
  app.use(express.json({
    verify: (req, res, buf) => { req.rawBody = buf; }
  }));

  app.use('/api/auth', authRoutes);
  app.use('/api/racks', rackRoutes);
  app.use('/api/transactions', transactionRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/product-costs', productCostRoutes);
  app.use('/api/wing-arms', wingArms);
  app.use('/api/quotation-customers', quotationCustomerRoutes);
  app.use('/api/customers', customersRoutes);
  app.use('/api/quotations', quotationRoutes);
  app.use('/api/receipts', receiptsRoutes);
  app.use('/api/vehicles', vehiclesRoutes);
  app.use('/api/service-items', serviceItemsRoutes);
  app.use('/api/warranties', warrantiesRoutes);
  app.use('/api/products', productsRoutes);
  app.use('/api/repair-notices', repairNoticesRoutes);
  app.use('/api/line', lineWebhookRoutes);

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/api/landing-images', (req, res) => {
    const folderFilter = req.query.folder || req.query.brand || '';
    const { images, folders } = listLandingImages(PUBLIC_DIR, folderFilter);
    res.json({ images, count: images.length, folders });
  });

  // Landing page (ยิงแอด)
  const landingPagePath = path.join(PUBLIC_DIR, 'champ-power-landing.html');
  app.get('/landing', (req, res) => {
    res.sendFile(landingPagePath);
  });
  app.get('/champ-power-landing.html', (req, res) => {
    res.sendFile(landingPagePath);
  });
  app.get('/champ-power-landing', (req, res) => {
    res.redirect('/champ-power-landing.html');
  });
  app.use(express.static(PUBLIC_DIR));
  app.use('/landing-assets', express.static(PUBLIC_DIR));

  // เสิร์ฟไฟล์ frontend ที่ build แล้ว (รัน `npm run build` ใน /frontend ก่อน)
  if (fs.existsSync(FRONTEND_DIST)) {
    app.use(express.static(FRONTEND_DIST));
    app.get(/^\/(?!api).*/, (req, res) => {
      res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    });
  }

  return app;
}

module.exports = { createApp, listLandingImages };
