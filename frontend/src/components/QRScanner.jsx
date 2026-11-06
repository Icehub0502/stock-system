import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

// QR labels of this system plus the barcodes parts suppliers print. Less common formats stay off because
// the reader sometimes "finds" them in printed text, which would add a wrong code.
const FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
];

// The reader decodes the frame at the size the video is laid out, which on a phone is too coarse for a barcode
// (about 150 thin bars in 340 pixels). So the video is laid out this many times larger and shrunk back on screen.
const DECODE_SCALE = 2;

// wider than tall: a barcode needs its full width in the frame, and a QR label still fits
function scanBox(viewWidth) {
  const width = Math.floor(viewWidth * 0.9);
  return { width, height: Math.floor(width * 0.6) };
}

export default function QRScanner({ onResult, active, errorHint = 'กด "ปิด" แล้วใช้ปุ่ม "กรอกเอง" แทน' }) {
  const containerId = useRef(`qr-reader-${Math.random().toString(36).slice(2)}`);
  const scannerRef = useRef(null);
  const readerRef = useRef(null);
  const [frameHeight, setFrameHeight] = useState(undefined);
  const [cameraError, setCameraError] = useState('');
  // the camera starts once, so it reads the latest handler from here instead of the one it started with
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  // the shrink does not change the space the video takes up, so the frame takes its height from the video
  useEffect(() => {
    const reader = readerRef.current;
    if (!reader || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setFrameHeight(reader.offsetHeight / DECODE_SCALE));
    observer.observe(reader);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    setCameraError('');
    let cancelled = false;
    const html5QrCode = new Html5Qrcode(containerId.current, {
      formatsToSupport: FORMATS,
      verbose: false,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true }, // the phone's own reader where there is one
    });
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
        {
          fps: 10,
          qrbox: scanBox,
          disableFlip: true,
          videoConstraints: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        },
        (decodedText) => {
          onResultRef.current(decodedText);
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
          setCameraError(`เปิดกล้องไม่ได้ — กรุณาอนุญาตการใช้กล้องในเบราว์เซอร์ หรือ${errorHint}`);
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
      <div style={{ width: '100%', maxWidth: 400, height: frameHeight, overflow: 'hidden', flexShrink: 0 }}>
        <div
          id={containerId.current}
          ref={readerRef}
          style={{ width: `${DECODE_SCALE * 100}%`, transform: `scale(${1 / DECODE_SCALE})`, transformOrigin: 'top left' }}
        />
      </div>
      {cameraError && (
        <p role="alert" style={{ margin: '16px 24px', color: '#fecaca', fontSize: 14, lineHeight: 1.6, textAlign: 'center' }}>
          {cameraError}
        </p>
      )}
    </>
  );
}
