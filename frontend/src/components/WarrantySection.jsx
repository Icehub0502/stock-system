import React from 'react';

// การ์ด "การรับประกัน" ใช้ร่วมกันทั้งใบเสนอราคาและใบเสร็จ — 3 dropdown เลือกจาก
// แคตตาล็อกการรับประกัน (/warranties) แล้วผูกเข้ากับรายการที่ชื่อตรงคำนั้นให้อัตโนมัติ
// (ดู applyWarrantyToItems ใน utils/warrantyKeywords.js)
export default function WarrantySection({
  warranties,
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

  return (
    <div className="info-card">
      <div className="info-card-title">การรับประกัน</div>
      <div className="receipt-info-grid">
        <div className="form-group">
          <label>ประกันแร็ค</label>
          <select value={rackWarrantyId} onChange={(e) => onRackChange(e.target.value)}>
            <option value="">ไม่มี</option>
            {renderOptions()}
          </select>
        </div>
        <div className="form-group">
          <label>ประกันลูกหมาก</label>
          <select value={ballJointWarrantyId} onChange={(e) => onBallJointChange(e.target.value)}>
            <option value="">ไม่มี</option>
            {renderOptions()}
          </select>
        </div>
        <div className="form-group">
          <label>ประกันอื่นๆ</label>
          <select value={otherWarrantyId} onChange={(e) => onOtherChange(e.target.value)}>
            <option value="">ไม่มี</option>
            {renderOptions()}
          </select>
        </div>
      </div>
    </div>
  );
}
