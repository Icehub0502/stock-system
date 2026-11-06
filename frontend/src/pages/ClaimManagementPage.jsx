import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import client from '../api/client';
import ClaimFormModal from '../components/ClaimFormModal';
import ClaimPartsModal from '../components/ClaimPartsModal';
import { useAuth } from '../context/AuthContext';
import { canChange } from '../utils/roles';
import { CASE_STATUS, CASE_TYPE_LABEL, OUTCOME_LABEL } from '../utils/claimCases';
import { formatDateTh } from '../utils/dateGroups';

const formatThaiDate = (dateInput) => (dateInput ? new Date(dateInput).toLocaleDateString('th-TH') : '-');

// รายการเคส: มาแก้งาน + เคลมอะไหล่ เก็บอาการ สิ่งที่ตรวจพบ วิธีแก้ และสถานะจนปิดเคส ค้นเคสเก่าจากรุ่นรถ/อาการ/
// วิธีแก้/อะไหล่ได้ เพื่อใช้เป็นตัวอย่างเมื่อเจอปัญหาเดิม ส่วนการโทรติดตามอยู่ที่หน้า FollowUpPage.jsx
// โครงหน้าตาม WarrantyManagementPage.jsx (search + ตาราง) แต่ปุ่มเพิ่ม/แก้ไขเปิด ClaimFormModal
// แทนฟอร์มเล็กในโมดัลเดียวกัน เพราะต้องค้นหา+เลือกรถก่อน
export default function ClaimManagementPage() {
  const { user } = useAuth();
  const mayEdit = canChange(user, 'office');
  const isManager = canChange(user, 'manager');
  const [searchParams, setSearchParams] = useSearchParams();
  const [claims, setClaims] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingClaim, setEditingClaim] = useState(null);
  const [partsClaimId, setPartsClaimId] = useState(null);

  const fetchClaims = async () => {
    try {
      setLoading(true);
      const params = {};
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const res = await client.get('/claims', { params });
      setClaims(res.data.data || []);
    } catch (err) {
      console.error('Error loading claims:', err);
      setError('โหลดรายการเคลมไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(fetchClaims, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter]);

  const openAdd = () => {
    setEditingClaim(null);
    setShowForm(true);
  };

  const openEdit = async (id) => {
    try {
      const res = await client.get(`/claims/${id}`);
      setEditingClaim(res.data.data);
      setShowForm(true);
    } catch (err) {
      alert(err.response?.data?.error || 'โหลดเคลมไม่สำเร็จ');
    }
  };

  // "แก้ไขเคส" จากหน้าติดตามผล ส่งเลขเคสมาทาง ?open=
  useEffect(() => {
    const id = Number(searchParams.get('open'));
    if (!id) return;
    setSearchParams({}, { replace: true });
    openEdit(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeForm = () => {
    setShowForm(false);
    setEditingClaim(null);
  };

  const handleSaved = () => {
    closeForm();
    fetchClaims();
  };

  const deleteClaim = async (id) => {
    if (!window.confirm('คุณแน่ใจว่าจะลบเคลมนี้หรือไม่?')) return;
    try {
      await client.delete(`/claims/${id}`);
      fetchClaims();
    } catch (err) {
      alert(err.response?.data?.error || 'ลบเคลมไม่สำเร็จ');
    }
  };

  const reopenCase = async (id) => {
    if (!window.confirm('เปิดเคสนี้ใหม่หรือไม่?')) return;
    try {
      await client.post(`/claims/${id}/reopen`);
      fetchClaims();
    } catch (err) {
      alert(err.response?.data?.error || 'เปิดเคสใหม่ไม่สำเร็จ');
    }
  };

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>เคสแก้งาน / เคลม</h1>
          <p className="subtitle">บันทึกรถที่กลับมาแก้และอะไหล่ที่เคลม พร้อมวิธีแก้ ค้นเคสเก่าเพื่อดูแนวทางได้</p>
        </div>
        <div className="quotation-actions">
          <input
            type="text"
            className="search-input"
            placeholder="ค้นหาทะเบียน รุ่นรถ อาการ วิธีแก้ หรืออะไหล่..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="กรองตามสถานะ">
            <option value="">ทุกสถานะ</option>
            {Object.entries(CASE_STATUS).map(([value, s]) => <option key={value} value={value}>{s.label}</option>)}
          </select>
          {mayEdit && <Link to="/follow-ups" className="btn btn-secondary">ติดตามผล</Link>}
          {mayEdit && <button className="btn btn-primary" onClick={openAdd}>+ เปิดเคสใหม่</button>}
        </div>
      </div>
      {error && <div className="error-message">{error}</div>}
      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : claims.length === 0 ? (
        <div className="empty-message">ไม่พบเคส</div>
      ) : (
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead>
              <tr>
                <th>เลขที่</th>
                <th>วันที่</th>
                <th>ประเภท</th>
                <th>สถานะ</th>
                <th>ลูกค้า</th>
                <th>รถ</th>
                <th>อาการ</th>
                <th>วิธีแก้</th>
                <th>จำนวนรายการ</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id}>
                  <td data-label="เลขที่">{c.claim_no}</td>
                  <td data-label="วันที่">{formatThaiDate(c.claim_date)}</td>
                  <td data-label="ประเภท">{CASE_TYPE_LABEL[c.case_type] || '-'}</td>
                  <td data-label="สถานะ">
                    <span className={`status-badge ${CASE_STATUS[c.status]?.badge || 'status-badge-neutral'}`}>{CASE_STATUS[c.status]?.label || c.status}</span>
                    {c.outcome && <div className="vh-muted">{OUTCOME_LABEL[c.outcome]}</div>}
                    {c.next_follow_up && c.status !== 'continued' && <div className="vh-muted">โทร {formatDateTh(c.next_follow_up)}</div>}
                  </td>
                  <td data-label="ลูกค้า">{c.customer_name} {c.phone ? `· ${c.phone}` : ''}</td>
                  <td data-label="รถ">{c.license_plate || '-'} · {c.brand} {c.model}</td>
                  <td data-label="อาการ">{c.symptom || '-'}</td>
                  <td data-label="วิธีแก้">{c.resolution || '-'}</td>
                  <td data-label="จำนวนรายการ">{c.item_count}</td>
                  <td className="actions" data-label="จัดการ">
                    {mayEdit && <button onClick={() => openEdit(c.id)}>แก้ไข</button>}
                    <button onClick={() => setPartsClaimId(c.id)}>อะไหล่ / เก็บเงิน</button>
                    {isManager && c.status === 'closed' && <button onClick={() => reopenCase(c.id)}>เปิดเคสใหม่</button>}
                    {isManager && <button className="btn-danger" onClick={() => deleteClaim(c.id)}>ลบ</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <ClaimFormModal claim={editingClaim} onClose={closeForm} onSaved={handleSaved} />
      )}
      {partsClaimId && <ClaimPartsModal claimId={partsClaimId} onClose={() => setPartsClaimId(null)} />}
    </div>
  );
}
