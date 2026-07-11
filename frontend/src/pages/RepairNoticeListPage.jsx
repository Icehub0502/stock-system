import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import RepairNoticePrintModal from '../components/RepairNoticePrintModal';

export default function RepairNoticeListPage() {
  const navigate = useNavigate();
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [printingId, setPrintingId] = useState(null);

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
    n.license_plate?.toLowerCase().includes(search.toLowerCase())
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
    <div className="quotation-page">
      <div className="quotation-header">
        <h1>ใบแจ้งซ่อม / รายการซ่อม</h1>
        <div className="quotation-actions">
          <input
            type="text"
            className="search-input"
            placeholder="ค้นหาเลขที่, ชื่อลูกค้า, หรือทะเบียน..."
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
                <th>เลขที่</th>
                <th>วันที่</th>
                <th>ชื่อลูกค้า</th>
                <th>รุ่น/สี/ทะเบียน</th>
                <th>ตรวจเช็คโดย</th>
                <th>ซ่อมโดย</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((n) => (
                <tr key={n.id}>
                  <td data-label="เลขที่"><strong>{n.code}</strong></td>
                  <td data-label="วันที่">{new Date(n.notice_date).toLocaleDateString('th-TH')}</td>
                  <td data-label="ชื่อลูกค้า">{n.customer_name || '-'}</td>
                  <td className="car-info" data-label="รุ่น/สี/ทะเบียน">
                    {n.brand} {n.model} {n.color ? `/ ${n.color}` : ''} / {n.license_plate || '-'}
                  </td>
                  <td data-label="ตรวจเช็คโดย">{n.checked_by || '-'}</td>
                  <td data-label="ซ่อมโดย">{n.repaired_by || '-'}</td>
                  <td className="actions" data-label="จัดการ">
                    <button className="btn-icon-small" onClick={() => navigate(`/repair-notices/${n.id}`)}>
                      แก้ไข
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
            </tbody>
          </table>
        </div>
      )}

      {printingId && (
        <RepairNoticePrintModal noticeId={printingId} onClose={() => setPrintingId(null)} />
      )}
    </div>
  );
}
