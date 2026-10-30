import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import client from '../api/client';
import QRScanner from '../components/QRScanner';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';
import { positionLabel, POSITION_COLOR, NEUTRAL_POSITION_COLOR } from '../utils/stockPositions';

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

const IconSearch = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="18" height="18">
    <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>
  </svg>
);
const IconTrash = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="16" height="16">
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
  </svg>
);
const IconEdit = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);

// ─────────────────────────────────────────
//  STEP CONSTANTS
// ─────────────────────────────────────────
// DONE = หน้าสรุปหลังกด "เสร็จสิ้น" — ทวนของที่สแกนเข้าไปทั้งหมดก่อนปิดงาน
// แก้ผิดได้ (ลบทีละรายการ) แล้วกลับไปสแกนต่อได้
const STEP = { MODE: 'mode', INVOICE: 'invoice', SCAN: 'scan', DONE: 'done' };

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─────────────────────────────────────────
//  ชิ้นส่วนที่ใช้ซ้ำ
// ─────────────────────────────────────────
function PositionChip({ position }) {
  if (!position) return null;
  const color = POSITION_COLOR[position] || NEUTRAL_POSITION_COLOR;
  return (
    <span className="scan-chip" style={{ color: color.fg, background: color.bg }}>
      {positionLabel(position)}
    </span>
  );
}

// ป้ายประเภทของรายการในบิล (ข้างรหัส)
function kindLabel(type) {
  if (type === 'stock_item') return 'สต๊อกรวม';
  if (type === 'rack') return 'แร็ค';
  return 'ปีกนก';
}

// ─────────────────────────────────────────
//  QUANTITY BOTTOM SHEET — ยืนยันจำนวนหลังสแกน/เลือกรายการ
// ─────────────────────────────────────────
function ConfirmSheet({ item, mode, onConfirm, onCancel, loading, deferred = false }) {
  const [qty, setQty] = useState(1);
  const [cost, setCost] = useState('');
  const isIN = mode === 'IN';

  useEffect(() => { setQty(1); setCost(''); }, [item]);

  if (!item) return null;

  const stock = item.stock_qty ?? item.stock ?? 0;
  const stockAfter = isIN ? stock + qty : Math.max(0, stock - qty);
  const label = item.name || item.model_name || '—';
  const code = item.sku || item.model_code || '—';
  const stockClass = stock === 0 ? 'is-out' : stock <= (item.min_stock || 1) ? 'is-low' : 'is-ok';

  const setQtyFromInput = (value) => {
    const n = Math.floor(Number(value));
    setQty(Number.isFinite(n) && n >= 1 ? Math.min(n, 100000) : 1);
  };

  return (
    <div className="scan-sheet-backdrop">
      <div className="scan-sheet" role="dialog" aria-modal="true" aria-label="ยืนยันจำนวน">
        <div className="scan-sheet-handle" />

        <div className="scan-confirm-item">
          <div className="scan-confirm-code">
            <PositionChip position={item.position} />
            <span className="scan-code">{code}</span>
          </div>
          <p className="scan-confirm-name">{label}</p>
        </div>

        <div className="scan-confirm-stock">
          <span>สต็อกปัจจุบัน{item.position ? ` (${positionLabel(item.position)})` : ''}</span>
          <strong className={stockClass}>{stock === 0 ? 'หมด' : `${stock} ชิ้น`}</strong>
        </div>

        <div className="scan-stepper">
          <button type="button" className="scan-stepper-btn" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="ลดจำนวน">−</button>
          <input
            className="scan-stepper-input"
            type="number"
            inputMode="numeric"
            min="1"
            value={qty}
            onChange={(e) => setQtyFromInput(e.target.value)}
            aria-label="จำนวน"
          />
          <button type="button" className="scan-stepper-btn" onClick={() => setQty((q) => Math.min(100000, q + 1))} aria-label="เพิ่มจำนวน">+</button>
        </div>

{isIN && deferred && (
        <div className="scan-cost">
          <label className="scan-label" htmlFor="scan-cost">ต้นทุนต่อชิ้น (บาท) — ยังไม่ทราบ ใส่ทีหลังได้</label>
          <input id="scan-cost" className="scan-input" type="number" inputMode="decimal" min="0" step="0.01" placeholder="เช่น 850" value={cost} onChange={(e) => setCost(e.target.value)} />
        </div>

)}
        <p className="scan-confirm-result">
          {deferred
            ? <>รับเข้า <b>{qty}</b> ชิ้น → จะเป็น <b>{stockAfter}</b> ชิ้น หลังกดเสร็จสิ้น</>
            : <>{isIN ? 'รับเข้า' : 'จ่ายออก'} <b>{qty}</b> ชิ้น → คงเหลือ <b>{stockAfter}</b> ชิ้น</>}
        </p>

        <button
          type="button"
          className={`scan-btn scan-btn--block scan-btn--lg ${isIN ? 'scan-btn--in' : 'scan-btn--out'}`}
          onClick={() => onConfirm(qty, cost)}
          disabled={loading}
        >
          {loading ? 'กำลังบันทึก...' : <><IconCheck /> {deferred ? 'เพิ่มเข้ารายการรับเข้า' : `ยืนยัน${isIN ? 'รับเข้า' : 'จ่ายออก'}`}</>}
        </button>
        <button type="button" className="scan-sheet-cancel" onClick={onCancel}>ยกเลิก</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
//  แก้จำนวน/ลบ รายการรอยืนยันของบิล (พนักงานกรอกผิด) — ยังไม่บวกสต๊อก จึงแก้/ลบได้อิสระ
// ─────────────────────────────────────────
function EditQtySheet({ order, onSave, onDelete, onCancel, loading }) {
  const [qty, setQty] = useState(order.qty);
  const startCost = order.unitCost === null || order.unitCost === undefined ? '' : String(order.unitCost);
  const [cost, setCost] = useState(startCost);

  useEffect(() => { setQty(order.qty); setCost(startCost); }, [order]); // eslint-disable-line react-hooks/exhaustive-deps

  const setQtyFromInput = (value) => {
    const n = Math.floor(Number(value));
    setQty(Number.isFinite(n) && n >= 1 ? Math.min(n, 100000) : 1);
  };

  return (
    <div className="scan-sheet-backdrop">
      <div className="scan-sheet" role="dialog" aria-modal="true" aria-label="แก้จำนวน">
        <div className="scan-sheet-handle" />
        <h2 className="scan-sheet-title">แก้จำนวนรายการ</h2>

        <div className="scan-confirm-item">
          <div className="scan-confirm-code">
            <PositionChip position={order.position} />
            <span className="scan-code">{order.sku}</span>
            <span className="scan-pending-chip">รอยืนยัน</span>
          </div>
          <p className="scan-confirm-name">{order.name}</p>
        </div>

        <div className="scan-stepper">
          <button type="button" className="scan-stepper-btn" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="ลดจำนวน">−</button>
          <input
            className="scan-stepper-input"
            type="number"
            inputMode="numeric"
            min="1"
            value={qty}
            onChange={(e) => setQtyFromInput(e.target.value)}
            aria-label="จำนวน"
          />
          <button type="button" className="scan-stepper-btn" onClick={() => setQty((q) => Math.min(100000, q + 1))} aria-label="เพิ่มจำนวน">+</button>
        </div>

        <div className="scan-cost">
          <label className="scan-label" htmlFor="scan-edit-cost">ต้นทุนต่อชิ้น (บาท) — ยังไม่ทราบ ใส่ทีหลังได้</label>
          <input id="scan-edit-cost" className="scan-input" type="number" inputMode="decimal" min="0" step="0.01" placeholder="เช่น 850" value={cost} onChange={(e) => setCost(e.target.value)} />
        </div>

        <p className="scan-confirm-result">จำนวนที่จะรับเข้า <b>{qty}</b> ชิ้น (ยังไม่บวกสต๊อกจนกว่าจะกดเสร็จสิ้น)</p>

        <button
          type="button"
          className="scan-btn scan-btn--block scan-btn--lg scan-btn--in"
          onClick={() => onSave(qty, cost)}
          disabled={loading || (qty === order.qty && cost === startCost)}
        >
          {loading ? 'กำลังบันทึก...' : <><IconCheck /> บันทึกจำนวน</>}
        </button>
        <button type="button" className="scan-sheet-danger" onClick={() => onDelete(order)} disabled={loading}>
          <IconTrash /> ลบรายการนี้
        </button>
        <button type="button" className="scan-sheet-cancel" onClick={onCancel}>ปิด</button>
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
    <div className="scan-camera">
      <div className="scan-camera-top">
        <span className={`scan-pill ${isIN ? 'scan-pill--in' : 'scan-pill--out'}`}>
          {isIN ? '▼ รับเข้าสต็อก' : '▲ จ่ายออก'}
        </span>
        <button type="button" onClick={onClose} className="scan-camera-close" aria-label="ปิดกล้อง">
          <IconX />
        </button>
      </div>

      <div className="scan-camera-view">
        {active && <QRScanner active={active} onResult={onResult} />}
      </div>

      <p className="scan-camera-hint">วาง QR Code ในกรอบ — ระบบจะสแกนอัตโนมัติ</p>
    </div>
  );
}

// ─────────────────────────────────────────
//  ORDER ITEM ROW — แถวรายการในบิล (หน้าสแกนและหน้าสรุปใช้ร่วมกัน)
// ─────────────────────────────────────────
function OrderRow({ item, index, mode, onEdit, onDelete, busy }) {
  const isIN = mode === 'IN';
  const color = item.position ? (POSITION_COLOR[item.position] || NEUTRAL_POSITION_COLOR) : null;
  return (
    <div className={`scan-row${item.pending ? ' is-pending' : ''}`}>
      <span className="scan-row-no">{index}</span>
      <div className="scan-row-main">
        <div className="scan-row-code">
          <PositionChip position={item.position} />
          <span className="scan-code" style={color ? { color: color.fg } : undefined}>
            {item.sku || item.model_code}
          </span>
          <span className="scan-kind">{kindLabel(item.type)}</span>
          {item.pending && <span className="scan-pending-chip">รอยืนยัน</span>}
        </div>
        <p className="scan-row-name">{item.name || item.model_name}</p>
        {item.pending && isIN && (
          <p className="scan-cost-note">{item.unitCost !== null && item.unitCost !== undefined ? `ต้นทุน ฿${item.unitCost}/ชิ้น` : 'ยังไม่ใส่ต้นทุน'}</p>
        )}
      </div>
      <span className={`scan-qty ${item.pending ? 'is-pending' : isIN ? 'is-in' : 'is-out'}`}>
        {isIN ? '+' : '−'}{item.qty}
      </span>
      {(onEdit || onDelete) && (
        <div className="scan-row-actions">
          {onEdit && (
            <button type="button" className="scan-edit" onClick={() => onEdit(item)} disabled={busy}
              aria-label={`แก้จำนวน ${item.name}`}>
              <IconEdit />
            </button>
          )}
          {onDelete && (
            <button type="button" className="scan-del" onClick={() => onDelete(item)} disabled={busy}
              aria-label={`ลบ ${item.name}`}>
              <IconTrash />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
//  TOAST
// ─────────────────────────────────────────
function Toast({ msg, onDone }) {
  useEffect(() => {
    if (!msg) return undefined;
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [msg, onDone]);

  if (!msg) return null;
  return (
    <div className={`scan-toast ${msg.ok ? 'is-ok' : 'is-error'}`} role="status">
      <span className="scan-toast-icon">{msg.ok ? '✓' : '!'}</span>
      <div>
        <p className="scan-toast-title">{msg.title}</p>
        {msg.body ? <p className="scan-toast-body">{msg.body}</p> : null}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
//  สต๊อกรวม (โหมดรับเข้า) — ผลค้นหา/สแกนจาก /stock-receive หนึ่งแถว = หนึ่งตำแหน่งของหนึ่งรายการ
// ─────────────────────────────────────────

// แปลงผลจาก /stock-receive เป็นรูปแบบเดียวกับ item ที่ ConfirmSheet/OrderRow ใช้อยู่
function matchToItem(m) {
  const where = m.position_label ? ` (${m.position_label})` : '';
  return {
    item_id: m.item_id,
    position: m.position,
    name: `${m.category_name} · ${m.description || m.code}${where}`,
    model_code: m.code,
    stock_qty: m.qty,
    min_stock: m.min_stock,
  };
}

function MatchRow({ match, onPick }) {
  const color = match.position ? (POSITION_COLOR[match.position] || NEUTRAL_POSITION_COLOR) : null;
  return (
    <button type="button" className="scan-match" onClick={() => onPick(match)}>
      <div className="scan-match-main">
        <div className="scan-row-code">
          <PositionChip position={match.position} />
          <span className="scan-code" style={color ? { color: color.fg } : undefined}>{match.code || '—'}</span>
        </div>
        <p className="scan-row-name">{match.category_name} · {match.description || '—'}</p>
      </div>
      <span className="scan-match-qty">
        <b>{match.qty}</b>
        <small>คงเหลือ</small>
      </span>
    </button>
  );
}

// สแกนแล้วเจอหลายรายการที่รหัสซ้ำกัน — ให้เลือกเอง
function MatchPickSheet({ matches, onPick, onCancel }) {
  return (
    <div className="scan-sheet-backdrop">
      <div className="scan-sheet scan-sheet--tall" role="dialog" aria-modal="true" aria-label="เลือกรายการ">
        <div className="scan-sheet-handle" />
        <h2 className="scan-sheet-title">รหัสนี้ตรงกับหลายรายการ</h2>
        <p className="scan-sheet-sub">เลือกรายการที่ต้องการรับเข้า</p>
        <div className="scan-match-list">
          {matches.map((m) => <MatchRow key={`${m.item_id}-${m.position || 'one'}`} match={m} onPick={onPick} />)}
        </div>
        <button type="button" className="scan-sheet-cancel" onClick={onCancel}>ยกเลิก</button>
      </div>
    </div>
  );
}

// ค้นเองในสต๊อกรวมตอน QR เสีย (รหัส / รายละเอียด / ยี่ห้อ-รุ่นรถ) — รายการใหม่ที่ยังไม่มีในระบบ
// ให้ไปเพิ่มที่หน้า "สต๊อกรวม" ก่อน แล้วค่อยกลับมารับเข้า
function StockSearchSheet({ onPick, onCancel }) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setMatches([]); return undefined; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      client.get('/stock-receive/search', { params: { q: term } })
        .then((res) => { if (!cancelled) setMatches(res.data.matches || []); })
        .catch(() => { if (!cancelled) setMatches([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query]);

  const term = query.trim();
  return (
    <div className="scan-sheet-backdrop">
      <div className="scan-sheet scan-sheet--tall" role="dialog" aria-modal="true" aria-label="กรอกรายการเอง">
        <div className="scan-sheet-handle" />
        <h2 className="scan-sheet-title">กรอกรายการเอง</h2>
        <p className="scan-sheet-sub">ใช้ตอน QR เสียหรือสแกนไม่ติด — ค้นหาด้วยรหัส ชื่อรายการ หรือรุ่นรถ</p>
        <div className="scan-search">
          <span className="scan-search-icon"><IconSearch /></span>
          <input
            autoFocus
            type="text"
            className="scan-input scan-search-input"
            placeholder="พิมพ์รหัส ชื่อรายการ หรือรุ่นรถ..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="scan-match-list">
          {term.length < 2 && <p className="scan-sheet-empty">พิมพ์อย่างน้อย 2 ตัวอักษร</p>}
          {term.length >= 2 && matches.length === 0 && !searching && (
            <p className="scan-sheet-empty">
              ไม่พบรายการ "{query}" — ถ้าเป็นของใหม่ ให้เพิ่มที่หน้า "สต๊อกรวม" ก่อน
            </p>
          )}
          {matches.map((m) => <MatchRow key={`${m.item_id}-${m.position || 'one'}`} match={m} onPick={onPick} />)}
        </div>
        <button type="button" className="scan-sheet-cancel" onClick={onCancel}>ยกเลิก</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
//  MAIN PAGE
// ─────────────────────────────────────────
export default function TechnicianScanPage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isOffice = hasRole(user, 'office');
  const [step, setStep]           = useState(STEP.MODE);
  const [mode, setMode]           = useState(null);           // 'IN' | 'OUT'
  const [invoice, setInvoice]     = useState('');
  const [billDate, setBillDate]   = useState(todayStr());     // วันของบิล (คีย์ย้อนหลังได้)
  const [invoiceErr, setInvoiceErr] = useState('');
  const [supplier, setSupplier] = useState('');            // the shop the parts came from (one bill = one shop)
  const [supplierErr, setSupplierErr] = useState('');
  const [supplierOther, setSupplierOther] = useState(false); // true = the shop is not in the list, name typed by hand
  const [suppliers, setSuppliers] = useState([]);
  useEffect(() => {
    client.get('/suppliers').then((res) => setSuppliers(res.data.data || [])).catch(() => {});
  }, []);
  const [session, setSession]     = useState(null);           // { id, invoice_no }
  const [starting, setStarting]   = useState(false);

  const [scanning, setScanning]   = useState(false);          // กล้องเปิด/ปิด
  const [manualOpen, setManualOpen] = useState(false);        // แผงกรอกเอง (QR เสีย)
  const [scannedItem, setScannedItem] = useState(null);       // item ที่รอยืนยัน
  const [scannedType, setScannedType] = useState(null);       // 'rack' | 'wing-arm' | 'stock_item'
  const [pickMatches, setPickMatches] = useState(null);       // สแกนเจอหลายรายการ (โหมดรับเข้า) รอเลือก
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);     // รายการรอยืนยันที่กำลังแก้จำนวน/ลบ
  const [savingQty, setSavingQty] = useState(false);
  const [committing, setCommitting] = useState(false);        // กำลังกดเสร็จสิ้น/ยืนยันบวกสต๊อก

  const [orders, setOrders]       = useState([]);             // รายการในบิลนี้
  const [toast, setToast]         = useState(null);

  // ── มาจากหน้าบิลรับเข้า: "สแกนของเข้าบิลนี้" — เปิดบิลเดิมต่อได้เลย ไม่ต้องเปิดบิลใหม่
  // ใช้ตอนต้นทางส่งของมาไม่ครบ/บิลมาทีหลัง แล้วต้องแอดของเข้าบิลเดิมภายหลัง
  // โหลดของที่เคยสแกนเข้าบิลไว้แล้วมาแสดงด้วย จะได้เห็นบิลทั้งใบและกดลบรายการเก่าได้
  useEffect(() => {
    const resume = location.state?.resumeSession;
    if (!resume) return;
    navigate(location.pathname, { replace: true, state: {} }); // กันเปิดซ้ำตอนกด back
    setMode('IN');
    setSession(resume);
    setStep(STEP.SCAN);
    client.get(`/transactions/receipt-sessions/${resume.id}`)
      .then((res) => {
        const existing = (res.data.items || []).map((it) => {
          // source='pending_line' = สแกนไว้แล้วแต่ยังไม่กดเสร็จสิ้น (ยังไม่บวกสต๊อก) แก้/ลบได้
          const pending = it.source === 'pending_line';
          return {
            key: `${it.source || 'legacy'}-${it.id}`,
            sku: it.model_code,
            name: it.rack_name,
            qty: Number(it.qty),
            txId: pending ? null : it.id,
            lineId: pending ? it.id : null,
            pending,
            type: it.item_type === 'rack' ? 'rack' : it.item_type === 'stock_item' ? 'stock_item' : 'wing-arm',
            position: it.position || null,
          };
        });
        setOrders(existing.reverse()); // ในหน้านี้เรียงใหม่สุดอยู่บน
      })
      .catch(() => setOrders([]));
  }, [location.state, location.pathname, navigate]);

  // ── เลือก mode ──
  const selectMode = (m) => {
    setMode(m);
    setOrders([]);
    setSession(null);
    setScannedItem(null);
    setBillDate(todayStr());
    setStep(m === 'IN' ? STEP.INVOICE : STEP.SCAN);
  };

  // ── เปิด session บิล (IN) ──
  const startSession = async () => {
    if (!supplier.trim()) { setSupplierErr('กรุณาเลือกหรือพิมพ์ชื่อร้านอะไหล่'); return; }
    setSupplierErr('');
    if (!invoice.trim()) { setInvoiceErr('กรุณากรอกเลขบิล'); return; }
    setStarting(true); setInvoiceErr('');
    try {
      const res = await client.post('/transactions/receipt-session', {
        invoice_no: invoice.trim(),
        supplier_name: supplier.trim(),
        bill_date: billDate || undefined,
      });
      setSession(res.data);
      setOrders([]);
      setStep(STEP.SCAN);
    } catch (err) {
      setInvoiceErr(err?.response?.data?.error || 'เปิดบิลไม่สำเร็จ');
    } finally { setStarting(false); }
  };

  // ── เลือกรายการจากแผง "กรอกเอง" (QR เสีย) — ไหลต่อเข้าหน้ายืนยันจำนวนเหมือนสแกนปกติ ──
  // เลือกจากผลค้นหา/ผลสแกนของสต๊อกรวม (โหมดรับเข้า) → ไปหน้ายืนยันจำนวนเหมือนปกติ
  const handleStockPick = (match) => {
    setManualOpen(false);
    setPickMatches(null);
    setScannedItem(matchToItem(match));
    setScannedType('stock_item');
  };

  // ── ลบรายการที่ทำผิด ──
  // รายการรอยืนยัน (ยังไม่บวกสต๊อก) ลบได้เลยไม่มีอะไรต้องคืน ส่วนรายการที่บวกสต๊อกไปแล้วหรือของระบบเดิม
  // backend คืนสต็อกให้เองในทรานแซกชันเดียว (ติดลบไม่ได้)
  const handleDeleteOrder = async (order) => {
    const ref = order.pending ? order.lineId : order.txId;
    if (!ref) {
      setToast({ ok: false, title: 'ลบไม่ได้', body: 'ไม่พบเลขรายการอ้างอิง' });
      return;
    }
    setDeletingId(order.key);
    try {
      if (order.pending) await client.delete(`/stock-receive/lines/${ref}`);
      else if (order.type !== 'stock_item') await client.delete(`/transactions/${ref}`); // บิลเก่าของระบบเดิม
      else await client.delete(mode === 'OUT' ? `/stock-deductions/movements/${ref}` : `/stock-receive/movements/${ref}`);
      setOrders((prev) => prev.filter((o) => o.key !== order.key));
      setToast({
        ok: true,
        title: 'ลบรายการแล้ว',
        body: order.pending ? `${order.name} — ยังไม่เคยบวกสต๊อก` : `${order.name} — คืนสต็อกเรียบร้อย`,
      });
    } catch (err) {
      setToast({ ok: false, title: 'ลบไม่สำเร็จ', body: err?.response?.data?.error || '' });
    } finally {
      setDeletingId(null);
    }
  };

  // แก้จำนวนของรายการรอยืนยัน (พนักงานกรอกผิด)
  const handleSaveQty = async (qty, cost) => {
    if (!editingOrder?.lineId) return;
    setSavingQty(true);
    try {
      const unitCost = cost === '' || cost === undefined ? null : Number(cost);
      await client.patch(`/stock-receive/lines/${editingOrder.lineId}`, { qty, unit_cost: unitCost });
      setOrders((prev) => prev.map((o) => (o.key === editingOrder.key ? { ...o, qty, unitCost } : o)));
      setToast({ ok: true, title: 'แก้จำนวนแล้ว', body: `${editingOrder.name} → ${qty} ชิ้น` });
      setEditingOrder(null);
    } catch (err) {
      setToast({ ok: false, title: 'แก้จำนวนไม่สำเร็จ', body: err?.response?.data?.error || '' });
    } finally {
      setSavingQty(false);
    }
  };

  const handleDeleteFromSheet = async (order) => {
    setSavingQty(true);
    await handleDeleteOrder(order);
    setSavingQty(false);
    setEditingOrder(null);
  };

  // ออกจากหน้า/ปิดบิลทั้งที่ยังมีรายการรอยืนยัน — เตือนก่อน (รายการไม่หาย ค้างอยู่ในบิล เปิดต่อได้
  // จากหน้าบิลรับเข้า แต่สต๊อกยังไม่บวก)
  const confirmLeave = (action) => {
    const pendingCount = orders.filter((o) => o.pending).length;
    if (mode === 'IN' && pendingCount > 0 && !window.confirm(
      `ยังมี ${pendingCount} รายการที่ยังไม่บวกสต๊อก\nถ้าออกตอนนี้ รายการจะค้างอยู่ในบิล (เปิดสแกนต่อได้จากหน้า "บิลรับเข้า") แต่สต๊อกจะยังไม่เพิ่ม\n\nออกจากหน้านี้เลยใช่ไหม?`
    )) return;
    action();
  };

  // เสร็จสิ้น: บวกสต๊อกจริงทุกรายการรอยืนยันของบิลในครั้งเดียว
  const handleCommit = async () => {
    const pending = orders.filter((o) => o.pending);
    if (!session || pending.length === 0 || committing) return;
    const totalQty = pending.reduce((sum, o) => sum + Number(o.qty || 0), 0);
    if (!window.confirm(`ยืนยันบวกสต๊อก ${pending.length} รายการ (+${totalQty} ชิ้น) เข้าสต๊อกรวม?`)) return;
    setCommitting(true);
    try {
      const res = await client.post(`/stock-receive/sessions/${session.id}/commit`);
      setToast({ ok: true, title: 'บวกสต๊อกเรียบร้อย', body: `${res.data.applied} รายการ · +${res.data.total_qty} ชิ้น เข้าสต๊อกรวมแล้ว` });
      resetAll();
    } catch (err) {
      setToast({ ok: false, title: 'บันทึกรับเข้าไม่สำเร็จ', body: err?.response?.data?.error || '' });
    } finally {
      setCommitting(false);
    }
  };

  // ── สแกน QR → lookup ──
  const handleScan = useCallback(async (code) => {
    if (!code) return;
    setScanning(false);

    // ทั้งรับเข้าและจ่ายออกใช้สต๊อกรวมเท่านั้น (ไม่ย้อนไปตารางเก่า) — ป้าย QR เป็นรหัส OEM ล้วน ๆ หรือ
    // JSON ของป้ายปีกนกเดิม (backend แกะ sku ให้เอง)
    try {
      const res = await client.get('/stock-receive/lookup', { params: { code: String(code).trim() } });
      const found = res.data.matches || [];
      if (found.length === 1) {
        handleStockPick(found[0]);
      } else if (found.length > 1) {
        setPickMatches(found);
      } else {
        setToast({ ok: false, title: 'ไม่พบรหัสนี้ในสต๊อกรวม', body: 'ตรวจสอบว่า QR ถูกต้อง หรือเพิ่มรายการที่หน้าสต๊อกรวมก่อน' });
        setScanning(true);
      }
    } catch (err) {
      setToast({ ok: false, title: 'ค้นหารหัสไม่สำเร็จ', body: err?.response?.data?.error || '' });
      setScanning(true);
    }
  }, [mode]);

  // ── ยืนยันจำนวน ──
  const handleConfirm = async (qty, unitCost) => {
    if (!scannedItem) return;
    setConfirmLoading(true);
    try {
      if (mode === 'IN') {
        // รับเข้าสต๊อกรวม: เก็บเป็น "รายการรอยืนยัน" ของบิลก่อน (ยังไม่บวกสต๊อก) แก้จำนวน/ลบได้
        // — สต๊อกบวกจริงตอนกดเสร็จสิ้น ชิ้น/ตำแหน่งเดิมที่สแกนซ้ำในบิลเดียวกันจะรวมจำนวนในแถวเดิม
        const res = await client.post('/stock-receive/lines', {
          item_id: scannedItem.item_id,
          position: scannedItem.position || undefined,
          qty,
          unit_cost: unitCost === '' || unitCost === undefined ? undefined : unitCost,
          receipt_session_id: session ? session.id : undefined,
        });
        const line = res.data.line;
        const pendingOrder = {
          key: `line-${line.id}`,
          sku: line.code,
          name: `${line.category_name} · ${line.description || line.code}${line.position_label ? ` (${line.position_label})` : ''}`,
          qty: line.qty,
          txId: null,
          lineId: line.id,
          unitCost: line.unit_cost,
          pending: true,
          type: 'stock_item',
          position: line.position,
        };
        setOrders((prev) => [pendingOrder, ...prev.filter((o) => o.key !== pendingOrder.key)]);
        setToast({
          ok: true,
          title: `เพิ่มเข้ารายการแล้ว — ${pendingOrder.name.slice(0, 22)}`,
          body: res.data.merged
            ? `รวมเป็น ${line.qty} ชิ้น · ยังไม่บวกสต๊อก (กด “เสร็จสิ้น” เพื่อบวก)`
            : `จำนวน ${line.qty} ชิ้น · ยังไม่บวกสต๊อก (กด “เสร็จสิ้น” เพื่อบวก)`,
        });
      } else {
        // จ่ายออก: ตัดสต๊อกรวมทันที (ติดลบ/เกินยอดไม่ได้) ยกเลิกได้จากหน้าสรุป
        const res = await client.post('/stock-deductions', {
          item_id: scannedItem.item_id,
          lines: [{ position: scannedItem.position || undefined, qty }],
        });
        const label = scannedItem.name;
        const movementId = res.data.movement_ids?.[0] ?? null;
        setOrders((prev) => [{
          key: `deduct-${movementId ?? Date.now()}`,
          sku: scannedItem.model_code,
          name: label,
          qty,
          txId: movementId,
          type: 'stock_item',
          position: scannedItem.position || null,
        }, ...prev]);
        const remaining = res.data.items?.[0]?.qty_after;
        setToast({
          ok: true,
          title: `จ่ายออกสำเร็จ — ${label.slice(0, 22)}`,
          body: `จำนวน ${qty} ชิ้น · คงเหลือ ${remaining} ชิ้น`,
        });
      }
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
    setBillDate(todayStr());
    setScannedItem(null); setScannedType(null); setScanning(false);
    setManualOpen(false); setPickMatches(null);
  };

  const isIN = mode === 'IN';
  const totalQty = orders.reduce((s, o) => s + Number(o.qty || 0), 0);
  const sign = isIN ? '+' : '−';
  // รายการที่สแกนไว้แล้วแต่ยังไม่บวกสต๊อก (โหมดรับเข้า — บวกจริงตอนกดเสร็จสิ้น/ยืนยัน)
  const pendingOrders = orders.filter((o) => o.pending);
  const pendingQty = pendingOrders.reduce((sum, o) => sum + Number(o.qty || 0), 0);

  // ─────────────────────────────
  //  RENDER — จัดวางด้วยคลาส scan-* (สไตล์อยู่ท้าย styles/app.css) ใช้ได้ทั้งมือถือและจอคอม
  // ─────────────────────────────
  return (
    <div className={`scan-page ${step === STEP.SCAN || step === STEP.DONE ? (isIN ? 'is-in' : 'is-out') : ''}`}>

      {/* ════════════ STEP 1 — เลือก IN / OUT ════════════ */}
      {step === STEP.MODE && (
        <div className="scan-shell scan-shell--narrow">
          <header className="scan-head">
            <span className="scan-head-icon"><IconQR /></span>
            <div>
              <h1 className="scan-title">สแกน QR Code</h1>
              <p className="scan-subtitle">เลือกประเภทรายการก่อนเริ่ม</p>
            </div>
          </header>

          <div className="scan-mode-grid">
            {isOffice && (
              <button type="button" className="scan-mode-card scan-mode-card--in" onClick={() => selectMode('IN')}>
                <span className="scan-mode-icon"><IconArrowDown /></span>
                <span className="scan-mode-text">
                  <strong>รับเข้าสต็อก</strong>
                  <small>นำสินค้าเข้าคลัง · ต้องใส่เลขบิล</small>
                </span>
                <span className="scan-mode-chevron" aria-hidden="true">›</span>
              </button>
            )}
            <button type="button" className="scan-mode-card scan-mode-card--out" onClick={() => selectMode('OUT')}>
              <span className="scan-mode-icon"><IconArrowUp /></span>
              <span className="scan-mode-text">
                <strong>จ่ายออกจากสต็อก</strong>
                <small>นำสินค้าออกใช้งาน</small>
              </span>
              <span className="scan-mode-chevron" aria-hidden="true">›</span>
            </button>
          </div>
        </div>
      )}

      {/* ════════════ STEP 2 — กรอกเลขบิล (IN) ════════════ */}
      {step === STEP.INVOICE && (
        <div className="scan-shell scan-shell--narrow">
          <header className="scan-head">
            <button type="button" className="scan-icon-btn" onClick={resetAll} aria-label="ย้อนกลับ"><IconArrowLeft /></button>
            <div>
              <h1 className="scan-title">เปิดบิลรับสินค้า</h1>
              <p className="scan-subtitle">กรอกเลขบิลก่อนเริ่มสแกน</p>
            </div>
          </header>

          <section className="scan-card">
            <div className="scan-card-head">
              <span className="scan-card-head-icon"><IconReceipt /></span>
              <div>
                <strong>เลขที่บิล / Invoice No.</strong>
                <small>กรอกเลขจากซัพพลายเออร์</small>
              </div>
            </div>
            <div className="scan-card-body">
              <label className="scan-label" htmlFor="scan-invoice">เลขที่บิล</label>
              <input
                id="scan-invoice"
                autoFocus
                type="text"
                className={`scan-input scan-input--mono${invoiceErr ? ' has-error' : ''}`}
                placeholder="เช่น INV-2026-0001"
                value={invoice}
                onChange={(e) => setInvoice(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && startSession()}
              />
              {invoiceErr && <p className="scan-error">{invoiceErr}</p>}

              <label className="scan-label" htmlFor="scan-supplier">ร้านอะไหล่ที่ซื้อ</label>
              <select
                id="scan-supplier"
                className={`scan-input${supplierErr ? ' has-error' : ''}`}
                value={supplierOther ? '__other__' : supplier}
                onChange={(e) => {
                  if (e.target.value === '__other__') { setSupplierOther(true); setSupplier(''); }
                  else { setSupplierOther(false); setSupplier(e.target.value); }
                  setSupplierErr('');
                }}
              >
                <option value="">-- เลือกร้านอะไหล่ --</option>
                {suppliers.map((sp) => <option key={sp.id} value={sp.name}>{sp.name}</option>)}
                <option value="__other__">+ ร้านอื่น (พิมพ์ชื่อเอง)</option>
              </select>
              {supplierOther && (
                <input
                  type="text"
                  className={`scan-input${supplierErr ? ' has-error' : ''}`}
                  placeholder="พิมพ์ชื่อร้านอะไหล่"
                  value={supplier}
                  onChange={(e) => { setSupplier(e.target.value); setSupplierErr(''); }}
                  autoComplete="off"
                  autoFocus
                />
              )}
              {supplierErr && <p className="scan-error">{supplierErr}</p>}

              <label className="scan-label" htmlFor="scan-bill-date">วันที่ของบิล</label>
              <input
                id="scan-bill-date"
                type="date"
                className="scan-input"
                value={billDate}
                max={todayStr()}
                onChange={(e) => setBillDate(e.target.value)}
              />
              {billDate !== todayStr() && (
                <p className="scan-backdate">📅 กำลังคีย์บิลย้อนหลัง — บิลนี้จะไปอยู่ในวันที่ที่เลือก</p>
              )}

              <p className="scan-hint">
                สินค้าทุกชิ้นที่สแกนในรอบนี้จะถูกผูกกับบิลนี้ · ลืมคีย์ย้อนหลังได้โดยเลือกวันที่
              </p>
              <button
                type="button"
                className="scan-btn scan-btn--primary scan-btn--block scan-btn--lg"
                onClick={startSession}
                disabled={starting}
              >
                {starting ? 'กำลังเปิดบิล...' : 'เริ่มสแกน'}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* ════════════ STEP 3 — สแกน + รายการ ════════════ */}
      {step === STEP.SCAN && (
        <div className="scan-shell scan-shell--wide scan-shell--has-dock">

          <header className="scan-topbar">
            <button type="button" className="scan-icon-btn" onClick={() => confirmLeave(resetAll)} aria-label="ออกจากหน้านี้"><IconX /></button>
            <div className="scan-topbar-text">
              <strong>{isIN ? 'รับเข้าสต็อก' : 'จ่ายออกจากสต็อก'}</strong>
              <small>{isIN ? 'สแกน QR เพื่อรับของเข้าบิลนี้' : 'สแกน QR เพื่อจ่ายของออก'}</small>
            </div>
            <span className={`scan-pill ${isIN ? 'scan-pill--in' : 'scan-pill--out'}`}>{isIN ? 'IN' : 'OUT'}</span>
          </header>

          <section className="scan-bill">
            <div className="scan-bill-main">
              <span className="scan-bill-label">{isIN && session ? 'บิลปัจจุบัน' : 'รอบนี้'}</span>
              <span className="scan-bill-no">{isIN && session ? session.invoice_no : 'จ่ายออกจากคลัง'}</span>
            </div>
            <div className="scan-stats">
              <div><b>{orders.length}</b><span>รายการ</span></div>
              <div><b>{sign}{totalQty}</b><span>ชิ้น</span></div>
            </div>
            {isIN && pendingOrders.length > 0 && (
              <p className="scan-pending-note">
                ⏳ มี {pendingOrders.length} รายการ (+{pendingQty} ชิ้น) ที่ยังไม่บวกสต๊อก — กด “เสร็จสิ้น” เพื่อตรวจและยืนยัน
              </p>
            )}
            {isIN && session && (
              <button
                type="button"
                className="scan-btn scan-btn--ghost scan-btn--sm"
                onClick={() => confirmLeave(() => { setStep(STEP.INVOICE); setSession(null); setOrders([]); setInvoice(''); })}
              >
                ปิดบิล / เปิดใหม่
              </button>
            )}
          </section>

          <section className="scan-list" aria-label="รายการที่สแกน">
            {orders.length === 0 ? (
              <div className="scan-empty">
                <span className="scan-empty-icon"><IconQR /></span>
                <p>ยังไม่มีรายการ</p>
                <small>กดปุ่ม "สแกน QR" ด้านล่างเพื่อเริ่ม</small>
              </div>
            ) : (
              orders.map((o, i) => (
                <OrderRow
                  key={o.key}
                  item={o}
                  index={orders.length - i}
                  mode={mode}
                  onEdit={o.pending ? setEditingOrder : undefined}
                />
              ))
            )}
          </section>

          {/* แถบปุ่มล่าง — กรอกเอง / สแกน / เสร็จสิ้น (วางเหนือเมนูล่างบนมือถือ ไม่ถูกบัง) */}
          <div className="scan-dock">
            <div className="scan-dock-inner">
              <button type="button" className="scan-dock-btn scan-dock-btn--side" onClick={() => setManualOpen(true)}>
                <IconSearch />
                <span>กรอกเอง</span>
              </button>
              <button type="button" className="scan-dock-btn scan-dock-btn--scan" onClick={() => setScanning(true)}>
                <IconQR />
                <span>สแกน QR</span>
                {orders.length > 0 && <em className="scan-dock-badge">{orders.length}</em>}
              </button>
              <button
                type="button"
                className="scan-dock-btn scan-dock-btn--side scan-dock-btn--finish"
                onClick={() => setStep(STEP.DONE)}
                disabled={orders.length === 0}
              >
                <IconCheck />
                <span>เสร็จสิ้น</span>
              </button>
            </div>
          </div>

          {scanning && (
            <ScanOverlay
              active={scanning}
              mode={mode}
              onResult={handleScan}
              onClose={() => setScanning(false)}
            />
          )}

          {manualOpen && (
            <StockSearchSheet onPick={handleStockPick} onCancel={() => setManualOpen(false)} />
          )}

          {pickMatches && (
            <MatchPickSheet
              matches={pickMatches}
              onPick={handleStockPick}
              onCancel={() => { setPickMatches(null); setScanning(true); }}
            />
          )}

          {scannedItem && !scanning && (
            <ConfirmSheet
              item={scannedItem}
              mode={mode}
              onConfirm={handleConfirm}
              onCancel={() => { setScannedItem(null); setScannedType(null); setScanning(true); }}
              loading={confirmLoading}
              deferred={isIN && scannedType === 'stock_item'}
            />
          )}
        </div>
      )}

      {/* ════════════ STEP 4 — สรุปของที่สแกน ════════════ */}
      {step === STEP.DONE && (
        <div className="scan-shell scan-shell--wide">
          <header className="scan-head">
            <button type="button" className="scan-icon-btn" onClick={() => setStep(STEP.SCAN)} aria-label="กลับไปสแกน"><IconArrowLeft /></button>
            <div>
              <h1 className="scan-title">สรุปรายการ</h1>
              <p className="scan-subtitle">
                {isIN ? 'รับเข้าสต็อก' : 'จ่ายออกจากสต็อก'}
                {isIN && session ? ` · บิล ${session.invoice_no}` : ''}
              </p>
            </div>
          </header>

          <section className="scan-summary">
            <div className="scan-summary-tile">
              <span>ทำรายการทั้งหมด</span>
              <b>{orders.length}<small> รายการ</small></b>
            </div>
            <div className="scan-summary-tile scan-summary-tile--accent">
              <span>รวมจำนวน</span>
              <b>{sign}{totalQty}<small> ชิ้น</small></b>
            </div>
          </section>

          <p className="scan-note">
            {isIN && pendingOrders.length > 0
              ? 'ตรวจทานก่อนยืนยัน — แก้จำนวนหรือลบรายการที่กรอกผิดได้ สต๊อกจะบวกเมื่อกด “ยืนยันบวกสต๊อก”'
              : 'ตรวจทานก่อนปิดงาน — สแกนผิดกดถังขยะแล้วสแกนใหม่ได้'}
          </p>

          <section className="scan-list" aria-label="สรุปรายการ">
            {orders.length === 0 ? (
              <div className="scan-empty">
                <span className="scan-empty-icon"><IconPackage /></span>
                <p>ไม่มีรายการเหลือแล้ว</p>
              </div>
            ) : (
              orders.map((o, i) => (
                <OrderRow
                  key={o.key}
                  item={o}
                  index={orders.length - i}
                  mode={mode}
                  onEdit={o.pending ? setEditingOrder : undefined}
                  onDelete={handleDeleteOrder}
                  busy={deletingId === o.key}
                />
              ))
            )}
          </section>

          <div className="scan-actions">
            <button type="button" className="scan-btn scan-btn--primary scan-btn--lg" onClick={() => setStep(STEP.SCAN)}>
              <IconQR /> สแกนเพิ่ม
            </button>
            {isIN && pendingOrders.length > 0 ? (
              <button type="button" className="scan-btn scan-btn--in scan-btn--lg" onClick={handleCommit} disabled={committing}>
                <IconCheck /> {committing ? 'กำลังบันทึก...' : `ยืนยันบวกสต๊อก (${pendingOrders.length})`}
              </button>
            ) : (
              <button type="button" className="scan-btn scan-btn--dark scan-btn--lg" onClick={resetAll}>
                ปิดงาน
              </button>
            )}
          </div>
        </div>
      )}

      {editingOrder && (
        <EditQtySheet
          order={editingOrder}
          onSave={handleSaveQty}
          onDelete={handleDeleteFromSheet}
          onCancel={() => setEditingOrder(null)}
          loading={savingQty}
        />
      )}

      <Toast msg={toast} onDone={clearToast} />
    </div>
  );
}
