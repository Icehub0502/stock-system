import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import client from '../api/client';
import RepairNoticePrintModal from '../components/RepairNoticePrintModal';
import '../styles/repairNotice.css';

export default function RepairNoticeListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [printingId, setPrintingId] = useState(null);
  // Shown after returning here from a successful save on the edit screen.
  const [toast, setToast] = useState(location.state?.toast || '');

  useEffect(() => {
    if (!location.state?.toast) return;
    window.history.replaceState({}, '');
    const t = setTimeout(() => setToast(''), 2500);
    return () => clearTimeout(t);
  }, []);

  const fetchNotices = async () => {
    try {
      setLoading(true);
      const res = await client.get('/repair-notices');
      setNotices(res.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotices();
  }, []);

  const filtered = notices.filter((n) =>
    n.code?.toLowerCase().includes(search.toLowerCase()) ||
    n.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
    n.license_plate?.toLowerCase().includes(search.toLowerCase()) ||
    String(n.queue_no || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = async (id) => {
    if (!window.confirm('ต้องการลบใบแจ้งซ่อมนี้หรือไม่?')) return;
    try {
      await client.delete(`/repair-notices/${id}`);
      setNotices((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      alert(err.response?.data?.error || 'ลบไม่สำเร็จ');
    }
  };

  return (
    <div className="rnl-page">
      <div className="rnl-container">
        <div className="rnl-header">
          <div>
            <h1 className="rnl-h1">ใบแจ้งซ่อม / รายการซ่อม</h1>
            <p className="rnl-hsub">รายการตรวจเช็คช่วงล่างทั้งหมด · กดพิมพ์ได้จากหน้านี้</p>
          </div>
          <div className="rnl-tools">
            <input
              type="text"
              className="rnl-search"
              placeholder="ค้นหาเลขที่, คิว, ชื่อลูกค้า, ทะเบียน..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="rnl-new" onClick={() => navigate('/repair-notices/new')}>+ สร้างใบแจ้งซ่อม</button>
          </div>
        </div>

        {error && <div className="rnf2-err">{error}</div>}

        {loading ? (
          <div className="rnl-loading">กำลังโหลด...</div>
        ) : filtered.length === 0 ? (
          <div className="rnl-empty">ไม่มีข้อมูลใบแจ้งซ่อม</div>
        ) : (
          <div className="rnl-grid">
            {filtered.map((n) => (
              <div key={n.id} className="rnl-card">
                <div className="rnl-top">
                  <div>
                    <div className="rnl-code">{n.code}</div>
                    <div className="rnl-date">{new Date(n.notice_date).toLocaleDateString('th-TH')}</div>
                  </div>
                  <div className="rnl-queue">
                    <div className="rnl-queue-label">คิว</div>
                    <div className="rnl-queue-num">{n.queue_no || '—'}</div>
                  </div>
                </div>

                <div className="rnl-lines">
                  <div>{n.customer_name || '-'}</div>
                  <div>{n.brand} {n.model} {n.color ? `/ ${n.color}` : ''} · <strong>{n.license_plate || '-'}</strong></div>
                  <div className="rnl-mut">
                    ตรวจเช็ค: {n.checked_by || '-'} · ซ่อม: {n.repaired_by || '-'}
                  </div>
                </div>

                <div className="rnl-actions">
                  <button className="rnl-btn" onClick={() => navigate(`/repair-notices/${n.id}`)}>แจ้งซ่อม</button>
                  <button className="rnl-btn rnl-btn-print" onClick={() => setPrintingId(n.id)}>พิมพ์</button>
                  <button className="rnl-btn rnl-btn-danger" onClick={() => handleDelete(n.id)}>ลบ</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {printingId && (
        <RepairNoticePrintModal noticeId={printingId} onClose={() => setPrintingId(null)} />
      )}

      {toast && <div className="rnf2-toast">{toast}</div>}
    </div>
  );
}
