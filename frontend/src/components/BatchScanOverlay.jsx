import React, { useEffect, useRef, useState } from 'react';
import client from '../api/client';
import QRScanner from './QRScanner';
import { ScanPositionChip as PositionChip } from './PositionChip';
import { cleanScannedCode, createScanGate, signalScanned } from '../utils/scanBatch';

const RECENT_ROWS = 3;
const MAX_CODE_LENGTH = 100;

// A shop with a USB scanner on a computer should not be asked for the camera; a phone starts with it on
function startsWithCamera() {
  try {
    return !window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch {
    return true;
  }
}

// Continuous scanning: the camera stays open, each label adds one piece to the basket with a beep, and
// nothing reaches the bill until the basket has been checked. A USB scanner types into the box below.
export default function BatchScanOverlay({ basket, onReview, onClose }) {
  const gateRef = useRef(createScanGate());
  const inputRef = useRef(null);
  const askedRef = useRef(new Set());
  const [cameraOn, setCameraOn] = useState(startsWithCamera);
  const [flash, setFlash] = useState(0);
  const [notice, setNotice] = useState('');
  const [heldCode, setHeldCode] = useState(null); // a label already counted that is still in front of the camera
  const heldTimerRef = useRef(null);
  const [typed, setTyped] = useState('');
  const [found, setFound] = useState({}); // upper-case code → the stock row it belongs to, or null when new

  const accept = (raw) => {
    const code = cleanScannedCode(raw);
    if (!code || code.length > MAX_CODE_LENGTH) {
      setNotice('อ่านได้ แต่ไม่ใช่รหัสอะไหล่ — ไม่ได้นับ');
      return;
    }
    setNotice('');
    basket.add(code);
    setFlash((n) => n + 1);
    signalScanned();
  };

  const handleCamera = (raw) => {
    const verdict = gateRef.current(raw);
    if (verdict === 'new') accept(raw);
    if (verdict === 'held') {
      setHeldCode(cleanScannedCode(raw));
      clearTimeout(heldTimerRef.current);
      heldTimerRef.current = setTimeout(() => setHeldCode(null), 800);
    }
  };

  const handleTyped = (e) => {
    e.preventDefault();
    if (typed.trim()) accept(typed);
    setTyped('');
    inputRef.current?.focus();
  };

  useEffect(() => () => clearTimeout(heldTimerRef.current), []);

  // A USB scanner just types: whatever had the focus last, its next code must land in the box. Without this
  // the code is lost and its Enter presses the last button again.
  useEffect(() => {
    const toBox = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      if (e.target instanceof HTMLInputElement) return;
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', toBox, true);
    return () => window.removeEventListener('keydown', toBox, true);
  }, []);

  // name each new code as it arrives, so a misread or a wrong part shows while the box is still in hand
  useEffect(() => {
    basket.items.forEach(({ code }) => {
      const key = code.toUpperCase();
      if (askedRef.current.has(key)) return;
      askedRef.current.add(key);
      client.get('/stock-receive/lookup', { params: { code } })
        .then((res) => setFound((prev) => ({ ...prev, [key]: res.data.matches?.[0] ?? null })))
        .catch(() => askedRef.current.delete(key));
    });
  }, [basket.items]);

  const recent = basket.items.slice(0, RECENT_ROWS);
  const hidden = basket.items.length - recent.length;

  return (
    <div
      className="scan-camera scan-batch"
      role="dialog"
      aria-modal="true"
      aria-label="สแกนรับเข้าต่อเนื่อง"
      onMouseDown={(e) => { if (e.target.closest('button')) e.preventDefault(); }} // a tapped button must not take the scanner's focus
    >
      <div className="scan-camera-top">
        <span className="scan-pill scan-pill--in">▼ สแกนต่อเนื่อง</span>
        <button type="button" className="scan-batch-camera-toggle" onClick={() => setCameraOn((on) => !on)}>
          {cameraOn ? 'ปิดกล้อง' : 'เปิดกล้อง'}
        </button>
        <button type="button" onClick={onClose} className="scan-camera-close" aria-label="ปิดหน้าสแกน">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="20" height="20">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="scan-camera-view">
        {cameraOn && (
          <>
            <QRScanner active onResult={handleCamera} errorHint="ใช้เครื่องยิงหรือพิมพ์รหัสในช่องด้านล่างแทนได้" />
            {heldCode ? (
              <p className="scan-batch-held" role="status">นับ {heldCode} แล้ว · เอาฉลากออกจากกล้องก่อนสแกนชิ้นถัดไป</p>
            ) : (
              <p className="scan-batch-hint">เล็ง QR หรือบาร์โค้ดทีละชิ้น · รหัสเดิมชิ้นถัดไป ให้เอาฉลากออกจากกล้องก่อน</p>
            )}
          </>
        )}
        {flash > 0 && <span key={flash} className="scan-batch-flash" aria-hidden="true" />}
      </div>

      <div className="scan-batch-panel">
        <form className="scan-batch-entry" onSubmit={handleTyped}>
          <input
            ref={inputRef}
            autoFocus={!cameraOn}
            className="scan-input scan-input--mono"
            value={typed}
            maxLength={MAX_CODE_LENGTH}
            autoComplete="off"
            autoCapitalize="characters"
            enterKeyHint="next"
            placeholder="เครื่องยิง หรือพิมพ์รหัส"
            aria-label="รหัสอะไหล่"
            onChange={(e) => setTyped(e.target.value)}
          />
          <button type="submit" className="scan-btn scan-btn--ghost" disabled={!typed.trim()}>เพิ่ม</button>
        </form>
        {notice && <p className="scan-error" role="alert">{notice}</p>}

        <div aria-live="polite">
          {recent.length === 0 ? (
            <p className="scan-batch-empty">ยังไม่มีรายการ เริ่มสแกนได้เลย</p>
          ) : recent.map(({ code, qty }) => {
            const key = code.toUpperCase();
            const stock = found[key];
            const known = Object.prototype.hasOwnProperty.call(found, key);
            return (
              <div className="scan-batch-row" key={key}>
                <div className="scan-batch-row-main">
                  <div className="scan-row-code">
                    {stock && <PositionChip position={stock.position} />}
                    <span className="scan-code">{code}</span>
                    {known && !stock && <span className="scan-batch-new">รหัสใหม่</span>}
                  </div>
                  {stock && <p className="scan-batch-row-name">{stock.description || stock.category_name}</p>}
                </div>
                <div className="scan-batch-stepper">
                  <button
                    type="button"
                    className={qty === 1 ? 'is-remove' : undefined}
                    onClick={() => basket.setQty(code, qty - 1)}
                    aria-label={qty === 1 ? `เอา ${code} ออก` : `ลดจำนวน ${code}`}
                  >
                    {qty === 1 ? '✕' : '−'}
                  </button>
                  <b aria-label={`จำนวน ${code}`}>{qty}</b>
                  <button type="button" onClick={() => basket.setQty(code, qty + 1)} aria-label={`เพิ่มจำนวน ${code}`}>+</button>
                </div>
              </div>
            );
          })}
          {hidden > 0 && <p className="scan-batch-more">และอีก {hidden} รหัส ดูได้ในหน้าตรวจรายการ</p>}
        </div>

        <button
          type="button"
          className="scan-btn scan-btn--in scan-btn--block scan-btn--lg"
          onClick={onReview}
          disabled={basket.items.length === 0}
        >
          ตรวจรายการ ({basket.items.length} รหัส · {basket.totalQty} ชิ้น)
        </button>
      </div>
    </div>
  );
}
