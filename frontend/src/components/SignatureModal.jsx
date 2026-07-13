import React, { useState } from 'react';
import SignaturePad from './SignaturePad';

// Generic signature-capture modal — the caller owns what happens with the
// resulting PNG data URI (which endpoint to PATCH), this just handles the
// drawing UI and the save/cancel affordances. Kept full-width and big on
// mobile since the whole point is handing this screen to a customer on a
// shop tablet or phone.
export default function SignatureModal({ title, subtitle, onSave, onClose }) {
  const [dataUrl, setDataUrl] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    if (!dataUrl) {
      setError('กรุณาเซ็นชื่อก่อนบันทึก');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(dataUrl);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกลายเซ็นไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '20px 20px 4px' }}>
          <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>{title || 'เซ็นชื่อลูกค้า'}</h2>
          {subtitle && <p style={{ margin: '0 0 16px', color: '#6b7280', fontSize: 13.5 }}>{subtitle}</p>}
        </div>

        <div style={{ padding: '0 20px' }}>
          <SignaturePad onChange={setDataUrl} />
          {error && (
            <div style={{ color: '#dc2626', fontSize: 13, marginTop: 10 }}>{error}</div>
          )}
        </div>

        <div className="modal-footer no-print" style={{ marginTop: 20 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={saving}
          >
            {saving ? 'กำลังบันทึก...' : 'บันทึกลายเซ็น'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  );
}
