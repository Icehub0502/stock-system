import React, { useEffect, useState } from 'react';
import client from '../api/client';
import ClaimFormModal from '../components/ClaimFormModal';

const formatThaiDate = (dateInput) => (dateInput ? new Date(dateInput).toLocaleDateString('th-TH') : '-');

// รายการเคลม — บันทึกอิสระ ไม่ผูกกับใบเสร็จ/ใบเสนอราคาเดิม (เก็บแค่ลูกค้า+รถ+อาการ
// ที่เคลม+อะไหล่ที่เปลี่ยน) ไม่มี status/workflow ตามที่เจ้าของร้านสั่ง — โครงหน้าตาม
// WarrantyManagementPage.jsx (search + ตาราง) แต่ปุ่มเพิ่ม/แก้ไขเปิด ClaimFormModal
// แทนฟอร์มเล็กในโมดัลเดียวกัน เพราะต้องค้นหา+เลือกรถก่อน
export default function ClaimManagementPage() {
  const [claims, setClaims] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingClaim, setEditingClaim] = useState(null);

  const fetchClaims = async (searchTerm = search) => {
    try {
      setLoading(true);
      const res = await client.get('/claims', { params: searchTerm ? { search: searchTerm } : {} });
      setClaims(res.data.data || []);
    } catch (err) {
      console.error('Error loading claims:', err);
      setError('โหลดรายการเคลมไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchClaims(); }, []);

  useEffect(() => {
    const timer = setTimeout(() => fetchClaims(search), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const openAdd = () => {
    setEditingClaim(null);
    setShowForm(true);
  };

  const openEdit = async (row) => {
    try {
      const res = await client.get(`/claims/${row.id}`);
      setEditingClaim(res.data.data);
      setShowForm(true);
    } catch (err) {
      alert(err.response?.data?.error || 'โหลดเคลมไม่สำเร็จ');
    }
  };

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

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>เคลม</h1>
          <p className="subtitle">บันทึกลูกค้า/รถที่มาเคลม และอะไหล่ที่เปลี่ยน</p>
        </div>
        <div className="quotation-actions">
          <input
            type="text"
            className="search-input"
            placeholder="ค้นหาทะเบียนรถ, ชื่อลูกค้า, หรือเบอร์โทร..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn btn-primary" onClick={openAdd}>+ เพิ่มเคลม</button>
        </div>
      </div>
      {error && <div className="error-message">{error}</div>}
      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : claims.length === 0 ? (
        <div className="empty-message">ยังไม่มีรายการเคลม</div>
      ) : (
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead>
              <tr>
                <th>เลขที่เคลม</th>
                <th>วันที่</th>
                <th>ลูกค้า</th>
                <th>รถ</th>
                <th>อาการ/สิ่งที่เคลม</th>
                <th>จำนวนรายการ</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id}>
                  <td data-label="เลขที่เคลม">{c.claim_no}</td>
                  <td data-label="วันที่">{formatThaiDate(c.claim_date)}</td>
                  <td data-label="ลูกค้า">{c.customer_name} {c.phone ? `· ${c.phone}` : ''}</td>
                  <td data-label="รถ">{c.license_plate || '-'} · {c.brand} {c.model}</td>
                  <td data-label="อาการ/สิ่งที่เคลม">{c.symptom || '-'}</td>
                  <td data-label="จำนวนรายการ">{c.item_count}</td>
                  <td className="actions" data-label="จัดการ">
                    <button onClick={() => openEdit(c)}>แก้ไข</button>
                    <button className="btn-danger" onClick={() => deleteClaim(c.id)}>ลบ</button>
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
    </div>
  );
}
