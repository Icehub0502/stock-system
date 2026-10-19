import React, { useEffect, useMemo, useRef, useState } from 'react';
import { THAI_PROVINCES } from '../utils/thaiProvinces';

// เลือกจังหวัดจากรายการเท่านั้น (พิมพ์ผิดไม่ได้) — กดเปิดแล้วมีช่องค้นหาด้านบน พิมพ์บางส่วนก็กรองให้
// Enter = เลือกตัวแรกที่เจอ, Esc = ปิด, "ไม่ระบุจังหวัด" = ล้างค่า
export default function ProvinceSelect({ value, onChange, placeholder = 'เลือกจังหวัด', disabled = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const searchRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim();
    return q ? THAI_PROVINCES.filter((p) => p.includes(q)) : THAI_PROVINCES;
  }, [query]);

  useEffect(() => {
    if (!open) return undefined;
    searchRef.current?.focus();
    const handler = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  const choose = (province) => {
    onChange(province);
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'Enter') {
      // กัน Enter ไป submit ฟอร์มที่ครอบอยู่
      e.preventDefault();
      if (filtered.length > 0) choose(filtered[0]);
    }
  };

  return (
    <div className="province-select" ref={rootRef}>
      <button
        type="button"
        className={`province-select-trigger${value ? '' : ' is-empty'}`}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{value || placeholder}</span>
        <span className="province-select-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="province-select-panel">
          <input
            ref={searchRef}
            type="text"
            className="province-select-search"
            placeholder="🔍 พิมพ์ค้นหาจังหวัด"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <ul className="province-select-list" role="listbox">
            <li>
              <button type="button" className="province-select-option is-clear" onClick={() => choose('')}>
                ไม่ระบุจังหวัด
              </button>
            </li>
            {filtered.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  role="option"
                  aria-selected={p === value}
                  className={`province-select-option${p === value ? ' is-selected' : ''}`}
                  onClick={() => choose(p)}
                >
                  {p}
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li className="province-select-empty">ไม่พบจังหวัดที่ค้นหา</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
