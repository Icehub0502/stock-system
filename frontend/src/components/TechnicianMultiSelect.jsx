import React, { useEffect, useRef, useState } from 'react';
import client from '../api/client';

const NEW_TECHNICIAN_OPTION = '__new__';

// รายชื่อช่างที่เลือกแล้วเก็บเป็น string เดียวคั่นด้วย ", " (ไม่แตะ schema/backend
// เลย — คอลัมน์ technician_name เดิมเป็น VARCHAR string อยู่แล้ว) แปลงกลับเป็น
// array ตอนแสดงผล/เช็คติ๊กเท่านั้น
function parseNames(value) {
  return (value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Dropdown แบบติ๊กเลือกได้หลายคน ใช้แทนช่อง "ช่างซ่อม" แบบพิมพ์เองเดิม — รองรับรถ
 * 1 คันที่มีช่างช่วยกันทำมากกว่า 1 คน ใช้รายชื่อจากตาราง technicians เดียวกับที่
 * หน้ารายการงานวันนี้ (JobBoardPage) ใช้อยู่แล้ว เพิ่มชื่อใหม่ได้จากในนี้เลย
 */
export default function TechnicianMultiSelect({ value, onChange, disabled }) {
  const [technicians, setTechnicians] = useState([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    client.get('/technicians')
      .then((res) => setTechnicians(res.data.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

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
      setTechnicians((prev) => {
        if (prev.some((t) => t.id === res.data.data.id)) return prev;
        return [...prev, res.data.data].sort((a, b) => a.name.localeCompare(b.name, 'th'));
      });
      onChange([...selectedNames, res.data.data.name].join(', '));
    } catch (err) {
      alert('เพิ่มชื่อช่างไม่สำเร็จ: ' + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div className="tech-multiselect" ref={rootRef}>
      <button
        type="button"
        className="tech-multiselect-trigger"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {selectedNames.length > 0 ? selectedNames.join(', ') : 'เลือกช่าง'}
      </button>
      {open && (
        <div className="tech-multiselect-panel">
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
          <button
            type="button"
            className="tech-multiselect-add"
            onClick={addNewTechnician}
          >
            + เพิ่มชื่อช่างใหม่...
          </button>
        </div>
      )}
    </div>
  );
}
