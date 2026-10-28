import React, { useMemo, useRef, useState } from 'react';

// Compare ignoring case, spaces and punctuation ("camry", "CAM-RY" and "Camry" are the same name)
export function normalizeName(value) {
  return String(value || '').toLowerCase().replace(/[\s\-_./()'’]+/g, '');
}

const MAX_SHOWN = 60;

/**
 * Search-as-you-type field for picking from a list while still allowing a value that is not in it.
 * The value is always the plain text in the box, so forms keep working with a string exactly as before.
 *
 * options: [{ value, label?, pending? }]   pending = typed in by staff, waiting for the administrator
 * - typing filters the list (contains match, case / spaces / punctuation ignored)
 * - choosing an entry fills the box; leaving the box with text that matches an entry in another spelling
 *   switches it to the listed spelling
 * - text that matches nothing is kept and offered as "ไม่พบ? กรอกเอง" — the caller decides what that means
 */
export default function ComboInput({
  value, onChange, options, placeholder, disabled, customLabel = 'ไม่พบ? กรอกเอง', emptyHint = 'ไม่พบในรายการ', allowCustom = true, ...rest
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const closeTimer = useRef(null);
  const wrapRef = useRef(null);
  const [dropUp, setDropUp] = useState(false);

  // open the list upwards when there is no room below (72px = the bottom bar on phones)
  const measure = () => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 72;
    setDropUp(below < 200 && rect.top > below);
  };

  const typed = normalizeName(value);
  const filtered = useMemo(() => {
    // every word typed must appear in the entry ("vios 07" finds "Vios ปี '02-07'")
    const words = String(value || '').toLowerCase().split(/\s+/).map(normalizeName).filter(Boolean);
    const list = words.length ? options.filter((o) => { const name = normalizeName(o.label || o.value); return words.every((w) => name.includes(w)); }) : options;
    return list.slice(0, MAX_SHOWN);
  }, [options, value]);
  const exact = typed ? options.find((o) => normalizeName(o.value) === typed) : null;
  const showCustom = allowCustom && Boolean(value.trim()) && !exact;

  const choose = (option) => {
    onChange(option.value);
    setOpen(false);
  };

  const handleBlur = () => {
    // delay so a click on an entry lands before the list disappears
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      if (exact && exact.value !== value) onChange(exact.value);
    }, 120);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open && filtered[active]) {
      e.preventDefault();
      choose(filtered[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="combo" ref={wrapRef}>
      <input
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => { clearTimeout(closeTimer.current); measure(); setOpen(true); }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        {...rest}
      />
      {open && !disabled && (filtered.length > 0 || showCustom) && (
        <ul className={`combo-list ${dropUp ? 'combo-list-up' : ''}`} role="listbox">
          {filtered.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={i === active}
              className={`combo-item ${i === active ? 'active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); choose(o); }}
              onMouseEnter={() => setActive(i)}
            >
              <span>{o.label || o.value}</span>
              {o.pending && <span className="combo-badge">รอตรวจ</span>}
            </li>
          ))}
          {filtered.length === 0 && <li className="combo-empty">{emptyHint}</li>}
          {showCustom && (
            <li
              className="combo-item combo-custom"
              onMouseDown={(e) => { e.preventDefault(); setOpen(false); }}
            >
              {customLabel}: <strong>{value.trim()}</strong>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
