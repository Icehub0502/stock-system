import React from 'react';
import { RACK_KEYWORDS, BALL_JOINT_KEYWORDS, ALL_WARRANTY_KEYWORDS, slotWarranty } from '../utils/warrantyKeywords';

// the dropdown value for a warranty the items carry that is not in the catalog
const FROM_ITEMS = '__from_items__';

// การ์ด "การรับประกัน" ใช้ร่วมกันทั้งใบเสนอราคาและใบเสร็จ — 3 dropdown เลือกจาก
// แคตตาล็อกการรับประกัน (/warranties) แล้วผูกเข้ากับรายการที่ชื่อตรงคำนั้นให้อัตโนมัติ
// (ดู applyWarrantyToItems ใน utils/warrantyKeywords.js)
export default function WarrantySection({
  warranties,
  items = [],
  nameField = 'product_name',
  rackWarrantyId,
  ballJointWarrantyId,
  otherWarrantyId,
  onRackChange,
  onBallJointChange,
  onOtherChange,
}) {
  const renderOptions = () =>
    warranties.map((w) => (
      <option key={w.id} value={w.id}>
        {w.warranty_name} • {w.warranty_year} ปี {w.warranty_month} เดือน {Number(w.warranty_km).toLocaleString()} กม.
      </option>
    ));

  // Each dropdown shows what its items really carry. A dropdown that showed "ไม่มี" over an item that still had a
  // warranty (a product's own warranty, or a bill opened for editing) could never clear it: picking "ไม่มี" again
  // is no change, so nothing ran and the warranty stayed on the printout.
  const shown = (chosenId, keywords, isOther) => {
    const current = slotWarranty(items, warranties, keywords, isOther, nameField);
    if (!current.name) return { value: chosenId, extra: null };
    if (current.id) return { value: current.id, extra: null };
    return { value: FROM_ITEMS, extra: current.name };
  };
  const renderSelect = (label, chosenId, keywords, isOther, onChange) => {
    const { value, extra } = shown(chosenId, keywords, isOther);
    return (
      <div className="form-group">
        <label>{label}</label>
        <select value={value} onChange={(e) => e.target.value !== FROM_ITEMS && onChange(e.target.value)}>
          <option value="">ไม่มี</option>
          {extra && <option value={FROM_ITEMS}>{extra} (ตามสินค้าที่เลือก)</option>}
          {renderOptions()}
        </select>
      </div>
    );
  };

  return (
    <div className="info-card">
      <div className="info-card-title">การรับประกัน</div>
      <div className="receipt-info-grid">
        {renderSelect('ประกันแร็ค', rackWarrantyId, RACK_KEYWORDS, false, onRackChange)}
        {renderSelect('ประกันลูกหมาก', ballJointWarrantyId, BALL_JOINT_KEYWORDS, false, onBallJointChange)}
        {renderSelect('ประกันอื่นๆ', otherWarrantyId, ALL_WARRANTY_KEYWORDS, true, onOtherChange)}
      </div>
    </div>
  );
}
