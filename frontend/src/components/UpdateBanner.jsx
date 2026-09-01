import React from 'react';
import { useLocation } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';

// registerType is 'prompt' (see vite.config.js) — a new service worker sits
// "waiting" until the user opts in here, instead of auto-activating under
// someone mid-form.
export default function UpdateBanner() {
  const location = useLocation();
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Check for a new version periodically — the app is often left open
      // in a browser tab for a full shift without a hard refresh.
      if (!registration) return;
      setInterval(() => registration.update(), 60 * 60 * 1000);
    },
  });

  // ปิดได้แค่ตอนเป็นข้อความ "พร้อมใช้งานออฟไลน์" เฉย ๆ (แค่แจ้งให้ทราบ ไม่ต้องทำอะไร)
  // ส่วน needRefresh ห้ามปิดทิ้งได้ — เดิมกดปิดแล้ว setNeedRefresh(false) ทำให้แบนเนอร์
  // หายไปแต่ service worker เวอร์ชันใหม่ยัง "รอ" อยู่เหมือนเดิม (ไม่ re-fire event ให้
  // เตือนซ้ำ) พนักงานที่กดปิดไปเฉย ๆ (เผลอ/รีบ) เลยติดค้างเวอร์ชันเก่าไปทั้งกะโดยไม่รู้ตัว
  // จนกว่าจะปิดแท็บ/รีเฟรชเองเอง (สาเหตุของความสับสน "แก้แล้วทำไมยังไม่เปลี่ยน" ที่เจอซ้ำ ๆ)
  const close = () => {
    if (needRefresh) return;
    setOfflineReady(false);
  };

  // หน้าประวัติรถลูกค้า (/track) เป็นหน้าสาธารณะให้ลูกค้าเปิดดูเฉย ๆ — ไม่ควรเห็น
  // แบนเนอร์เกี่ยวกับแอป/เวอร์ชันใหม่ที่ไม่เกี่ยวกับตัวเอง (mirror InstallPrompt.jsx)
  if (location.pathname.startsWith('/track')) return null;
  if (!offlineReady && !needRefresh) return null;

  return (
    <div className="pwa-update-banner" role="status">
      <span>
        {needRefresh
          ? 'มีเวอร์ชันใหม่ของแอป — รีเฟรชเพื่ออัปเดต'
          : 'พร้อมใช้งานออฟไลน์แล้ว'}
      </span>
      <div className="pwa-update-actions">
        {needRefresh && (
          <button type="button" className="btn-primary btn-sm" onClick={() => updateServiceWorker(true)}>
            รีเฟรชตอนนี้
          </button>
        )}
        {!needRefresh && (
          <button type="button" className="pwa-banner-close" onClick={close} aria-label="ปิด">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
