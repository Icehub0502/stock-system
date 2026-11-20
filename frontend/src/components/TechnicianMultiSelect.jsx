import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import client from '../api/client';

// Phones get the list as a sheet from the bottom of the screen (big rows, a "เสร็จ" button);
// wider screens get it floating under (or above) the button.
const MOBILE_QUERY = '(max-width: 640px)';
const PANEL_GAP = 4;
const VIEWPORT_MARGIN = 8;
const PANEL_MIN_WIDTH = 180;
const PANEL_MAX_HEIGHT = 320;

// รายชื่อช่างที่เลือกแล้วเก็บเป็น string เดียวคั่นด้วย ", " (ไม่แตะ schema/backend
// เลย — คอลัมน์ technician_name เดิมเป็น VARCHAR string อยู่แล้ว) แปลงกลับเป็น
// array ตอนแสดงผล/เช็คติ๊กเท่านั้น
function parseNames(value) {
  return (value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// One request for the whole page: every row of the summary has its own dropdown, and each used to fetch the same list
// (11 bills = 11 requests). Kept for a minute, then fetched again so a technician added elsewhere shows up.
const LIST_TTL_MS = 60 * 1000;
let listRequest = null;
let listFetchedAt = 0;
function loadTechnicians() {
  if (!listRequest || Date.now() - listFetchedAt > LIST_TTL_MS) {
    listFetchedAt = Date.now();
    listRequest = client.get('/technicians')
      .then((res) => res.data.data || [])
      .catch((err) => {
        listRequest = null; // a failed load is tried again by the next dropdown
        throw err;
      });
  }
  return listRequest;
}
// a technician added from one dropdown is seen by the next one opened
function rememberTechnician(technician) {
  if (!listRequest) return;
  listRequest = listRequest.then((list) => (list.some((t) => t.id === technician.id)
    ? list
    : [...list, technician].sort((a, b) => a.name.localeCompare(b.name, 'th'))));
}

const isMobileScreen = () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches;

// Whether the button can still be seen: inside the window and inside every scrolling box around it (the bill table,
// the modal). A list left floating after its button scrolled away would look like it belongs to another row.
// Half hidden or more counts as gone.
function triggerVisible(trigger) {
  const rect = trigger.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  const midX = rect.left + rect.width / 2;
  if (midY <= 0 || midY >= window.innerHeight) return false;
  for (let el = trigger.parentElement; el && el !== document.body; el = el.parentElement) {
    const style = window.getComputedStyle(el);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const box = el.getBoundingClientRect();
    if (midY <= box.top || midY >= box.bottom || midX <= box.left || midX >= box.right) return false;
  }
  return true;
}

// Where the floating list goes: below the button when it fits, otherwise on the side with more room, never past
// the screen edges. The list is rendered into <body> (a portal) with position: fixed, so a table or modal that
// scrolls or clips its content (overflow: auto) cannot cut it off.
function panelPosition(trigger) {
  const rect = trigger.getBoundingClientRect();
  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;
  const below = viewportH - rect.bottom - PANEL_GAP - VIEWPORT_MARGIN;
  const above = rect.top - PANEL_GAP - VIEWPORT_MARGIN;
  const openUp = below < Math.min(PANEL_MAX_HEIGHT, 200) && above > below;
  const maxHeight = Math.max(120, Math.min(PANEL_MAX_HEIGHT, openUp ? above : below));
  const width = Math.max(rect.width, PANEL_MIN_WIDTH);
  const left = Math.min(Math.max(VIEWPORT_MARGIN, rect.left), viewportW - width - VIEWPORT_MARGIN);
  return openUp
    ? { left, width, maxHeight, bottom: viewportH - rect.top + PANEL_GAP }
    : { left, width, maxHeight, top: rect.bottom + PANEL_GAP };
}

/**
 * Dropdown แบบติ๊กเลือกได้หลายคน ใช้แทนช่อง "ช่างซ่อม" แบบพิมพ์เองเดิม — รองรับรถ
 * 1 คันที่มีช่างช่วยกันทำมากกว่า 1 คน ใช้รายชื่อจากตาราง technicians เดียวกับที่
 * หน้ารายการงานวันนี้ (JobBoardPage) ใช้อยู่แล้ว เพิ่มชื่อใหม่ได้จากในนี้เลย
 */
export default function TechnicianMultiSelect({ value, onChange, disabled }) {
  const [technicians, setTechnicians] = useState([]);
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(isMobileScreen);
  const [position, setPosition] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    let alive = true;
    loadTechnicians()
      .then((list) => { if (alive) setTechnicians(list); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const close = useCallback(() => setOpen(false), []);

  // Floating list: placed before paint, moved along when the page or the table scrolls or the window resizes,
  // and closed once its button has scrolled out of sight
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    if (!triggerVisible(trigger)) {
      setOpen(false);
      return;
    }
    setPosition(panelPosition(trigger));
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const nowMobile = isMobileScreen();
    setMobile(nowMobile);
    if (nowMobile) return undefined;
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onClickOutside = (e) => {
      const inside = (rootRef.current && rootRef.current.contains(e.target))
        || (panelRef.current && panelRef.current.contains(e.target));
      if (!inside) close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const selectedNames = parseNames(value);

  const toggleName = (name) => {
    const next = selectedNames.includes(name)
      ? selectedNames.filter((n) => n !== name)
      : [...selectedNames, name];
    onChange(next.join(', '));
  };

  const addNewTechnician = async () => {
    const name = window.prompt('ชื่อช่างใหม่:');
    if (!name || !name.trim()) return;
    try {
      const res = await client.post('/technicians', { name: name.trim() });
      rememberTechnician(res.data.data);
      setTechnicians((prev) => {
        if (prev.some((t) => t.id === res.data.data.id)) return prev;
        return [...prev, res.data.data].sort((a, b) => a.name.localeCompare(b.name, 'th'));
      });
      onChange([...selectedNames, res.data.data.name].join(', '));
    } catch (err) {
      alert('เพิ่มชื่อช่างไม่สำเร็จ: ' + (err.response?.data?.error || err.message));
    }
  };

  const options = (
    <>
      <div className="tech-multiselect-options">
        {technicians.map((t) => (
          <label key={t.id} className="tech-multiselect-option">
            <input
              type="checkbox"
              checked={selectedNames.includes(t.name)}
              onChange={() => toggleName(t.name)}
            />
            {t.name}
          </label>
        ))}
      </div>
      <button
        type="button"
        className="tech-multiselect-add"
        onClick={addNewTechnician}
      >
        + เพิ่มชื่อช่างใหม่...
      </button>
    </>
  );

  let panel = null;
  if (open && mobile) {
    panel = (
      <div className="tech-multiselect-sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
        <div className="tech-multiselect-sheet" ref={panelRef} role="dialog" aria-label="เลือกช่าง">
          <div className="tech-multiselect-sheet-head">
            <span>เลือกช่าง{selectedNames.length > 0 ? ` (${selectedNames.length})` : ''}</span>
            <button type="button" className="tech-multiselect-done" onClick={close}>เสร็จ</button>
          </div>
          {options}
        </div>
      </div>
    );
  } else if (open && position) {
    panel = (
      <div
        className="tech-multiselect-panel"
        ref={panelRef}
        style={{
          left: position.left,
          width: position.width,
          maxHeight: position.maxHeight,
          ...(position.top !== undefined ? { top: position.top } : { bottom: position.bottom }),
        }}
      >
        {options}
      </div>
    );
  }

  return (
    <div className="tech-multiselect" ref={rootRef}>
      <button
        type="button"
        className="tech-multiselect-trigger"
        ref={triggerRef}
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {selectedNames.length > 0 ? selectedNames.join(', ') : 'เลือกช่าง'}
      </button>
      {panel && createPortal(panel, document.body)}
    </div>
  );
}
