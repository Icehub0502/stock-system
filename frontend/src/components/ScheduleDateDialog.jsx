import React, { useState } from 'react';
import { todayStr } from '../utils/format';

export default function ScheduleDateDialog({ initialDate, onConfirm, onNoDate, onCancel, loading }) {
  const [date, setDate] = useState(initialDate || todayStr());

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>รอทำครั้งหน้า</h3>
          <button className="btn-close" type="button" onClick={onCancel} disabled={loading}>✕</button>
        </div>
        <div className="modal-body">
          <p>เลือกวันที่ลูกค้าจะกลับมาทำรายการ</p>
          <div className="form-group">
            <label>วันที่นัดหมาย</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={loading}>
            ยกเลิก
          </button>
          {onNoDate && (
            <button type="button" className="btn btn-danger" onClick={onNoDate} disabled={loading}>
              {loading ? 'กำลังบันทึก...' : 'ไม่ระบุวันนัดหมาย'}
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => onConfirm(date)} disabled={loading || !date}>
            {loading ? 'กำลังบันทึก...' : 'บันทึกวันนัดหมาย'}
          </button>
        </div>
      </div>
    </div>
  );
}
