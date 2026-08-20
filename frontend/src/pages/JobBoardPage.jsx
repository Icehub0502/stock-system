import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { jobStatusDef } from '../utils/jobStatus';
import { WORK_BAYS } from '../utils/workBays';
import { todayStr } from '../utils/format';
import AddJobModal from '../components/AddJobModal';
import CarIcon from '../components/CarIcon';

/**
 * รายการงานวันนี้ (สำหรับพนักงาน — ต่างจาก /board ที่เป็นจอสาธารณะห้องรับรอง)
 * แสดงเป็นการ์ด ไม่ใช่ตาราง — แต่ละใบเห็นรูปรถ+ป้ายทะเบียนแบบจำลองของจริง เห็น
 * สถานะทันทีโดยไม่ต้องกดเข้าไป กดที่การ์ดเพื่อดู/แก้ไขรายละเอียด เปลี่ยนสถานะ
 * ตัดสินใจใบเสนอราคา ฯลฯ (ทุกอย่างย้ายไปอยู่ที่ JobDetailPage.jsx แล้ว หน้านี้
 * เหลือแค่ช่องยกที่ยังปรับเร็ว ๆ จากการ์ดได้เลยโดยไม่ต้องเปิดเข้าไป)
 */
export default function JobBoardPage() {
  const navigate = useNavigate();
  const [date, setDate] = useState(todayStr());
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);

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
        <button type="button" className="btn btn-primary btn-fab-mobile" onClick={() => setShowAddModal(true)}>
          + เพิ่มคิว
        </button>
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
            return (
              <div key={j.id} className="job-card" onClick={() => navigate(`/jobs/${j.id}`)}>
                <div className="job-card-top">
                  <span className="job-card-queue">คิว {j.queue_no || '-'}</span>
                  <span className={`status-badge ${st.badge}`}>{st.label}</span>
                </div>

                <div className="job-card-vehicle">
                  <CarIcon className="job-card-car-icon" />
                  <div className="plate-badge">
                    <span className="plate-badge-no">{j.license_plate || '-'}</span>
                  </div>
                </div>

                <div className="job-card-info">
                  <div className="job-card-model">{j.brand} {j.model} {j.color && `· ${j.color}`}</div>
                  <div className="job-card-customer">{j.customer_name || '-'}</div>
                  {j.symptom && <div className="job-card-symptom">{j.symptom}</div>}
                </div>

                <div className="job-card-bottom" onClick={(e) => e.stopPropagation()}>
                  <select
                    value={j.bay || ''}
                    disabled={busyId === j.id}
                    onChange={(e) => changeBay(j, e.target.value)}
                  >
                    <option value="">ช่องยก: -</option>
                    {WORK_BAYS.map((b) => <option key={b} value={b}>ช่องยก: {b}</option>)}
                  </select>
                  {j.quotation_no && <span className="job-card-quote-no">{j.quotation_no}</span>}
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
