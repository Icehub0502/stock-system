import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { jobStatusDef, nextMainStatus, prevMainStatus } from '../utils/jobStatus';
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
  const [technicians, setTechnicians] = useState([]);
  const [qrData, setQrData] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState('');

  // รถที่ออกจากอู่ไปแล้วโดยยังไม่ได้ทำ ไม่ควรค้างอยู่ในคิววันนี้ให้พนักงานสับสน —
  // ทั้ง 3 ทางแยกนี้ยังตามต่อได้จากหน้าอื่นอยู่แล้ว: มัดจำ/นัดวันมาทำ → หน้ามัดจำ
  // (/appointments), ลูกค้าไม่ได้ทำ → หน้าสรุปลูกค้าที่ไม่ได้ทำ ส่วน 'delivered'
  // (ส่งรถแล้ว) ยังโชว์อยู่ตามเดิม เพราะเป็นงานที่ทำเสร็จจริงในวันนั้น
  const HIDDEN_STATUSES = ['carout', 'scheduled', 'rejected'];

  const load = async ({ silent } = {}) => {
    try {
      if (!silent) setLoading(true);
      const res = await client.get('/jobs', { params: { date } });
      setJobs((res.data.data || []).filter((j) => !HIDDEN_STATUSES.includes(j.status)));
    } catch (err) {
      setError(err.response?.data?.error || 'โหลดรายการงานไม่สำเร็จ');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => { load(); }, [date]);

  const loadTechnicians = async () => {
    try {
      const res = await client.get('/technicians');
      setTechnicians(res.data.data || []);
    } catch (err) {
      // เงียบไว้พอ — dropdown แค่จะว่าง ไม่ใช่ปัญหาที่บล็อกงานอื่นในหน้านี้
    }
  };
  useEffect(() => { loadTechnicians(); }, []);

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

  const NEW_TECHNICIAN_OPTION = '__new__';

  async function changeTechnician(job, value) {
    if (value === NEW_TECHNICIAN_OPTION) {
      const name = window.prompt('ชื่อช่างใหม่:');
      if (!name || !name.trim()) return;
      setBusyId(job.id);
      setError('');
      try {
        const res = await client.post('/technicians', { name: name.trim() });
        setTechnicians((prev) => {
          if (prev.some((t) => t.id === res.data.data.id)) return prev;
          return [...prev, res.data.data].sort((a, b) => a.name.localeCompare(b.name, 'th'));
        });
        await client.patch(`/jobs/${job.id}`, { technician: res.data.data.name });
        await load();
      } catch (err) {
        setError(err.response?.data?.error || 'เพิ่มชื่อช่างไม่สำเร็จ');
      } finally {
        setBusyId(null);
      }
      return;
    }
    setBusyId(job.id);
    setError('');
    try {
      await client.patch(`/jobs/${job.id}`, { technician: value || null });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'มอบหมายช่างไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  }

  // QR ติดตามสถานะรถ — คงที่ ไม่ผูกกับงานไหนเลย (ลิงก์แค่หน้า /track เฉย ๆ ลูกค้า
  // พิมพ์ทะเบียน+เบอร์โทร 4 ตัวท้ายเอง) พิมพ์ครั้งเดียวแปะห้องรับรองถาวรได้เลย — ย้าย
  // มาจากหน้ารายละเอียดงานเดิม (เจ้าของร้านสั่ง — ของเดิมสร้างใหม่ทุกครั้งไม่จำเป็น)
  async function handleShowQr() {
    setQrLoading(true);
    setQrError('');
    try {
      const res = await client.get('/jobs/qr/track');
      setQrData(res.data);
    } catch (err) {
      setQrError(err.response?.data?.error || 'สร้าง QR ไม่สำเร็จ');
    } finally {
      setQrLoading(false);
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
          <button type="button" onClick={handleShowQr} disabled={qrLoading}>
            {qrLoading ? 'กำลังสร้าง QR...' : '📱 QR ติดตามสถานะ'}
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
                    value={j.technician || ''}
                    disabled={busy}
                    onChange={(e) => changeTechnician(j, e.target.value)}
                  >
                    <option value="">ช่าง: -</option>
                    {technicians.map((t) => <option key={t.id} value={t.name}>ช่าง: {t.name}</option>)}
                    <option value={NEW_TECHNICIAN_OPTION}>+ เพิ่มชื่อช่างใหม่...</option>
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

      {(qrData || qrError) && (
        <div className="modal-backdrop" onClick={() => { setQrData(null); setQrError(''); }}>
          <div className="modal-card" style={{ maxWidth: 360, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">QR ติดตามสถานะรถ</h3>
            {qrError ? (
              <p className="error-text">{qrError}</p>
            ) : (
              <>
                <p style={{ fontSize: 13, color: '#6b7280' }}>
                  พิมพ์แปะห้องรับรอง — ลูกค้าสแกนแล้วพิมพ์ทะเบียน+เบอร์โทร 4 ตัวท้ายเองเพื่อดูสถานะรถ
                </p>
                <img src={qrData.qr_data_url} alt="QR ติดตามสถานะ" style={{ width: '100%', maxWidth: 260, margin: '12px auto' }} />
                <p style={{ fontSize: 12, color: '#6b7280', wordBreak: 'break-all' }}>{qrData.tracking_url}</p>
              </>
            )}
            <div className="modal-actions">
              {qrData && <button type="button" className="btn-primary" onClick={() => window.print()}>🖨️ พิมพ์</button>}
              <button type="button" onClick={() => { setQrData(null); setQrError(''); }}>ปิด</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
