import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import client from '../api/client';
import RepairNoticePrintModal from '../components/RepairNoticePrintModal';
import RepairNoticeModal from '../components/RepairNoticeModal';
import '../styles/repairNotice.css';

export default function RepairNoticeListPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [printingId, setPrintingId] = useState(null);
  const [editingId, setEditingId] = useState(null);
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

  // Group by notice_date (newest day first) so the list reads as "N ใบวันนี้,
  // M ใบเมื่อวาน..." instead of one long scattered grid — sort explicitly by
  // notice_date rather than relying on the backend's created_at ordering,
  // since a notice's date can be edited away from when it was created.
  const groups = useMemo(() => {
    const sorted = [...filtered].sort((a, b) => new Date(b.notice_date) - new Date(a.notice_date));
    const out = [];
    let current = null;
    for (const n of sorted) {
      const dateKey = n.notice_date;
      if (!current || current.dateKey !== dateKey) {
        current = { dateKey, rows: [] };
        out.push(current);
      }
      current.rows.push(n);
    }
    return out;
  }, [filtered]);

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
          groups.map((group) => (
            <div key={group.dateKey} className="rnl-date-group">
              <div className="rnl-date-group-header">
                <span className="rnl-date-group-date">
                  {new Date(group.dateKey).toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </span>
                <span className="rnl-date-group-count">{group.rows.length} ใบ</span>
              </div>
              <div className="rnl-grid">
                {group.rows.map((n) => (
                  <div key={n.id} className="rnl-card">
                    <div className="rnl-top">
                      <div className="rnl-code">{n.code}</div>
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
                      <button className="rnl-btn" onClick={() => setEditingId(n.id)}>แจ้งซ่อม</button>
                      <button className="rnl-btn rnl-btn-print" onClick={() => setPrintingId(n.id)}>พิมพ์</button>
                      <button className="rnl-btn rnl-btn-danger" onClick={() => handleDelete(n.id)}>ลบ</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {printingId && (
        <RepairNoticePrintModal noticeId={printingId} onClose={() => setPrintingId(null)} />
      )}

      {editingId && (
        <RepairNoticeModal
          id={editingId}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
            setToast('บันทึกการแก้ไขสำเร็จ');
            fetchNotices();
            setTimeout(() => setToast(''), 2500);
          }}
        />
      )}

      {toast && <div className="rnf2-toast">{toast}</div>}
    </div>
  );
}
