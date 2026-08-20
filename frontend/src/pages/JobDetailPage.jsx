import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import client from '../api/client';
import { jobStatusDef } from '../utils/jobStatus';
import { formatDbDateTime } from '../utils/format';

/**
 * รายละเอียดงาน 1 คัน — แสดงข้อมูลรถ/ลูกค้า/อาการ, ประวัติสถานะ, และช่องผูกใบ
 * เสนอราคา ไม่ได้สร้างใบเสนอราคาจากในนี้ (เจ้าของร้านสั่ง: ตรวจเช็คเสร็จแล้วค่อย
 * ไปสร้างที่หน้าใบเสนอราคาปกติ — ฟอร์มนั้นมีระบบค้นหาลูกค้า/รถของตัวเองอยู่แล้ว)
 * กลับมาที่นี่แค่ "ผูก" เลขที่ใบที่สร้างไว้แล้วเข้ากับงาน ด้วยการค้นหาเลขที่/ทะเบียน
 */
export default function JobDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [quoteQuery, setQuoteQuery] = useState('');
  const [quotes, setQuotes] = useState([]);
  const [linking, setLinking] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const res = await client.get(`/jobs/${id}`);
      setJob(res.data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'โหลดข้อมูลงานไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  // เปิดตัวค้นหาใบเสนอราคาเฉพาะตอนยังไม่มีใบผูกไว้ — โหลดทั้งชุดครั้งเดียวมากรอง
  // ฝั่ง client (แบบเดียวกับหน้าอื่นในระบบ) เลขที่ใบไม่กี่ร้อยใบ ไม่ต้องทำ search API แยก
  useEffect(() => {
    if (job && !job.quotation_id) {
      client.get('/quotations').then((res) => setQuotes(res.data.data || []));
    }
  }, [job?.id, job?.quotation_id]);

  const matchedQuotes = useMemo(() => {
    const term = quoteQuery.trim().toLowerCase();
    if (!term) return [];
    return quotes
      .filter((q) => q.quotation_no?.toLowerCase().includes(term) || q.license_plate?.toLowerCase().includes(term))
      .slice(0, 10);
  }, [quotes, quoteQuery]);

  async function linkQuotation(quotationId) {
    setLinking(true);
    setError('');
    try {
      await client.patch(`/jobs/${id}/quotation`, { quotation_id: quotationId });
      await load();
      setQuoteQuery('');
    } catch (err) {
      setError(err.response?.data?.error || 'ผูกใบเสนอราคาไม่สำเร็จ');
    } finally {
      setLinking(false);
    }
  }

  if (loading) return <div className="office-dashboard container"><div className="loading">กำลังโหลด...</div></div>;
  if (!job) return <div className="office-dashboard container"><div className="error-message">{error || 'ไม่พบงานนี้'}</div></div>;

  const st = jobStatusDef(job.status);

  return (
    <div className="office-dashboard container">
      <div className="dashboard-header">
        <h2>{job.job_no} <span className="dashboard-header-sub">— คิว {job.queue_no || '-'}</span></h2>
        <button type="button" onClick={() => navigate('/jobs')}>← กลับรายการงาน</button>
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">ข้อมูลรถ / ลูกค้า</div>
        <p><strong>ทะเบียน:</strong> {job.license_plate || '-'}</p>
        <p><strong>รถ:</strong> {job.brand} {job.model} {job.color && `· ${job.color}`}</p>
        <p><strong>ลูกค้า:</strong> {job.customer_name || '-'} {job.phone && `(${job.phone})`}</p>
        <p><strong>เลขไมล์:</strong> {job.mileage_in ?? '-'}</p>
        <p><strong>อาการที่แจ้ง:</strong> {job.symptom || '-'}</p>
        {job.note && <p><strong>หมายเหตุ:</strong> {job.note}</p>}
        <p><strong>สถานะปัจจุบัน:</strong> <span className={`status-badge ${st.badge}`}>{st.label}</span></p>
        <p><strong>ช่องยก:</strong> {job.bay || '-'}</p>
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">ใบเสนอราคา</div>
        {job.quotation_id ? (
          <p>
            เลขที่ <strong>{job.quotation_no}</strong> — สถานะ {job.quotation_status}
            {' '}(<Link to="/quotations">ดูรายการใบเสนอราคา</Link>)
          </p>
        ) : (
          <>
            <p style={{ color: '#92400e', fontSize: 14 }}>⚠️ ยังไม่ได้ผูกใบเสนอราคา — สร้างที่หน้าใบเสนอราคาก่อน แล้วค้นเลขที่มาผูกที่นี่</p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <Link to="/quotations" className="btn-primary" style={{ textDecoration: 'none', padding: '8px 16px', borderRadius: 8 }}>
                ไปสร้างใบเสนอราคา
              </Link>
            </div>
            <input
              type="text"
              placeholder="ค้นหาด้วยเลขที่ใบเสนอราคา หรือทะเบียนรถ..."
              value={quoteQuery}
              onChange={(e) => setQuoteQuery(e.target.value)}
            />
            {matchedQuotes.length > 0 && (
              <ul className="job-quote-suggest">
                {matchedQuotes.map((q) => (
                  <li key={q.id}>
                    <span>{q.quotation_no} — {q.license_plate} {q.brand} {q.model}</span>
                    <button type="button" disabled={linking} onClick={() => linkQuotation(q.id)}>ผูกใบนี้</button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">ประวัติสถานะ</div>
        <ul className="job-history-list">
          {(job.history || []).map((h, i) => (
            <li key={i}>
              <span className={`status-badge ${jobStatusDef(h.status).badge}`}>{jobStatusDef(h.status).label}</span>
              <span className="job-history-time">{formatDbDateTime(h.changed_at)}</span>
              <span className="job-history-by">{h.full_name || h.username || '-'}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
