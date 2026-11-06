import React, { useCallback, useEffect, useRef, useState } from 'react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';

const SIDE_WORDS_RE = /(ข้าง)?(ซ้าย|ขวา)|\b(LH|RH|L|R)\b/gi;
const nameWithoutSide = (text) => String(text ?? '').replace(SIDE_WORDS_RE, ' ').replace(/[\s()\-/]+$/g, '').replace(/\s+/g, ' ').trim();

function ItemSummary({ item }) {
  return (
    <span className="sp-item">
      <b className="scan-code">{item.oem_code}</b>
      <small>{item.category_name} · {item.description || '-'} · คงเหลือ {Number(item.stock_qty).toLocaleString()}</small>
    </span>
  );
}

// Picks one side: type a code or a name, then choose from what is not split by position yet
function SidePicker({ label, value, excludeId, onPick }) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setMatches([]); return undefined; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      client.get('/stock-items', { params: { q: term } })
        .then((res) => {
          if (cancelled) return;
          setMatches((res.data || []).filter((it) => !it.has_sides && !it.has_axles && !it.has_levels && it.id !== excludeId).slice(0, 8));
        })
        .catch(() => { if (!cancelled) setMatches([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, excludeId]);

  if (value) {
    return (
      <div className="sp-side">
        <span className="sp-side-label">{label}</span>
        <ItemSummary item={value} />
        <button type="button" className="sp-change" onClick={() => { onPick(null); setQuery(''); }}>เปลี่ยน</button>
      </div>
    );
  }
  return (
    <div className="sp-side sp-side--search">
      <label className="sp-side-label" htmlFor={`sp-${label}`}>{label}</label>
      <input
        id={`sp-${label}`}
        type="text"
        className="search-input"
        placeholder="พิมพ์รหัสหรือชื่อรายการ"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query.trim().length >= 2 && !searching && matches.length === 0 && (
        <p className="sp-note">ไม่พบรายการที่ยังไม่แยกซ้าย/ขวา</p>
      )}
      {matches.map((it) => (
        <button type="button" className="sp-match" key={it.id} onClick={() => onPick(it)}><ItemSummary item={it} /></button>
      ))}
    </div>
  );
}

// not for roles that may only look at stock
export function StockPairButton({ onClick }) {
  const { user } = useAuth();
  if (['sales', 'accountant'].includes(user?.role)) return null;
  return <button type="button" onClick={onClick}>🔗 จับคู่ซ้าย/ขวา</button>;
}

// จับคู่ซ้าย/ขวา: stock entered as two separate items becomes one item split left/right. Suggestions come first; the
// rest are chosen by hand (any order, and the sides can be swapped). Quantities and history stay; it can be undone.
export default function StockPairModal({ onClose, onChanged }) {
  const manualRef = useRef(null);
  const [suggestions, setSuggestions] = useState(null);
  const [left, setLeft] = useState(null);
  const [right, setRight] = useState(null);
  const [description, setDescription] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadSuggestions = useCallback(async () => {
    try {
      const res = await client.get('/stock-items/pair-suggestions');
      setSuggestions(res.data.data);
    } catch (err) {
      setSuggestions([]);
      setError(err.response?.data?.error || 'โหลดรายการแนะนำไม่สำเร็จ');
    }
  }, []);

  useEffect(() => { loadSuggestions(); }, [loadSuggestions]);

  // the name is offered from the chosen items until someone types their own
  useEffect(() => {
    if (nameEdited) return;
    setDescription(nameWithoutSide(left?.description || right?.description));
  }, [left, right, nameEdited]);

  const reset = () => {
    setLeft(null);
    setRight(null);
    setDescription('');
    setNameEdited(false);
  };

  const pair = async (leftItem, rightItem, name) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await client.post('/stock-items/pairs', { left_id: leftItem.id, right_id: rightItem.id, description: name });
      setNotice(`จับคู่แล้ว: ซ้าย ${leftItem.oem_code} ${Number(leftItem.stock_qty)} ชิ้น · ขวา ${rightItem.oem_code} ${Number(rightItem.stock_qty)} ชิ้น`);
      reset();
      await loadSuggestions();
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.response?.data?.error || 'จับคู่ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const swap = () => {
    setLeft(right);
    setRight(left);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card medium" role="dialog" aria-modal="true" aria-label="จับคู่ซ้าย ขวา" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">จับคู่ซ้าย/ขวา</h3>
        <p className="sp-note">รวมรายการที่กรอกแยกกันเป็นรายการเดียว ยอดคงเหลือและประวัติของแต่ละข้างอยู่ครบ แยกกลับได้จากปุ่มแก้ไขของรายการนั้น</p>

        {notice && <p className="sp-ok" role="status">{notice}</p>}
        {error && <p className="error-text" role="alert">{error}</p>}

        <section className="sp-section" ref={manualRef}>
          <h4>เลือกเอง</h4>
          <SidePicker label="ข้างซ้าย" value={left} excludeId={right?.id} onPick={setLeft} />
          <SidePicker label="ข้างขวา" value={right} excludeId={left?.id} onPick={setRight} />
          {left && right && (
            <>
              <button type="button" className="sp-swap" onClick={swap}>สลับซ้าย/ขวา</button>
              {(/ขวา/.test(left.description || '') || /ซ้าย/.test(right.description || '')) && (
                <p className="sp-warn" role="alert">ชื่อรายการบอกข้างไม่ตรงกับช่องที่เลือก ตรวจดูว่าต้องสลับซ้าย/ขวาไหม</p>
              )}
              <label className="sp-side-label" htmlFor="sp-name">ชื่อรายการหลังจับคู่</label>
              <input
                id="sp-name"
                type="text"
                className="search-input sp-name"
                maxLength={500}
                value={description}
                onChange={(e) => { setDescription(e.target.value); setNameEdited(true); }}
              />
              <button type="button" className="btn-primary sp-confirm" disabled={busy} onClick={() => pair(left, right, description)}>
                {busy ? 'กำลังจับคู่...' : `จับคู่ · ซ้าย ${Number(left.stock_qty)} + ขวา ${Number(right.stock_qty)} = ${Number(left.stock_qty) + Number(right.stock_qty)} ชิ้น`}
              </button>
            </>
          )}
        </section>

        <section className="sp-section">
          <h4>แนะนำจากรหัสหรือชื่อ {suggestions ? `(${suggestions.length} คู่)` : ''}</h4>
          {!suggestions && <p className="sp-note">กำลังโหลด...</p>}
          {suggestions && suggestions.length === 0 && <p className="sp-note">ไม่พบคู่ที่น่าจะตรงกัน ใช้เลือกเองด้านบน</p>}
          {(suggestions || []).map((s) => (
            <div className="sp-suggestion" key={`${s.left.id}-${s.right.id}`}>
              <div className="sp-suggestion-items">
                <div><span className="sp-chip sp-chip--left">ซ้าย</span> <ItemSummary item={s.left} /></div>
                <div><span className="sp-chip sp-chip--right">ขวา</span> <ItemSummary item={s.right} /></div>
              </div>
              <div className="sp-suggestion-actions">
                <button type="button" className="btn-primary" onClick={() => pair(s.left, s.right, nameWithoutSide(s.left.description))} disabled={busy}>จับคู่</button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setLeft(s.left);
                    setRight(s.right);
                    setNameEdited(false);
                    manualRef.current?.scrollIntoView({ block: 'start' });
                  }}
                >
                  แก้ก่อนจับคู่
                </button>
              </div>
            </div>
          ))}
        </section>

        <div className="modal-actions"><button type="button" onClick={onClose}>ปิด</button></div>
      </div>
    </div>
  );
}
