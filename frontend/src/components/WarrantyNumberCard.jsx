import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { canChange } from '../utils/roles';
import { formatDateTh } from '../utils/dateGroups';
import { WARRANTY_STATUS, daysLeftText, kmLeftText } from '../utils/warrantyLabels';

// On a job or a receipt: the bill's warranty number (rack jobs only, one per bill) and the warranties still running on
// this car. onChange tells the page the current number, for what it prints.
export default function WarrantyNumberCard({ jobId, receiptId, onChange }) {
  const { user } = useAuth();
  const isManager = canChange(user, 'manager');
  const [info, setInfo] = useState(null);
  const [typed, setTyped] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await client.get('/warranty-register/of', { params: jobId ? { job_id: jobId } : { receipt_id: receiptId } });
      setInfo(res.data.data);
      setError('');
      if (onChange) onChange(res.data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'โหลดเลขประกันไม่สำเร็จ');
    }
    // onChange is only a report back and must not reload the card
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, receiptId]);

  useEffect(() => { load(); }, [load]);

  const assign = async (warrantyNo) => {
    const typedNo = Number(warrantyNo);
    if (typedNo && info.next_no && typedNo > info.next_no) {
      const skipped = typedNo === info.next_no + 1 ? `${info.next_no}` : `${info.next_no}-${typedNo - 1}`;
      if (!window.confirm(`จะข้ามเลข ${skipped} ใช่ไหม? เลขถัดไปจะนับต่อจาก ${typedNo}`)) return;
    }
    setSaving(true);
    setError('');
    try {
      await client.post('/warranty-register/assign', {
        ...(jobId ? { job_id: jobId } : { receipt_id: receiptId }),
        ...(warrantyNo ? { warranty_no: warrantyNo } : {}),
      });
      setTyped('');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'ออกเลขประกันไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const voidNumber = async () => {
    if (!window.confirm(`ยกเลิกเลข ${info.warranty_label}? เลขนี้จะไม่ถูกนำกลับมาใช้อีก และบิลนี้จะออกเลขใหม่ได้`)) return;
    setSaving(true);
    try {
      await client.post(`/warranty-register/numbers/${info.number_id}/void`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'ยกเลิกเลขไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  if (!info) return error ? <p className="error-text">{error}</p> : null;
  const running = info.vehicle_warranties || [];
  if (!info.has_rack && !info.warranty_no && running.length === 0) return null;

  return (
    <div className="dash-panel wr-card">
      <div className="dash-panel-title">การรับประกัน</div>

      {info.warranty_no ? (
        <div className="wr-card-number">
          <span>เลขประกันแร็ค</span>
          <b>{info.warranty_label}</b>
          {isManager && <button type="button" className="wr-link-btn" onClick={voidNumber} disabled={saving}>ยกเลิกเลข</button>}
        </div>
      ) : info.has_rack && (
        <div className="wr-card-assign">
          <p>งานนี้เปลี่ยนแร็ค ยังไม่มีเลขประกัน</p>
          {info.next_no ? (
            <button type="button" className="btn-primary" onClick={() => assign()} disabled={saving}>
              ออกเลข {info.branch_code} {info.next_no}
            </button>
          ) : (
            <p className="error-text">
              สาขานี้ยังไม่ได้ตั้งเลขเริ่มต้น {isManager ? <Link to="/warranty-register">ตั้งที่หน้าทะเบียนประกัน</Link> : 'ให้ผู้จัดการตั้งที่หน้าทะเบียนประกัน'}
            </p>
          )}
          {isManager && (
            <div className="wr-card-typed">
              <input
                type="number"
                min="1"
                inputMode="numeric"
                value={typed}
                placeholder="หรือพิมพ์เลขเอง"
                aria-label="เลขประกันที่พิมพ์เอง"
                onChange={(e) => setTyped(e.target.value)}
              />
              <button type="button" onClick={() => assign(typed)} disabled={saving || !typed}>ใช้เลขนี้</button>
            </div>
          )}
        </div>
      )}
      {error && <p className="error-text">{error}</p>}

      {running.length > 0 && (
        <div className="wr-card-running">
          <p className="wr-card-running-title">รถคันนี้ยังอยู่ในประกัน</p>
          {running.map((row) => (
            <div className="wr-card-running-row" key={`${row.receipt_id}-${row.warranty_name}`}>
              <div>
                <b>{row.warranty_name}</b>
                <small>บิล {row.receipt_no} · {formatDateTh(row.receipt_date)}</small>
              </div>
              <div className="wr-card-running-left">
                <span className={WARRANTY_STATUS[row.status].className}>{daysLeftText(row.days_left)}</span>
                <small>{kmLeftText(row)}</small>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
