import React, { useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

export default function QRScanner({ onResult, active }) {
  const containerId = useRef(`qr-reader-${Math.random().toString(36).slice(2)}`);
  const scannerRef = useRef(null);

  useEffect(() => {
    if (!active) return;
    const html5QrCode = new Html5Qrcode(containerId.current);
    scannerRef.current = html5QrCode;

    html5QrCode
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 250 },
        (decodedText) => {
          onResult(decodedText);
        },
        () => { /* ignore per-frame "not found" scan errors */ }
      )
      .catch((err) => {
        console.error('ไม่สามารถเปิดกล้องได้:', err);
      });

    return () => {
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .catch(() => {})
          .finally(() => {
            try { scannerRef.current.clear(); } catch (e) { /* noop */ }
          });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return <div id={containerId.current} style={{ width: '100%', maxWidth: 400 }} />;
}
