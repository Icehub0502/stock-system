import React, { useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import Toast from './Toast';

export default function FormModalShell({
  title,
  subtitle,
  onClose,
  error,
  toast,
  onToastDone,
  children,
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const requestClose = () => setConfirmOpen(true);

  return (
    <div className="modal-backdrop" onClick={requestClose}>
      <div className="modal-card large receipt-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="modal-subtitle">{subtitle}</p>}
          </div>
          <button className="btn-close" type="button" onClick={requestClose}>✕</button>
        </div>

        {error && <div className="error-message">{error}</div>}
        {toast && <Toast message={toast.message} type={toast.type} onDone={onToastDone} />}

        {children({ requestClose })}
      </div>

      {confirmOpen && (
        <ConfirmDialog
          title="ยืนยันยกเลิก"
          message="ข้อมูลที่กรอกไว้จะไม่ถูกบันทึก หากต้องการตรวจสอบก่อน กรุณากดอยู่ต่อ"
          confirmLabel="ยกเลิก"
          cancelLabel="อยู่ต่อ"
          onConfirm={() => { setConfirmOpen(false); onClose(); }}
          onCancel={() => setConfirmOpen(false)}
          loading={false}
        />
      )}
    </div>
  );
}
