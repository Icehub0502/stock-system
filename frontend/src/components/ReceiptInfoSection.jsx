import React from 'react';

export default function ReceiptInfoSection({ receiptNo, receiptDate, pic, onDateChange, onPicChange }) {
  return (
    <div className="info-card receipt-info-card">
      <div className="info-card-title">ข้อมูลใบเสร็จ</div>
      <div className="info-card-grid receipt-info-grid">
        <div className="form-group">
          <label>เลขที่บิล</label>
          <input type="text" readOnly value={receiptNo} />
        </div>
        <div className="form-group">
          <label>วันที่</label>
          <input type="date" value={receiptDate} onChange={(e) => onDateChange(e.target.value)} required />
        </div>
        <div className="form-group">
          <label>PIC</label>
          <input type="text" value={pic} onChange={(e) => onPicChange(e.target.value)} placeholder="ผู้รับผิดชอบ" />
        </div>
      </div>
    </div>
  );
}
