import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { jobStatusDef, nextMainStatus, prevMainStatus } from '../utils/jobStatus';
import { WORK_BAYS } from '../utils/workBays';
import { todayStr } from '../utils/format';
import AddJobModal from '../components/AddJobModal';
import CarIcon from '../components/CarIcon';
import StatusTrack from '../components/StatusTrack';
import useRealtimeEvent from '../hooks/useRealtimeEvent';

/**
 * รายการงานวันนี้ (สำหรับพนักงาน — ต่างจาก /board ที่เป็นจอสาธารณะห้องรับรอง)
 * แสดงเป็นการ์ด — ควบคุมสถานะ/ช่องยกได้จากหน้านี้เลยไม่ต้องกดเข้าไป (ย้ายมาจาก
 * JobDetailPage.jsx ตามที่เจ้าของร้านสั่ง) เหลือที่ JobDetailPage แค่เรื่องที่
 * ซับซ้อนกว่านั้น (แก้ข้อมูลรถ/ลูกค้า, รายการอะไหล่/ใบเสนอราคา)
 */
export default function JobBoardPage() {
  const navigate = useNavigate();
  const [date, setDate] = useState(todayStr());
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const load = async ({ silent } = {}) => {
    try {
      if (!silent) setLoading(true);
      const res = await client.get('/jobs', { params: { date } });
      setJobs(res.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || 'โหลดรายการงานไม่สำเร็จ');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => { load(); }, [date]);

  // Realtime: other tabs/devices changing today's jobs should refresh this
  // list without a manual reload. Guarded by `date` — staff browsing a past
  // date shouldn't have their view silently overwritten by "today" activity.
  useRealtimeEvent(
    ['job:created', 'job:updated', 'job:status-changed', 'job:quotation-linked', 'job:deleted'],
    (payload) => { if (payload.jobDate === date) load({ silent: true }); }
  );

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
        <div className="job-board-header-actions">
          <div className="form-group">
            <label>วันที่</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            + เพิ่มคิว
          </button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : jobs.length === 0 ? (
        <div className="empty-message">ยังไม่มีรถเข้าคิววันนี้</div>
      ) : (
        <div className="job-card-grid">
          {jobs.map((j) => {
            const st = jobStatusDef(j.status);
            const next = nextMainStatus(j.status);
            const prev = prevMainStatus(j.status);
            const busy = busyId === j.id;
            return (
              <div key={j.id} className="job-card" onClick={() => navigate(`/jobs/${j.id}`)}>
                <div className="job-card-top">
                  <span className="job-card-queue">คิว {j.queue_no || '-'}</span>
                  {j.quotation_no && <span className="job-card-quote-no">{j.quotation_no}</span>}
                  {j.deposit_amount > 0 && (
                    <span className="job-card-deposit-badge">💰 มัดจำ ฿{Number(j.deposit_amount).toLocaleString('th-TH')}</span>
                  )}
                </div>

                <div className="job-card-vehicle">
                  {j.photo_thumb ? (
                    <img src={j.photo_thumb} alt="" className="job-card-photo" />
                  ) : (
                    <CarIcon className="job-card-car-icon" />
                  )}
                  <div className="plate-badge">
                    <span className="plate-badge-no">{j.license_plate || '-'}</span>
                  </div>
                </div>

                <div className="job-card-info">
                  <div className="job-card-customer">{j.customer_name || '-'}</div>
                  {j.symptom && <div className="job-card-symptom">{j.symptom}</div>}
                  <div className="job-card-model">{j.brand} {j.model} {j.color && `· ${j.color}`}</div>
                </div>

                <div className="job-card-status-block" onClick={(e) => e.stopPropagation()}>
                  <StatusTrack status={j.status} />
                  <div className="job-card-status-row">
                    <span className={`status-badge ${st.badge}`}>{st.label}</span>
                    <div className="job-card-status-actions">
                      {prev && (
                        <button type="button" disabled={busy} onClick={() => changeStatus(j, prev)}>
                          ← {jobStatusDef(prev).label}
                        </button>
                      )}
                      {next && (
                        <button type="button" className="btn-primary" disabled={busy} onClick={() => changeStatus(j, next)}>
                          {jobStatusDef(next).label} →
                        </button>
                      )}
                    </div>
                  </div>
                  <select
                    value={j.bay || ''}
                    disabled={busy}
                    onChange={(e) => changeBay(j, e.target.value)}
                  >
                    <option value="">ช่องยก: -</option>
                    {WORK_BAYS.map((b) => <option key={b} value={b}>ช่องยก: {b}</option>)}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAddModal && (
        <AddJobModal
          onClose={() => setShowAddModal(false)}
          onCreated={() => { setShowAddModal(false); load(); }}
        />
      )}
    </div>
  );
}
