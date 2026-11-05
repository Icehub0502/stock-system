import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { CASE_STATUS } from '../utils/claimCases';
import ClaimCaseForm from './ClaimCaseForm';

// What a come-back job (ลูกค้าเก่าแก้งาน) shows on its job page in place of the quotation: how it was fixed, the parts
// claimed or replaced, and the claim document.
export default function ReworkJobPanel({ job, onCancelled }) {
  const [claim, setClaim] = useState(null);
  const [formVersion, setFormVersion] = useState(0);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [savedNote, setSavedNote] = useState(false);

  const loadClaim = useCallback(async () => {
    try {
      const res = await client.get(`/claims/${job.case_id}`);
      setClaim(res.data.data);
      setFormVersion((n) => n + 1);
    } catch (err) {
      setError(err.response?.data?.error || 'โหลดเคสไม่สำเร็จ');
    }
  }, [job.case_id]);

  useEffect(() => { loadClaim(); }, [loadClaim]);

  const handleSaved = async () => {
    await loadClaim();
    setSavedNote(true);
    setTimeout(() => setSavedNote(false), 2500);
  };

  const handleCancelRework = async () => {
    if (!window.confirm('งานนี้ไม่ใช่งานแก้ใช่ไหม? รถจะกลับไปขั้นตรวจเช็คเพื่อเลือก "ลงรายการ"')) return;
    setCancelling(true);
    setError('');
    try {
      await client.post(`/claims/from-job/${job.id}/cancel`);
      onCancelled();
    } catch (err) {
      setError(err.response?.data?.error || 'เปลี่ยนเป็นลงรายการไม่สำเร็จ');
    } finally {
      setCancelling(false);
    }
  };

  const canCancel = ['received', 'inspecting', 'repairing'].includes(job.status) && !claim?.doc_issued_at;

  return (
    <div className="dash-panel">
      <div className="dash-panel-title rework-panel-title">
        <span>ข้อมูลการแก้งาน · {job.case_no}</span>
        {claim && (
          <span className={`status-badge ${CASE_STATUS[claim.status]?.badge || 'status-badge-neutral'}`}>
            {CASE_STATUS[claim.status]?.label || claim.status}
          </span>
        )}
      </div>
      {error && <div className="error-message">{error}</div>}
      {claim?.doc_issued_at && (
        <p className="fu-line">ออกใบเคลมแล้ว ดูย้อนหลังได้ที่ <Link to="/claim-documents">งานขาย → ใบเคลม</Link></p>
      )}
      {claim ? (
        <ClaimCaseForm
          key={formVersion}
          claim={claim}
          vehicle={{ vehicle_id: claim.vehicle_id, customer_id: claim.customer_id }}
          onSaved={handleSaved}
          notice={savedNote ? 'บันทึกแล้ว' : ''}
        />
      ) : !error && <div className="loading">กำลังโหลด...</div>}
      {canCancel && (
        <button type="button" className="rework-cancel" disabled={cancelling} onClick={handleCancelRework}>
          {cancelling ? 'กำลังเปลี่ยน...' : 'ไม่ใช่งานแก้ เปลี่ยนเป็นลงรายการ'}
        </button>
      )}
    </div>
  );
}
