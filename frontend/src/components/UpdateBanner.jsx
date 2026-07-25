import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

// registerType is 'prompt' (see vite.config.js) — a new service worker sits
// "waiting" until the user opts in here, instead of auto-activating under
// someone mid-form.
export default function UpdateBanner() {
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

  const close = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

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
        <button type="button" className="pwa-banner-close" onClick={close} aria-label="ปิด">
          ✕
        </button>
      </div>
    </div>
  );
}
