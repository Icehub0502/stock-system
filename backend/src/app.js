// Builds the Express app (routes + middleware) without starting any HTTP
// listener, so both server.js (real boot) and tests (supertest) can reuse
// the exact same app wiring instead of two versions drifting apart.
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const fs = require('fs');

// รายชื่อ origin ที่อนุญาตให้เรียก API ข้ามโดเมนได้ — นิยามอยู่ใน corsOrigins.js
// (แยกออกมาจากไฟล์นี้เพื่อไม่ให้ realtime.js เกิด circular require กลับมาที่ app.js)
const { isAllowedOrigin } = require('./corsOrigins');

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
const repairNoticesRoutes = require('./routes/repairNotices.routes');
const lineWebhookRoutes = require('./routes/lineWebhook.routes');
const lineWebhookBot2Routes = require('./routes/lineWebhookBot2.routes');
const lineWebhookBot3Routes = require('./routes/lineWebhookBot3.routes');
const quotePartPricesRoutes = require('./routes/quotePartPrices.routes');
const vehicleModelsRoutes = require('./routes/vehicleModels.routes');
const jobsRoutes = require('./routes/jobs.routes');
const boardRoutes = require('./routes/board.routes');

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
  // limit ยกจาก default 100kb — รูปอะไหล่ในแคตตาล็อกเสนอราคา (quote_part_prices.
  // image_data) ส่งเป็น base64 data URI ตรงๆ เหมือนลายเซ็น อาจเกิน 100kb ได้
  // ยกเป็น 20mb (เดิม 5mb) — หน้าเพิ่มคิวรับรถอัปโหลดรูปได้หลายรูปพร้อมกัน
  // (AddJobModal.jsx) แม้แต่ละรูปย่อแล้วก็ยังรวมกันเกิน 5mb ได้ถ้าถ่ายมาหลายรูป
  // ต้องยกคู่กับ client_max_body_size ที่ nginx (site config บนเซิร์ฟเวอร์) ด้วย
  // ไม่งั้น nginx จะบล็อกก่อนถึง Express เลยจากดีฟอลต์ 1mb
  app.use(express.json({
    limit: '20mb',
    verify: (req, res, buf) => { req.rawBody = buf; }
  }));
  // บีบอัด response ด้วย gzip/deflate (JSON API + frontend bundle) — วางไว้หลัง
  // การเก็บ req.rawBody ด้านบน เพราะ compression ทำงานกับฝั่ง response ไม่ยุ่งกับ
  // การ parse/เก็บ raw body ของ request เลย จึงไม่กระทบการตรวจลายเซ็น LINE webhook
  app.use(compression());

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
  app.use('/api/repair-notices', repairNoticesRoutes);
  app.use('/api/line', lineWebhookRoutes);
  // บอท 2 "รับรายการ" / บอท 3 "ปิดบิล" — endpoint แยกกันเพราะแต่ละบอทมี Channel
  // Secret ของตัวเอง (ดู routes/lineWebhookBot2.routes.js, lineWebhookBot3.routes.js)
  app.use('/api/line/bot2', lineWebhookBot2Routes);
  app.use('/api/line/bot3', lineWebhookBot3Routes);
  app.use('/api/quote-parts', quotePartPricesRoutes);
  app.use('/api/vehicle-models', vehicleModelsRoutes);
  // ระบบคิวรับรถ — /api/jobs ต้องล็อกอิน (ทำ auth เองในไฟล์ route) ส่วน /api/board
  // เปิดสาธารณะสำหรับจอ TV ห้องรับรอง คืนเฉพาะข้อมูลที่ไม่ระบุตัวลูกค้า (ดูคอมเมนต์
  // เตือนในไฟล์ board.routes.js ก่อนแก้ query)
  app.use('/api/jobs', jobsRoutes);
  app.use('/api/board', boardRoutes);

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
  // ไฟล์ใน /assets มีชื่อ hash ต่อท้ายจาก Vite (เปลี่ยนทุกครั้งที่ build ใหม่) จึง
  // cache ยาวได้ปลอดภัย ส่วน index.html ต้องห้าม cache เพื่อให้ผู้ใช้ได้เวอร์ชันใหม่
  // เสมอตอน deploy ใหม่ (ไม่งั้นเบราว์เซอร์จะยังชี้ไปที่ asset hash เดิมที่ไม่มีแล้ว)
  if (fs.existsSync(FRONTEND_DIST)) {
    app.use(
      express.static(FRONTEND_DIST, {
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      })
    );
    app.get(/^\/(?!api).*/, (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    });
  }

  return app;
}

module.exports = { createApp, listLandingImages, isAllowedOrigin };
