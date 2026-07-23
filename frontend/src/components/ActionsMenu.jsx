import React, { useEffect, useRef, useState } from 'react';

// เมนู "⋮ เพิ่มเติม" แบบใช้ร่วมกันได้ — เก็บปุ่มที่ใช้ไม่บ่อยไว้ในนี้ กันแถวปุ่ม
// ในตารางแน่นเกินไป (เคยมีถึง 8 ปุ่มต่อแถวในหน้าใบเสนอราคา)
// items: [{ label, onClick, danger, disabled, hidden }]
export default function ActionsMenu({ items }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const visibleItems = items.filter((item) => !item.hidden);
  if (visibleItems.length === 0) return null;

  return (
    <div className="actions-menu" ref={rootRef}>
      <button
        type="button"
        className="btn-icon-small actions-menu-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        ⋮ เพิ่มเติม
      </button>
      {open && (
        <div className="actions-menu-dropdown">
          {visibleItems.map((item, idx) => (
            <button
              key={idx}
              type="button"
              className={`actions-menu-item${item.danger ? ' danger' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
