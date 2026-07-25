import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' instead of 'autoUpdate': staff may be mid-way through
      // entering a receipt/quotation — auto-activating a new SW under them
      // could swap cached JS chunks out from under an open form. We ask via
      // UpdateBanner and only reload when they choose to.
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: ['favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'ChamppowerSPK ระบบจัดการสต๊อก',
        short_name: 'ChamppowerSPK',
        description: 'ระบบจัดการสต๊อกอะไหล่รถยนต์ ใบเสร็จ ใบเสนอราคา และใบแจ้งซ่อม',
        lang: 'th',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f4f5f7',
        theme_color: '#111111',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell only — /api is handled separately below with NetworkFirst
        // so stock/price data is never served stale-by-default.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
        runtimeCaching: [
          {
            // Read endpoints only (list/detail GETs) — workbox routes match
            // GET by default, so POST/PUT/DELETE (stock changes, receipts,
            // login) are left completely untouched and always hit the network.
            urlPattern: ({ url, request }) =>
              request.method === 'GET' && url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // Off by default: a SW intercepting requests during `npm run dev`
        // makes HMR/debugging confusing. Enable manually when testing PWA
        // behavior locally (`VITE_PWA_DEV=true npm run dev`).
        enabled: false,
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
