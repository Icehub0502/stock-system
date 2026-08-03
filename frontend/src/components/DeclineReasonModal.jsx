import React, { useState } from 'react';
import { DECLINE_REASONS } from '../utils/declineReasons';

export default function DeclineReasonModal({ quotation, onConfirm, onCancel, loading }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');

  const needsNote = reason === 'other';
  const canSubmit = reason && (!needsNote || note.trim());

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>ลูกค้าไม่ได้ทำ</h3>
          <button className="btn-close" type="button" onClick={onCancel} disabled={loading}>✕</button>
        </div>
        <div className="modal-body">
          <p>{quotation.quotation_no} ({quotation.customer_name}) — เลือกเหตุผลที่ลูกค้าไม่ได้ทำ</p>
          <div className="form-group">
            <label>เหตุผล</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">-- เลือกเหตุผล --</option>
              {DECLINE_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          {needsNote && (
            <div className="form-group">
              <label>ระบุรายละเอียด</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="ระบุเหตุผล..."
                autoFocus
              />
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={loading}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => onConfirm({ reason, note: needsNote ? note.trim() : '' })}
            disabled={loading || !canSubmit}
          >
            {loading ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}
