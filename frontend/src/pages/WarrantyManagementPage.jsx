import React, { useEffect, useState } from 'react';
import client from '../api/client';

export default function WarrantyManagementPage() {
  const [warranties, setWarranties] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ warranty_name: '', warranty_year: 0, warranty_month: 0, warranty_km: 0, is_active: true });

  const fetchWarranties = async () => {
    try {
      setLoading(true);
      const res = await client.get('/warranties');
      setWarranties(res.data.data || []);
    } catch (err) {
      console.error('Error loading warranties:', err);
      setError('โหลดการรับประกันไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWarranties();
  }, []);

  const openAdd = () => {
    setEditing(null);
    setForm({ warranty_name: '', warranty_year: 0, warranty_month: 0, warranty_km: 0, is_active: true });
    setShowModal(true);
    setError('');
  };

  const openEdit = (warranty) => {
    setEditing(warranty);
    setForm({
      warranty_name: warranty.warranty_name || '',
      warranty_year: warranty.warranty_year || 0,
      warranty_month: warranty.warranty_month || 0,
      warranty_km: warranty.warranty_km || 0,
      is_active: !!warranty.is_active,
    });
    setShowModal(true);
    setError('');
  };

  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
    setForm({ warranty_name: '', warranty_year: 0, warranty_month: 0, warranty_km: 0, is_active: true });
    setError('');
  };

  const saveWarranty = async (e) => {
    e.preventDefault();
    if (!form.warranty_name.trim()) {
      setError('กรุณากรอกชื่อการรับประกัน');
      return;
    }
    try {
      if (editing) {
        await client.put(`/warranties/${editing.id}`, form);
      } else {
        await client.post('/warranties', form);
      }
      closeModal();
      fetchWarranties();
    } catch (err) {
      console.error('Save warranty error:', err);
      setError(err.response?.data?.error || 'บันทึกการรับประกันไม่สำเร็จ');
    }
  };

  const deleteWarranty = async (id) => {
    if (!window.confirm('คุณแน่ใจว่าจะลบการรับประกันนี้หรือไม่?')) return;
    try {
      await client.delete(`/warranties/${id}`);
      fetchWarranties();
    } catch (err) {
      console.error('Delete warranty error:', err);
      alert(err.response?.data?.error || 'ลบการรับประกันไม่สำเร็จ');
    }
  };

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>จัดการการรับประกัน</h1>
          <p className="subtitle">ตั้งค่าระยะเวลาและระยะกิโลเมตรสำหรับการรับประกัน</p>
        </div>
        <div className="quotation-actions">
          <input
            type="text"
            className="search-input"
            placeholder="ค้นหาชื่อการรับประกัน..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn btn-primary" onClick={openAdd}>
            + เพิ่มการรับประกัน
          </button>
        </div>
      </div>
      {error && <div className="error-message">{error}</div>}
      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : warranties.filter((w) => w.warranty_name.toLowerCase().includes(search.toLowerCase())).length === 0 ? (
        <div className="empty-message">ไม่พบการรับประกัน</div>
      ) : (
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead>
              <tr>
                <th>ชื่อการรับประกัน</th>
                <th>ปี</th>
                <th>เดือน</th>
                <th>กม.</th>
                <th>สถานะ</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {warranties.filter((w) => w.warranty_name.toLowerCase().includes(search.toLowerCase())).map((warranty) => (
                <tr key={warranty.id}>
                  <td data-label="ชื่อการรับประกัน">{warranty.warranty_name}</td>
                  <td data-label="ปี">{warranty.warranty_year}</td>
                  <td data-label="เดือน">{warranty.warranty_month}</td>
                  <td data-label="กม.">{warranty.warranty_km}</td>
                  <td data-label="สถานะ">{warranty.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}</td>
                  <td className="actions" data-label="จัดการ">
                    <button onClick={() => openEdit(warranty)}>แก้ไข</button>
                    <button className="btn-danger" onClick={() => deleteWarranty(warranty.id)}>
                      ลบ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal-card medium" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editing ? 'แก้ไขการรับประกัน' : 'เพิ่มการรับประกันใหม่'}</h2>
              <button className="btn-close" onClick={closeModal}>✕</button>
            </div>
            {error && <div className="error-message">{error}</div>}
            <form onSubmit={saveWarranty} className="modal-form">
              <div className="form-group">
                <label>ชื่อการรับประกัน</label>
                <input
                  type="text"
                  value={form.warranty_name}
                  onChange={(e) => setForm({ ...form, warranty_name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>ระยะเวลา (ปี)</label>
                <input
                  type="number"
                  min="0"
                  value={form.warranty_year}
                  onChange={(e) => setForm({ ...form, warranty_year: Number(e.target.value) })}
                />
              </div>
              <div className="form-group">
                <label>ระยะเวลา (เดือน)</label>
                <input
                  type="number"
                  min="0"
                  value={form.warranty_month}
                  onChange={(e) => setForm({ ...form, warranty_month: Number(e.target.value) })}
                />
              </div>
              <div className="form-group">
                <label>ระยะทาง (กม.)</label>
                <input
                  type="number"
                  min="0"
                  value={form.warranty_km}
                  onChange={(e) => setForm({ ...form, warranty_km: Number(e.target.value) })}
                />
              </div>
              <div className="form-group">
                <label>สถานะ</label>
                <select
                  value={form.is_active ? '1' : '0'}
                  onChange={(e) => setForm({ ...form, is_active: e.target.value === '1' })}
                >
                  <option value="1">ใช้งาน</option>
                  <option value="0">ปิดใช้งาน</option>
                </select>
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary">บันทึก</button>
                <button type="button" className="btn btn-secondary" onClick={closeModal}>ยกเลิก</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
