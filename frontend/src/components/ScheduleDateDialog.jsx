import React, { useState } from 'react';
import { todayStr } from '../utils/format';

// เพิ่มช่องมัดจำ (optional) เข้ามาในไดอะล็อกเดียวกับตั้งวันนัด — เดิมต้องไปกด
// "แก้ไข" ใบเสนอราคาแยกต่างหากเพื่อใส่มัดจำ ถ้าลืมทำ มัดจำจะไม่ถูกบันทึกไปเลยแม้จะ
// ตั้งวันนัดแล้ว (เจ้าของร้านเจอปัญหานี้จริง) — initialDepositAmount/Date เติมค่าเดิม
// ให้ (ถ้ามีอยู่แล้ว) แก้ไขทับได้ ไม่กรอกก็เก็บของเดิมไว้เหมือนเดิม (ดู backend
// COALESCE ที่ /schedule, /no-date)
export default function ScheduleDateDialog({
  initialDate, initialDepositAmount, initialDepositDate,
  onConfirm, onNoDate, onCancel, loading,
}) {
  const [date, setDate] = useState(initialDate || todayStr());
  const [depositAmount, setDepositAmount] = useState(initialDepositAmount != null ? String(initialDepositAmount) : '');
  const [depositDate, setDepositDate] = useState(initialDepositDate || todayStr());

  const depositPayload = depositAmount !== ''
    ? { deposit_amount: Number(depositAmount), deposit_date: depositDate }
    : {};

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>รอทำครั้งหน้า</h3>
          <button className="btn-close" type="button" onClick={onCancel} disabled={loading}>✕</button>
        </div>
        <div className="modal-body">
          <p>เลือกวันที่ลูกค้าจะกลับมาทำรายการ (ใส่มัดจำพร้อมกันได้เลยถ้ามี)</p>
          <div className="form-group">
            <label>วันที่นัดหมาย</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label>ยอดมัดจำ (บาท — ไม่บังคับ)</label>
            <input type="number" min="0" step="0.01" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} />
          </div>
          {depositAmount !== '' && (
            <div className="form-group">
              <label>วันที่วางมัดจำ</label>
              <input type="date" value={depositDate} onChange={(e) => setDepositDate(e.target.value)} />
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={loading}>
            ยกเลิก
          </button>
          {onNoDate && (
            <button type="button" className="btn btn-danger" onClick={() => onNoDate(depositPayload)} disabled={loading}>
              {loading ? 'กำลังบันทึก...' : 'ไม่ระบุวันนัดหมาย'}
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => onConfirm(date, depositPayload)} disabled={loading || !date}>
            {loading ? 'กำลังบันทึก...' : 'บันทึกวันนัดหมาย'}
          </button>
        </div>
      </div>
    </div>
  );
}
