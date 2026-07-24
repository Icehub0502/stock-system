import React, { useState } from 'react';

const PAYMENT_METHODS = ['โอน', 'บัตรเครดิต', 'เงินสด', 'QRCode'];

// รับชำระเงิน/ปิดบิลจากหน้าเว็บโดยตรง — เดิมมีแค่ทางไลน์ (พิมพ์วลี "ชำระเงินเรียบร้อย")
// ที่ตั้งสถานะ "ชำระแล้ว" ได้ ออฟฟิศที่ปิดงานผ่านเว็บอย่างเดียวไม่มีทางตั้งได้เลย
export default function ClosePaymentDialog({ quotation, onConfirm, onCancel, loading }) {
  const [paymentMethod, setPaymentMethod] = useState('');
  // ค่าเริ่มต้น = ยอดรวมทั้งบิลลบมัดจำที่เคยรับไว้แล้ว (ยอดที่ควรได้รับตอนนี้) —
  // แก้ไขได้ถ้าลูกค้าจ่ายจริงไม่ตรงเป๊ะ (เช่น บัตรเครดิต +3%)
  const totalAmount = Number(quotation.total_amount || 0);
  const depositAmount = Number(quotation.deposit_amount || 0);
  const [paidAmount, setPaidAmount] = useState(String(totalAmount - depositAmount));

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>รับชำระเงิน / ปิดบิล</h3>
          <button className="btn-close" type="button" onClick={onCancel} disabled={loading}>✕</button>
        </div>
        <div className="modal-body">
          <p>{quotation.quotation_no} — {quotation.customer_name}</p>
          {depositAmount > 0 && (
            <p className="subtitle">มัดจำที่รับไว้แล้ว ฿{depositAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
          )}
          <div className="form-group">
            <label>ช่องทางการชำระ</label>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="">-- เลือกช่องทาง --</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>ยอดที่ได้รับจริง</label>
            <input
              type="number"
              step="0.01"
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
            />
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={loading}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onConfirm({ payment_method: paymentMethod, paid_amount: paidAmount })}
            disabled={loading || !paymentMethod}
          >
            {loading ? 'กำลังบันทึก...' : 'ยืนยันปิดบิล'}
          </button>
        </div>
      </div>
    </div>
  );
}
