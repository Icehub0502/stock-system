import React, { useState } from 'react';

export default function ConfirmStockModal({ rack, mode, onConfirm, onCancel, loading }) {
  const [qty, setQty] = useState(1);

  if (!rack) return null;

  const isOut = mode === 'OUT';
  const outOfStock = isOut && rack.stock_qty <= 0;

  return (
    <div className="modal-backdrop">
      <div className={`modal-card ${isOut ? 'modal-warning' : ''}`}>
        <h3>{isOut ? '⚠️ ยืนยันการจ่ายแร็คออกจากสต็อก' : 'ยืนยันรับแร็คเข้าสต็อก'}</h3>

        <div className="modal-rack-info">
          <p><strong>รหัสรุ่น:</strong> {rack.model_code}</p>
          <p><strong>รายการ:</strong> {rack.name}</p>
          <p><strong>สต็อกคงเหลือ:</strong> {rack.stock_qty}</p>
        </div>

        {outOfStock && <p className="error-text">สต็อกหมดแล้ว ไม่สามารถจ่ายออกได้</p>}

        <label>จำนวนที่จะ{isOut ? 'จ่ายออก' : 'รับเข้า'}</label>
        <input
          type="number"
          min={1}
          max={isOut ? rack.stock_qty : undefined}
          value={qty}
          onChange={(e) => setQty(Number(e.target.value))}
          disabled={outOfStock}
        />

        <div className="modal-actions">
          <button type="button" onClick={onCancel} disabled={loading}>ยกเลิก</button>
          <button
            type="button"
            className={isOut ? 'btn-danger' : 'btn-primary'}
            onClick={() => onConfirm(qty)}
            disabled={loading || outOfStock || qty <= 0 || (isOut && qty > rack.stock_qty)}
          >
            {loading ? 'กำลังบันทึก...' : isOut ? 'ยืนยันจ่ายออก' : 'ยืนยันรับเข้า'}
          </button>
        </div>
      </div>
    </div>
  );
}
