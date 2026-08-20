import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { jobStatusDef, nextMainStatus, DECISION_KEYS, CLOSED_STATUSES } from '../utils/jobStatus';
import { WORK_BAYS } from '../utils/workBays';
import { todayStr } from '../utils/format';

/**
 * รายการงานวันนี้ (สำหรับพนักงาน — ต่างจาก /board ที่เป็นจอสาธารณะห้องรับรอง)
 * ปุ่ม "ขั้นถัดไป" เดินตามเส้นทางหลัก (MAIN_PATH); ตรงจุดตัดสินใจ (หลังเสนอราคา)
 * จะโชว์ 3 ปุ่มให้เลือกแทนปุ่มเดียว — ทุกการเปลี่ยนสถานะจะดันสถานะใบเสนอราคาที่
 * ผูกไว้ให้ตรงกันอัตโนมัติที่ backend (ดู jobs.routes.js PATCH /:id/status)
 */
export default function JobBoardPage() {
  const navigate = useNavigate();
  const [date, setDate] = useState(todayStr());
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    try {
      setLoading(true);
      const res = await client.get('/jobs', { params: { date } });
      setJobs(res.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || 'โหลดรายการงานไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [date]);

  async function changeStatus(job, status) {
    setBusyId(job.id);
    setError('');
    try {
      await client.patch(`/jobs/${job.id}/status`, { status });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'เปลี่ยนสถานะไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  }

  async function changeBay(job, bay) {
    setBusyId(job.id);
    setError('');
    try {
      await client.patch(`/jobs/${job.id}`, { bay: bay || null });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'เปลี่ยนช่องยกไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="office-dashboard container">
      <div className="dashboard-header">
        <h2>รายการงานวันนี้ <span className="dashboard-header-sub">— ระบบคิวรับรถ</span></h2>
      </div>

      <div className="decline-summary-filters">
        <div className="form-group">
          <label>วันที่</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <button type="button" className="btn-primary" onClick={() => navigate('/checkin')}>+ รับรถเข้าคิว</button>
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : jobs.length === 0 ? (
        <div className="empty-message">ยังไม่มีรถเข้าคิววันนี้</div>
      ) : (
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead>
              <tr>
                <th>คิว</th>
                <th>เลขงาน</th>
                <th>ทะเบียน / รุ่นรถ</th>
                <th>ลูกค้า</th>
                <th>อาการ</th>
                <th>ช่องยก</th>
                <th>สถานะ</th>
                <th>ใบเสนอราคา</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const st = jobStatusDef(j.status);
                const next = nextMainStatus(j.status);
                const isDecisionPoint = j.status === 'quoted';
                const isClosed = CLOSED_STATUSES.includes(j.status);
                return (
                  <tr key={j.id}>
                    <td data-label="คิว">{j.queue_no || '-'}</td>
                    <td data-label="เลขงาน">{j.job_no}</td>
                    <td data-label="ทะเบียน / รุ่นรถ">{j.license_plate || '-'} — {j.brand} {j.model}</td>
                    <td data-label="ลูกค้า">{j.customer_name || '-'}</td>
                    <td data-label="อาการ">{j.symptom || '-'}</td>
                    <td data-label="ช่องยก">
                      <select value={j.bay || ''} disabled={busyId === j.id || isClosed} onChange={(e) => changeBay(j, e.target.value)}>
                        <option value="">-</option>
                        {WORK_BAYS.map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </td>
                    <td data-label="สถานะ"><span className={`status-badge ${st.badge}`}>{st.label}</span></td>
                    <td data-label="ใบเสนอราคา">{j.quotation_no || '-'}</td>
                    <td data-label="" className="actions">
                      <button type="button" onClick={() => navigate(`/jobs/${j.id}`)}>รายละเอียด</button>
                      {isDecisionPoint ? (
                        DECISION_KEYS.map((k) => (
                          <button key={k} type="button" disabled={busyId === j.id} onClick={() => changeStatus(j, k)}>
                            {jobStatusDef(k).label}
                          </button>
                        ))
                      ) : (
                        next && !isClosed && (
                          <button type="button" className="btn-primary" disabled={busyId === j.id} onClick={() => changeStatus(j, next)}>
                            → {jobStatusDef(next).label}
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
