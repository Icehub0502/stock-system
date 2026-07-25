import React, { useEffect, useState } from 'react';

// The app shell + already-viewed list pages still work offline (precached +
// api-cache from vite-plugin-pwa), but data can be stale and anything that
// writes (save receipt, adjust stock) will fail — this banner just makes
// that state visible instead of letting requests silently time out.
export default function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div className="pwa-offline-banner" role="status" aria-live="polite">
      ออฟไลน์ — กำลังแสดงข้อมูลล่าสุดที่บันทึกไว้ การบันทึก/แก้ไขจะใช้ไม่ได้จนกว่าจะเชื่อมต่อเน็ตอีกครั้ง
    </div>
  );
}
