// Builds the Express app (routes + middleware) without starting any HTTP
// listener, so both server.js (real boot) and tests (supertest) can reuse
// the exact same app wiring instead of two versions drifting apart.
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

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
  app.use(cors());
  app.use(express.json());

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
