import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import client from '../api/client';
import RepairNoticePrintModal from '../components/RepairNoticePrintModal';
import RepairNoticeModal from '../components/RepairNoticeModal';
import '../styles/repairNotice.css';

// เหมือน isRepairNoticeFilled ฝั่ง backend (quotations.routes.js) — เช็คว่ามีคนกรอก
// เช็คลิสต์/ชื่อผู้ตรวจ/ผู้ซ่อมแล้วหรือยัง เพื่อขึ้น badge สถานะในตาราง
function hasCheckedContent(node) {
  if (node == null) return false;
  if (typeof node === 'boolean') return node === true;
  if (typeof node === 'string') return node.trim() !== '';
  if (typeof node === 'object') return Object.values(node).some(hasCheckedContent);
  return false;
}
function isNoticeFilled(n) {
  if ((n.checked_by && n.checked_by.trim()) || (n.repaired_by && n.repaired_by.trim())) return true;
  return hasCheckedContent(n.checklist);
}

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

  // Group by notice_date (newest day first) so the list reads as one set
  // per day instead of one long scattered table — sort explicitly by
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
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>ใบแจ้งซ่อม / รายการซ่อม</h1>
          <p className="subtitle">รายการตรวจเช็คช่วงล่างทั้งหมด · กดพิมพ์ได้จากหน้านี้</p>
        </div>
        <div className="quotation-actions">
          <input
            type="text"
            className="search-input"
            placeholder="ค้นหาเลขที่, คิว, ชื่อลูกค้า, ทะเบียน..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn btn-primary" onClick={() => navigate('/repair-notices/new')}>
            + สร้างใบแจ้งซ่อม
          </button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-message">ไม่มีข้อมูลใบแจ้งซ่อม</div>
      ) : (
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead>
              <tr>
                <th>รหัสใบแจ้งซ่อม</th>
                <th>ชื่อ</th>
                <th>รถ</th>
                <th>สี</th>
                <th>ทะเบียนรถ</th>
                <th>สถานะ</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <React.Fragment key={group.dateKey}>
                  <tr className="date-group-header-row">
                    <td colSpan={7}>
                      {new Date(group.dateKey).toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                      <span className="date-group-count"> ({group.rows.length} ใบ)</span>
                    </td>
                  </tr>
                  {group.rows.map((n) => (
                    <tr key={n.id}>
                      <td data-label="รหัสใบแจ้งซ่อม">
                        <strong>{n.code}</strong>
                        {n.queue_no ? <span className="rnl-mut"> · คิว {n.queue_no}</span> : null}
                      </td>
                      <td data-label="ชื่อ">{n.customer_name || '-'}</td>
                      <td data-label="รถ">{n.brand} {n.model}</td>
                      <td data-label="สี">{n.color || '-'}</td>
                      <td data-label="ทะเบียนรถ">{n.license_plate || '-'}</td>
                      <td data-label="สถานะ">
                        {isNoticeFilled(n) ? (
                          <span className="status-badge status-badge-success">🔧 แจ้งซ่อมแล้ว</span>
                        ) : (
                          <span className="status-badge status-badge-neutral">⏳ ยังไม่กรอกแจ้งซ่อม</span>
                        )}
                      </td>
                      <td className="actions" data-label="จัดการ">
                        <button className="btn-icon-small" onClick={() => setEditingId(n.id)}>
                          แจ้งซ่อม
                        </button>
                        <button className="btn-icon-small" onClick={() => setPrintingId(n.id)}>
                          พิมพ์
                        </button>
                        <button className="btn-icon-small btn-danger" onClick={() => handleDelete(n.id)}>
                          ลบ
                        </button>
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
