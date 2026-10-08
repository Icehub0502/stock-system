import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

export default function QRScanner({ onResult, active }) {
  const containerId = useRef(`qr-reader-${Math.random().toString(36).slice(2)}`);
  const scannerRef = useRef(null);
  const [cameraError, setCameraError] = useState('');

  useEffect(() => {
    if (!active) return undefined;
    setCameraError('');
    let cancelled = false;
    const html5QrCode = new Html5Qrcode(containerId.current);
    scannerRef.current = html5QrCode;

    // stop() ของ html5-qrcode โยน error แบบ synchronous ถ้ากล้องยังไม่เคยเริ่ม (เช่นผู้ใช้ไม่
    // อนุญาตกล้อง หรือปิดหน้าก่อนกล้องเปิดทัน) — ถ้าปล่อยหลุดออกจาก cleanup React จะพังทั้งหน้า
    // (จอขาว) จึงครอบ try/catch ทุกครั้งที่หยุดกล้อง
    const safeStop = () => {
      const clearView = () => {
        try { html5QrCode.clear(); } catch (e) { /* noop */ }
      };
      try {
        const stopped = html5QrCode.stop();
        if (stopped && typeof stopped.then === 'function') {
          stopped.catch(() => {}).finally(clearView);
        } else {
          clearView();
        }
      } catch (e) {
        clearView();
      }
    };

    html5QrCode
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 250 },
        (decodedText) => {
          onResult(decodedText);
        },
        () => { /* ignore per-frame "not found" scan errors */ }
      )
      .then(() => {
        // ปิดหน้าไปแล้วระหว่างรอกล้องเปิด → ปิดกล้องทิ้งทันที ไม่ให้ไฟกล้องค้าง
        if (cancelled) safeStop();
      })
      .catch((err) => {
        console.error('ไม่สามารถเปิดกล้องได้:', err);
        if (!cancelled) {
          setCameraError('เปิดกล้องไม่ได้ — กรุณาอนุญาตการใช้กล้องในเบราว์เซอร์ หรือกด "ปิด" แล้วใช้ปุ่ม "กรอกเอง" แทน');
        }
      });

    return () => {
      cancelled = true;
      safeStop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <>
      <div id={containerId.current} style={{ width: '100%', maxWidth: 400 }} />
      {cameraError && (
        <p role="alert" style={{ margin: '16px 24px', color: '#fecaca', fontSize: 14, lineHeight: 1.6, textAlign: 'center' }}>
          {cameraError}
        </p>
      )}
    </>
  );
}
