import React, { useState, useEffect, useRef, useCallback } from 'react';
import client from '../api/client';
import QRScanner from '../components/QRScanner';

// ─────────────────────────────────────────
//  ICONS
// ─────────────────────────────────────────
const IconArrowLeft = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="20" height="20">
    <path d="M19 12H5M12 5l-7 7 7 7"/>
  </svg>
);
const IconX = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="20" height="20">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const IconCheck = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="18" height="18">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const IconQR = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="32" height="32">
    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="3" y="14" width="7" height="7" rx="1"/>
    <path d="M14 14h2v2h-2zM18 14h3M14 18h1M17 18h4M20 16v2"/>
    <rect x="4.5" y="4.5" width="4" height="4" fill="currentColor" rx="0.5"/>
    <rect x="15.5" y="4.5" width="4" height="4" fill="currentColor" rx="0.5"/>
    <rect x="4.5" y="15.5" width="4" height="4" fill="currentColor" rx="0.5"/>
  </svg>
);
const IconReceipt = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
    <path d="M4 2h16v20l-2.5-1.5L15 22l-2.5-1.5L10 22l-2.5-1.5L5 22V2H4z"/>
    <path d="M8 8h8M8 12h8M8 16h5"/>
  </svg>
);
const IconPackage = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
    <path d="M16.5 9.4L7.5 4.21M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
    <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/>
  </svg>
);
const IconArrowDown = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="28" height="28">
    <path d="M12 5v14M5 12l7 7 7-7"/>
  </svg>
);
const IconArrowUp = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="28" height="28">
    <path d="M12 19V5M5 12l7-7 7 7"/>
  </svg>
);

// ─────────────────────────────────────────
//  STEP CONSTANTS
// ─────────────────────────────────────────
const STEP = { MODE: 'mode', INVOICE: 'invoice', SCAN: 'scan' };

// ─────────────────────────────────────────
//  QUANTITY BOTTOM SHEET
// ─────────────────────────────────────────
function ConfirmSheet({ item, mode, onConfirm, onCancel, loading }) {
  const [qty, setQty] = useState(1);
  const isIN = mode === 'IN';

  useEffect(() => { setQty(1); }, [item]);

  if (!item) return null;

  const stockAfter = isIN
    ? (item.stock_qty ?? item.stock ?? 0) + qty
    : Math.max(0, (item.stock_qty ?? item.stock ?? 0) - qty);

  const label = item.name || item.model_name || '—';
  const code  = item.sku  || item.model_code || '—';
  const stock = item.stock_qty ?? item.stock ?? 0;

  return (
    <div style={styles.sheetBackdrop}>
      <div style={styles.sheet}>
        {/* drag handle */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: '#d1d5db', margin: '0 auto 16px' }} />

        <p style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 2 }}>{label}</p>
        <p style={{ fontFamily: 'monospace', fontSize: 12, color: '#6b7280', marginBottom: 12 }}>{code}</p>

        {/* current stock */}
        <div style={styles.stockRow}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>สต็อกปัจจุบัน</span>
          <span style={{
            fontSize: 13, fontWeight: 600,
            color: stock === 0 ? '#dc2626' : stock <= (item.min_stock || 1) ? '#d97706' : '#15803d',
          }}>
            {stock === 0 ? 'หมด' : `${stock} ชิ้น`}
          </span>
        </div>

        {/* qty picker */}
        <div style={styles.qtyRow}>
          <button style={styles.qtyBtn} onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
          <span style={styles.qtyNum}>{qty}</span>
          <button style={styles.qtyBtn} onClick={() => setQty(q => q + 1)}>+</button>
        </div>

        <p style={{ textAlign: 'center', fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
          {isIN ? 'รับเข้า' : 'จ่ายออก'} {qty} ชิ้น → คงเหลือ {stockAfter} ชิ้น
        </p>

        <button
          style={{ ...styles.primaryBtn, opacity: loading ? 0.6 : 1 }}
          onClick={() => onConfirm(qty)}
          disabled={loading}
        >
          {loading ? 'กำลังบันทึก...' : <><IconCheck /> ยืนยัน {isIN ? 'รับเข้า' : 'จ่ายออก'}</>}
        </button>
        <button style={styles.cancelLink} onClick={onCancel}>ยกเลิก</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
//  SCAN OVERLAY (กล้อง)
// ─────────────────────────────────────────
function ScanOverlay({ active, mode, onResult, onClose }) {
  const isIN = mode === 'IN';
  return (
    <div style={styles.scanBg}>
      {/* top close */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '16px', display: 'flex', justifyContent: 'flex-end', zIndex: 2 }}>
        <button onClick={onClose} style={styles.scanCloseBtn} aria-label="ปิดกล้อง">
          <IconX />
        </button>
      </div>

      {/* mode badge */}
      <div style={{ position: 'absolute', top: 60, left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 2 }}>
        <span style={{ ...styles.badge, ...(isIN ? styles.badgeIN : styles.badgeOUT) }}>
          {isIN ? '▼ รับเข้าสต็อก' : '▲ จ่ายออก'}
        </span>
      </div>

      {/* QR scanner */}
      <div style={{ width: '100%', flex: 1, position: 'relative' }}>
        {active && <QRScanner active={active} onResult={onResult} />}
      </div>

      <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center', padding: '16px 32px 32px' }}>
        วาง QR Code ในกรอบ — ระบบจะสแกนอัตโนมัติ
      </p>
    </div>
  );
}

// ─────────────────────────────────────────
//  ORDER ITEM ROW
// ─────────────────────────────────────────
function OrderRow({ item, index, mode }) {
  const isIN = mode === 'IN';
  return (
    <div style={styles.orderRow}>
      <div style={styles.orderNum}>{index + 1}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontFamily: 'monospace', fontSize: 11, color: '#9ca3af', marginBottom: 2 }}>
          {item.sku || item.model_code}
        </p>
        <p style={{ fontSize: 13, fontWeight: 500, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.name || item.model_name}
        </p>
      </div>
      <div style={{
        fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 8, flexShrink: 0,
        background: isIN ? '#dcfce7' : '#fee2e2',
        color: isIN ? '#166534' : '#991b1b',
      }}>
        {isIN ? '+' : '−'}{item.qty}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
//  TOAST
// ─────────────────────────────────────────
function Toast({ msg, onDone }) {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onDone, 2400);
    return () => clearTimeout(t);
  }, [msg, onDone]);

  if (!msg) return null;
  return (
    <div style={styles.toast}>
      <span style={{ fontSize: 18 }}>{msg.ok ? '✅' : '❌'}</span>
      <div>
        <p style={{ fontSize: 13, fontWeight: 600, color: msg.ok ? '#4ade80' : '#fca5a5' }}>{msg.title}</p>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>{msg.body}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
//  MAIN PAGE
// ─────────────────────────────────────────
export default function TechnicianScanPage() {
  const [step, setStep]           = useState(STEP.MODE);
  const [mode, setMode]           = useState(null);           // 'IN' | 'OUT'
  const [invoice, setInvoice]     = useState('');
  const [invoiceErr, setInvoiceErr] = useState('');
  const [session, setSession]     = useState(null);           // { id, invoice_no }
  const [starting, setStarting]   = useState(false);

  const [scanning, setScanning]   = useState(false);          // กล้องเปิด/ปิด
  const [scannedItem, setScannedItem] = useState(null);       // item ที่รอยืนยัน
  const [scannedType, setScannedType] = useState(null);       // 'rack' | 'wing-arm'
  const [confirmLoading, setConfirmLoading] = useState(false);

  const [orders, setOrders]       = useState([]);             // รายการในบิลนี้
  const [toast, setToast]         = useState(null);

  // ── เลือก mode ──
  const selectMode = (m) => {
    setMode(m);
    setOrders([]);
    setSession(null);
    setScannedItem(null);
    setStep(m === 'IN' ? STEP.INVOICE : STEP.SCAN);
  };

  // ── เปิด session บิล (IN) ──
  const startSession = async () => {
    if (!invoice.trim()) { setInvoiceErr('กรุณากรอกเลขบิล'); return; }
    setStarting(true); setInvoiceErr('');
    try {
      const res = await client.post('/transactions/receipt-session', { invoice_no: invoice.trim() });
      setSession(res.data);
      setOrders([]);
      setStep(STEP.SCAN);
    } catch (err) {
      setInvoiceErr(err?.response?.data?.error || 'เปิดบิลไม่สำเร็จ');
    } finally { setStarting(false); }
  };

  // ── สแกน QR → lookup ──
  const handleScan = useCallback(async (code) => {
    if (!code) return;
    setScanning(false);

    let parsed = code;
    // QR ของเราเข้ารหัส JSON → parse ก่อน
    try { parsed = JSON.parse(code); } catch { /* plain text */ }

    // ดึง sku หรือ model_code จาก QR data
    const sku       = parsed?.sku       || (typeof parsed === 'string' ? parsed : null);
    const modelCode = parsed?.model_code || null;

    // ลอง rack ก่อน
    if (modelCode || sku) {
      const rackKey = modelCode || sku;
      try {
        const res = await client.get(`/racks/lookup/${encodeURIComponent(rackKey)}`);
        setScannedItem(res.data);
        setScannedType('rack');
        return;
      } catch { /* ไม่ใช่ rack */ }
    }

    // ลอง wing-arm ด้วย sku
    if (sku) {
      try {
        const res = await client.get(`/wing-arms/lookup/${encodeURIComponent(sku)}`);
        setScannedItem(res.data);
        setScannedType('wing-arm');
        return;
      } catch { /* ไม่ใช่ wing-arm */ }
    }

    // ไม่เจอเลย
    setToast({ ok: false, title: 'ไม่พบรหัสนี้', body: 'ตรวจสอบว่า QR ถูกต้อง' });
    setScanning(true); // เปิดกล้องต่อ
  }, []);

  // ── ยืนยันจำนวน ──
  const handleConfirm = async (qty) => {
    setConfirmLoading(true);
    try {
      let remaining;

      if (scannedType === 'rack') {
        const endpoint = mode === 'IN' ? '/transactions/in' : '/transactions/out';
        const payload  = { model_code: scannedItem.model_code, qty };
        if (mode === 'IN' && session) payload.receipt_session_id = session.id;
        const res = await client.post(endpoint, payload);
        remaining = res.data.rack.stock_qty;
      } else {
        // wing-arm
        const delta = mode === 'IN' ? qty : -qty;
        const note  = mode === 'IN' && session ? `บิล ${session.invoice_no}` : undefined;
        const res   = await client.patch(`/wing-arms/${scannedItem.id}/stock`, { delta, note });
        remaining   = res.data.stock_qty;
      }

      const label = scannedItem.name || scannedItem.model_name;
      const code  = scannedItem.sku  || scannedItem.model_code;

      setOrders(prev => [{
        sku: code, name: label, qty,
        type: scannedType, id: scannedItem.id,
      }, ...prev]);

      setToast({
        ok: true,
        title: `${mode === 'IN' ? 'รับเข้า' : 'จ่ายออก'}สำเร็จ — ${label.slice(0, 22)}`,
        body:  `จำนวน ${qty} ชิ้น · คงเหลือ ${remaining} ชิ้น`,
      });

      setScannedItem(null);
      setScannedType(null);
      setScanning(true); // เปิดกล้องต่อทันที
    } catch (err) {
      setToast({ ok: false, title: 'บันทึกไม่สำเร็จ', body: err?.response?.data?.error || '' });
    } finally { setConfirmLoading(false); }
  };

  const clearToast = useCallback(() => setToast(null), []);

  const resetAll = () => {
    setStep(STEP.MODE); setMode(null); setSession(null);
    setInvoice(''); setInvoiceErr(''); setOrders([]);
    setScannedItem(null); setScannedType(null); setScanning(false);
  };

  const isIN = mode === 'IN';

  // ─────────────────────────────
  //  RENDER
  // ─────────────────────────────
  return (
    <div style={styles.page}>

      {/* ════════════════════════════
          STEP 1 — เลือก IN / OUT
      ════════════════════════════ */}
      {step === STEP.MODE && (
        <div style={styles.container}>
          <div style={styles.pageHeader}>
            <span style={{ color: '#6b7280' }}><IconQR /></span>
            <h2 style={styles.pageTitle}>สแกน QR Code</h2>
          </div>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>เลือกประเภทรายการก่อนเริ่ม</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button style={styles.modeCard} onClick={() => selectMode('IN')}>
              <div style={{ ...styles.modeIcon, background: '#dcfce7' }}>
                <span style={{ color: '#166534' }}><IconArrowDown /></span>
              </div>
              <div>
                <p style={styles.modeLabel}>รับเข้าสต็อก</p>
                <p style={styles.modeSub}>นำสินค้าเข้าคลัง · ต้องใส่เลขบิล</p>
              </div>
            </button>
            <button style={{ ...styles.modeCard, borderColor: '#fecaca' }} onClick={() => selectMode('OUT')}>
              <div style={{ ...styles.modeIcon, background: '#fee2e2' }}>
                <span style={{ color: '#991b1b' }}><IconArrowUp /></span>
              </div>
              <div>
                <p style={styles.modeLabel}>จ่ายออกจากสต็อก</p>
                <p style={styles.modeSub}>นำสินค้าออกใช้งาน</p>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════
          STEP 2 — กรอกเลขบิล (IN)
      ════════════════════════════ */}
      {step === STEP.INVOICE && (
        <div style={styles.container}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <button onClick={resetAll} style={styles.backBtn}><IconArrowLeft /></button>
            <div>
              <h2 style={{ ...styles.pageTitle, margin: 0 }}>เปิดบิลรับสินค้า</h2>
              <p style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>กรอกเลขบิลก่อนเริ่มสแกน</p>
            </div>
          </div>

          <div style={styles.invoiceCard}>
            <div style={styles.invoiceHeader}>
              <div style={styles.invoiceHeaderIcon}><IconReceipt /></div>
              <div>
                <p style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>เลขที่บิล / Invoice No.</p>
                <p style={{ color: '#93c5fd', fontSize: 12, marginTop: 2 }}>กรอกเลขจากซัพพลายเออร์</p>
              </div>
            </div>
            <div style={{ padding: '16px' }}>
              <label style={styles.fieldLabel}>เลขที่บิล</label>
              <input
                autoFocus
                type="text"
                placeholder="เช่น INV-2026-0001"
                value={invoice}
                onChange={e => setInvoice(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && startSession()}
                style={{ ...styles.input, borderColor: invoiceErr ? '#ef4444' : '#e5e7eb' }}
              />
              {invoiceErr && <p style={styles.errText}>{invoiceErr}</p>}
              <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 6, lineHeight: 1.6 }}>
                สินค้าทุกชิ้นที่สแกนในรอบนี้จะถูกผูกกับบิลนี้
              </p>
              <button
                style={{ ...styles.primaryBtn, marginTop: 14, opacity: starting ? 0.6 : 1 }}
                onClick={startSession}
                disabled={starting}
              >
                {starting ? 'กำลังเปิดบิล...' : 'เริ่มสแกน'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════
          STEP 3 — สแกน + order list
      ════════════════════════════ */}
      {step === STEP.SCAN && (
        <div style={styles.scanPage}>

          {/* top bar */}
          <div style={styles.scanTopBar}>
            <button onClick={resetAll} style={styles.backBtn}><IconX /></button>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#111', lineHeight: 1 }}>
                {isIN ? 'รับเข้าสต็อก' : 'จ่ายออกจากสต็อก'}
              </p>
              <p style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                {isIN && session ? session.invoice_no : 'สแกน QR เพื่อทำรายการ'}
              </p>
            </div>
            <span style={{ ...styles.badge, ...(isIN ? styles.badgeIN : styles.badgeOUT) }}>
              {isIN ? 'IN' : 'OUT'}
            </span>
          </div>

          {/* session bar (IN only) */}
          {isIN && session && (
            <div style={styles.sessionBar}>
              <div>
                <p style={{ fontSize: 11, color: '#3b82f6', fontWeight: 600 }}>บิลปัจจุบัน</p>
                <p style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: '#1e40af' }}>
                  {session.invoice_no}
                </p>
                <p style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>สแกนแล้ว {orders.length} รายการ</p>
              </div>
              <button
                style={styles.closeBillBtn}
                onClick={() => { setStep(STEP.INVOICE); setSession(null); setOrders([]); setInvoice(''); }}
              >
                ✓ ปิดบิล / เปิดใหม่
              </button>
            </div>
          )}

          {/* order list */}
          <div style={styles.orderList}>
            {orders.length === 0 ? (
              <div style={styles.emptyState}>
                <span style={{ fontSize: 48, color: '#d1d5db' }}><IconPackage /></span>
                <p style={{ fontSize: 13, color: '#9ca3af', marginTop: 8 }}>
                  กดปุ่มสแกน <span style={{ fontSize: 18 }}>⬇</span> เพื่อเริ่ม
                </p>
              </div>
            ) : (
              orders.map((o, i) => <OrderRow key={i} item={o} index={i} mode={mode} />)
            )}
            {/* spacer for FAB */}
            <div style={{ height: 96 }} />
          </div>

          {/* FAB */}
          <button style={styles.fab} onClick={() => setScanning(true)} aria-label="สแกน QR">
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <IconQR />
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)', fontWeight: 500, letterSpacing: '0.03em' }}>
                สแกน
              </span>
            </span>
            {orders.length > 0 && (
              <span style={styles.fabBadge}>{orders.length}</span>
            )}
          </button>

          {/* scan overlay (กล้อง) */}
          {scanning && (
            <ScanOverlay
              active={scanning}
              mode={mode}
              onResult={handleScan}
              onClose={() => setScanning(false)}
            />
          )}

          {/* confirm bottom sheet */}
          {scannedItem && !scanning && (
            <ConfirmSheet
              item={scannedItem}
              mode={mode}
              onConfirm={handleConfirm}
              onCancel={() => { setScannedItem(null); setScannedType(null); setScanning(true); }}
              loading={confirmLoading}
            />
          )}

          {/* toast */}
          <Toast msg={toast} onDone={clearToast} />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
//  STYLES
// ─────────────────────────────────────────
const styles = {
  page: {
    minHeight: '100vh',
    background: '#f9fafb',
  },
  container: {
    maxWidth: 480,
    margin: '0 auto',
    padding: '20px 16px',
  },
  pageHeader: {
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4,
  },
  pageTitle: {
    fontSize: 22, fontWeight: 700, color: '#111', letterSpacing: '-0.03em',
  },
  backBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: '#6b7280', padding: 4, display: 'flex', alignItems: 'center',
    borderRadius: 8,
  },
  // mode select
  modeCard: {
    display: 'flex', alignItems: 'center', gap: 14,
    padding: '18px 16px', borderRadius: 16,
    border: '1px solid #bbf7d0', background: '#fff',
    cursor: 'pointer', width: '100%', textAlign: 'left',
    transition: 'background 0.15s',
  },
  modeIcon: {
    width: 52, height: 52, borderRadius: 14,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  modeLabel: { fontSize: 15, fontWeight: 600, color: '#111', marginBottom: 2 },
  modeSub:   { fontSize: 12, color: '#6b7280' },
  // invoice
  invoiceCard: {
    background: '#fff', borderRadius: 16,
    border: '0.5px solid #e5e3de', overflow: 'hidden',
  },
  invoiceHeader: {
    background: '#1e40af', padding: '14px 16px',
    display: 'flex', alignItems: 'center', gap: 10,
  },
  invoiceHeaderIcon: {
    background: 'rgba(255,255,255,0.15)', borderRadius: 10,
    width: 36, height: 36, display: 'flex', alignItems: 'center',
    justifyContent: 'center', color: '#fff',
  },
  fieldLabel: {
    display: 'block', fontSize: 11, fontWeight: 600,
    color: '#374151', letterSpacing: '0.05em',
    textTransform: 'uppercase', marginBottom: 6,
  },
  input: {
    width: '100%', boxSizing: 'border-box',
    padding: '10px 12px', fontSize: 14,
    fontFamily: 'monospace', fontWeight: 600,
    border: '1.5px solid #e5e7eb', borderRadius: 10,
    background: '#f9fafb', outline: 'none', color: '#111',
  },
  errText: { color: '#dc2626', fontSize: 12, marginTop: 6 },
  // scan page — ใช้ fixed layout เพื่อให้ FAB ไม่จมหายใน mobile
  scanPage: {
    display: 'flex', flexDirection: 'column',
    // ไม่ใช้ height:100vh + overflow:hidden เพราะทำให้ FAB absolute ถูกตัด
    // ใช้ minHeight + position:static แทน แล้วให้ FAB เป็น fixed
    minHeight: '100vh',
    background: '#f5f5f0',
    position: 'relative',
  },
  scanTopBar: {
    background: '#fff',
    borderBottom: '0.5px solid #e9e7e1',
    padding: '12px 16px 10px',
    display: 'flex', alignItems: 'center', gap: 10,
    // sticky ให้ติดบนสุดขณะ scroll
    position: 'sticky', top: 0, zIndex: 6,
  },
  sessionBar: {
    background: '#eff6ff', borderBottom: '1px solid #bfdbfe',
    padding: '10px 16px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    position: 'sticky', top: 49, zIndex: 5,  // ต่อจาก topbar
  },
  closeBillBtn: {
    background: '#fff', border: '1px solid #bfdbfe', color: '#2563eb',
    borderRadius: 8, padding: '6px 12px', fontSize: 12,
    fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
    minHeight: 'unset', flexShrink: 0,
  },
  orderList: {
    flex: 1,
    padding: '10px 12px',
    // paddingBottom ให้ content ไม่ซ่อนหลัง FAB
    paddingBottom: 100,
  },
  orderRow: {
    background: '#fff', borderRadius: 12,
    border: '0.5px solid #e5e3de',
    padding: '10px 12px', marginBottom: 8,
    display: 'flex', alignItems: 'center', gap: 10,
  },
  orderNum: {
    width: 22, height: 22, borderRadius: '50%',
    background: '#f3f4f6', fontSize: 10, fontWeight: 500,
    color: '#6b7280', display: 'flex', alignItems: 'center',
    justifyContent: 'center', flexShrink: 0,
  },
  emptyState: {
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    minHeight: 260, opacity: 0.7,
  },
  // FAB — fixed ติดหน้าจอ ไม่โดน overflow:hidden ตัด
  fab: {
    position: 'fixed',
    bottom: 'calc(28px + env(safe-area-inset-bottom, 0px))', // iOS safe area
    left: '50%', transform: 'translateX(-50%)',
    width: 72, height: 72, borderRadius: '50%',
    background: '#2563eb', border: 'none',
    cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 4px 24px rgba(37,99,235,0.45)',
    zIndex: 40,  // สูงกว่า sticky bar
  },
  fabBadge: {
    position: 'absolute', top: -4, right: -4,
    background: '#ef4444', color: '#fff',
    borderRadius: 10, fontSize: 10, fontWeight: 700,
    padding: '2px 6px', border: '2px solid #f5f5f0',
  },
  // scan overlay — fixed ครอบเต็มหน้าจอ
  scanBg: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.92)',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', zIndex: 50,
  },
  scanCloseBtn: {
    background: 'rgba(255,255,255,0.12)',
    border: '1px solid rgba(255,255,255,0.2)',
    color: '#fff', borderRadius: '50%',
    width: 40, height: 40, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: 'unset',
  },
  // bottom sheet — fixed ยึดด้านล่าง
  sheetBackdrop: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'flex-end',
    zIndex: 45,
  },
  sheet: {
    background: '#fff', borderRadius: '20px 20px 0 0',
    padding: '16px 20px',
    // paddingBottom รองรับ iOS home indicator
    paddingBottom: 'calc(28px + env(safe-area-inset-bottom, 0px))',
    width: '100%',
  },
  stockRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '8px 0', borderTop: '0.5px solid #e5e7eb',
    borderBottom: '0.5px solid #e5e7eb', marginBottom: 4,
  },
  qtyRow: {
    display: 'flex', alignItems: 'center',
    justifyContent: 'center', gap: 20, margin: '16px 0',
  },
  qtyBtn: {
    width: 40, height: 40, borderRadius: '50%',
    border: '1.5px solid #e5e7eb', background: '#f9fafb',
    fontSize: 22, cursor: 'pointer', color: '#374151',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  qtyNum: { fontSize: 32, fontWeight: 700, color: '#111', minWidth: 48, textAlign: 'center' },
  // shared
  primaryBtn: {
    width: '100%', padding: '13px',
    background: '#2563eb', color: '#fff',
    border: 'none', borderRadius: 12,
    fontSize: 14, fontWeight: 600, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  cancelLink: {
    width: '100%', padding: '10px',
    background: 'none', border: 'none',
    color: '#6b7280', fontSize: 13,
    cursor: 'pointer', marginTop: 4,
    display: 'block', textAlign: 'center',
  },
  badge: {
    display: 'inline-flex', alignItems: 'center',
    padding: '4px 12px', borderRadius: 20,
    fontSize: 12, fontWeight: 600,
  },
  badgeIN:  { background: '#dcfce7', color: '#166534' },
  badgeOUT: { background: '#fee2e2', color: '#991b1b' },
  // toast — fixed ไม่โดน overflow ตัด
  toast: {
    position: 'fixed', top: 16, left: 16, right: 16,
    background: '#022c22', borderRadius: 14,
    padding: '12px 16px', zIndex: 60,
    display: 'flex', alignItems: 'center', gap: 12,
    boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
  },
};