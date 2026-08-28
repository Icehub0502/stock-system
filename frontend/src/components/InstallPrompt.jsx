import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

const DISMISS_KEY = 'pwa-install-dismissed';

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true // iOS Safari
  );
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

// Chrome/Edge/Android fire `beforeinstallprompt` and let us trigger the
// native install dialog. iOS Safari has neither event — "Add to Home
// Screen" only exists as a manual Share-sheet action, so we just point
// users at it instead.
export default function InstallPrompt() {
  const location = useLocation();
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');
  // หน้าประวัติรถลูกค้า (/track) เป็นหน้าสาธารณะให้ลูกค้าเปิดดูเฉย ๆ ไม่ใช่หน้าที่คนใน
  // ร้านใช้งานประจำ — เจ้าของร้านสั่งไม่ให้ชวนลูกค้าโหลดแอปที่หน้านี้ ให้เห็นเป็นเว็บ
  // ปกติธรรมดา
  const isCustomerTrackPage = location.pathname.startsWith('/track');

  useEffect(() => {
    if (isStandalone() || dismissed) return undefined;

    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    if (isIos()) setShowIosHint(true);

    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, [dismissed]);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    dismiss();
  };

  if (dismissed || isStandalone() || isCustomerTrackPage) return null;
  if (!deferredPrompt && !showIosHint) return null;

  return (
    <div className="pwa-install-banner" role="dialog" aria-label="ติดตั้งแอป">
      <div className="pwa-install-text">
        {deferredPrompt ? (
          <>
            <strong>ติดตั้งแอปนี้บนอุปกรณ์ของคุณ</strong>
            <span>ใช้งานได้เหมือนแอปมือถือ เปิดเร็ว ใช้งานได้แม้เน็ตหลุด</span>
          </>
        ) : (
          <>
            <strong>เพิ่มไปที่หน้าจอโฮม</strong>
            <span>แตะปุ่มแชร์ (⬆️) แล้วเลือก "เพิ่มไปยังหน้าจอโฮม"</span>
          </>
        )}
      </div>
      <div className="pwa-install-actions">
        {deferredPrompt && (
          <button type="button" className="btn-primary btn-sm" onClick={install}>
            ติดตั้ง
          </button>
        )}
        <button type="button" className="pwa-banner-close" onClick={dismiss} aria-label="ปิด">
          ✕
        </button>
      </div>
    </div>
  );
}
