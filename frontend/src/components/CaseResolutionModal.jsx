import React, { useEffect, useState } from 'react';
import client from '../api/client';
import { todayStr } from '../utils/format';
import { followUpDateOf } from '../utils/claimCases';
import FollowUpSelect from './FollowUpSelect';

// Asked when the repair of a come-back job ends: how the car was fixed is required before the card can move on. The
// first call defaults to one week from today, unless a call is already planned.
export default function CaseResolutionModal({ job, onClose, onDone }) {
  const [claim, setClaim] = useState(null);
  const [finding, setFinding] = useState('');
  const [resolution, setResolution] = useState('');
  const [followUpChoice, setFollowUpChoice] = useState('week');
  const [followUpCustom, setFollowUpCustom] = useState('');
  const [needsAlignment, setNeedsAlignment] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const pendingFollowUp = (claim?.follow_ups || []).find((f) => !f.done_at);

  useEffect(() => {
    client.get(`/claims/${job.case_id}`)
      .then((res) => {
        const data = res.data.data;
        setClaim(data);
        setFinding(data.finding || '');
        setResolution(data.resolution || '');
        if ((data.follow_ups || []).some((f) => !f.done_at)) setFollowUpChoice('');
      })
      .catch((err) => setError(err.response?.data?.error || 'โหลดเคสไม่สำเร็จ'));
  }, [job.case_id]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!resolution.trim()) {
      setError('กรุณากรอกวิธีแก้ไขว่าทำอะไรบ้าง');
      return;
    }
    const followUpDate = followUpDateOf(followUpChoice, followUpCustom, todayStr());
    if (followUpDate === null) {
      setError('กรุณาเลือกวันที่ติดตามผล');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await client.post(`/claims/${job.case_id}/resolution`, {
        finding: finding.trim() || null,
        resolution: resolution.trim(),
        ...(followUpDate ? { follow_up_date: followUpDate } : {}),
      });
      await client.patch(`/jobs/${job.id}/status`, { status: needsAlignment ? 'aligning' : 'ready' });
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'บันทึกวิธีแก้ไขไม่สำเร็จ');
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">ระบุวิธีแก้ไข · คิว {job.queue_no || '-'} · {job.license_plate || '-'}</h3>
        {claim && claim.symptom && <p className="fu-line"><strong>อาการ:</strong> {claim.symptom}</p>}
        {claim?.earlier_rounds && (
          <details className="fu-similar">
            <summary>รอบก่อนที่รถกลับมา</summary>
            <div className="case-earlier">{claim.earlier_rounds}</div>
          </details>
        )}
        <form className="modal-form" onSubmit={handleSave}>
          {error && <div className="error-message" role="alert">{error}</div>}
          <div className="form-group">
            <label>สิ่งที่ตรวจพบ</label>
            <textarea rows={2} value={finding} onChange={(e) => setFinding(e.target.value)} placeholder="เช่น น็อตยึดหลวม" />
          </div>
          <div className="form-group">
            <label>วิธีแก้ไข ทำอะไรบ้าง <span style={{ color: '#b91c1c' }}>* จำเป็น</span></label>
            <textarea rows={3} autoFocus value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="เช่น ขันน็อตใหม่ตามค่าทอร์ค แล้วลองขับ" />
          </div>
          <FollowUpSelect
            choice={followUpChoice}
            onChoice={setFollowUpChoice}
            customDate={followUpCustom}
            onCustomDate={setFollowUpCustom}
            pendingDate={pendingFollowUp?.scheduled_date}
          />
          <label className="case-align-check">
            <input type="checkbox" checked={needsAlignment} onChange={(e) => setNeedsAlignment(e.target.checked)} />
            ต้องตั้งศูนย์ก่อนส่งรถ
          </label>
          <div className="modal-actions">
            <button type="submit" className="btn-primary" disabled={saving || !claim}>
              {saving ? 'กำลังบันทึก...' : `บันทึก แล้วไป "${needsAlignment ? 'รอตั้งศูนย์' : 'พร้อมส่ง'}"`}
            </button>
            <button type="button" onClick={onClose} disabled={saving}>ยกเลิก</button>
          </div>
        </form>
      </div>
    </div>
  );
}
