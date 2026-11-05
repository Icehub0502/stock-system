import React, { useEffect, useState } from 'react';
import client from '../api/client';
import ClaimPrintTemplate from './ClaimPrintTemplate';
import PrintPortal from './PrintPortal';
import useFitToWidth from '../hooks/useFitToWidth';

// Preview and print of a claim document, always from the saved case. Same layout as QuotationPrintModal.jsx.
export default function ClaimPrintModal({ claimId, onClose }) {
  const [claim, setClaim] = useState(null);
  const [error, setError] = useState('');
  const { containerRef: previewRef, scale: previewScale } = useFitToWidth([claim]);

  useEffect(() => {
    client.get(`/claims/${claimId}`)
      .then((res) => setClaim(res.data.data))
      .catch((err) => setError(err.response?.data?.error || 'โหลดใบเคลมไม่สำเร็จ'));
  }, [claimId]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card large print-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header print-header">
          <h2>ใบเคลม {claim?.claim_no || ''}</h2>
          <div className="print-actions">
            <button className="btn btn-primary" disabled={!claim} onClick={() => window.print()}>🖨️ พิมพ์</button>
            <button className="btn-close" onClick={onClose}>✕</button>
          </div>
        </div>

        {error && <div className="error-message">{error}</div>}
        {!claim && !error && <div className="loading">กำลังโหลด...</div>}

        <div className="print-content" ref={previewRef}>
          <div style={{ zoom: previewScale }}>
            <ClaimPrintTemplate claim={claim} />
          </div>
        </div>

        <div className="modal-footer no-print">
          <button className="btn btn-primary" disabled={!claim} onClick={() => window.print()}>🖨️ พิมพ์</button>
          <button className="btn btn-secondary" onClick={onClose}>ปิด</button>
        </div>
      </div>
      <PrintPortal>
        <ClaimPrintTemplate claim={claim} />
      </PrintPortal>
    </div>
  );
}
