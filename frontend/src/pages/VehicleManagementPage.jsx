import React, { useEffect, useState } from 'react';
import client from '../api/client';
import { getNameInitials } from '../utils/format';

export default function VehicleManagementPage() {
  const [vehicles, setVehicles] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ customer_id: '', brand: '', model: '', color: '', license_plate: '', mileage: 0 });
  const [saving, setSaving] = useState(false);

  const fetchCustomers = async () => {
    try {
      const res = await client.get('/customers');
      setCustomers(res.data.data || []);
    } catch (err) {
      console.error('Error loading customers:', err);
    }
  };

  const fetchVehicles = async () => {
    try {
      setLoading(true);
      const res = await client.get('/vehicles');
      setVehicles(res.data.data || []);
    } catch (err) {
      console.error('Error loading vehicles:', err);
      setError('โหลดข้อมูลรถไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
    fetchVehicles();
  }, []);

  const openAdd = () => {
    setEditing(null);
    setForm({ customer_id: '', brand: '', model: '', color: '', license_plate: '', mileage: 0 });
    setShowModal(true);
    setError('');
  };

  const openEdit = (vehicle) => {
    setEditing(vehicle);
    setForm({
      customer_id: vehicle.customer_id,
      brand: vehicle.brand || '',
      model: vehicle.model || '',
      color: vehicle.color || '',
      license_plate: vehicle.license_plate || '',
      mileage: vehicle.mileage || 0,
    });
    setShowModal(true);
    setError('');
  };

  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
    setForm({ customer_id: '', brand: '', model: '', color: '', license_plate: '', mileage: 0 });
    setError('');
  };

  const saveVehicle = async (e) => {
    e.preventDefault();
    if (saving) return; // กันกดปุ่มบันทึกซ้ำ (double-click) ยิง request ซ้ำ — เคยทำให้
    // บอทดันข้อความอัปเดตเข้ากลุ่มไลน์ซ้ำสองรอบสำหรับการแก้ไขครั้งเดียว
    if (!form.customer_id || !form.brand.trim() || !form.model.trim()) {
      setError('กรุณากรอกข้อมูลรถให้ครบถ้วน');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await client.put(`/vehicles/${editing.id}`, form);
      } else {
        await client.post('/vehicles', form);
      }
      closeModal();
      fetchVehicles();
    } catch (err) {
      console.error('Save vehicle error:', err);
      setError(err.response?.data?.error || 'บันทึกข้อมูลรถไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const deleteVehicle = async (id) => {
    if (!window.confirm('คุณแน่ใจว่าจะลบข้อมูลรถคันนี้หรือไม่?')) return;
    try {
      await client.delete(`/vehicles/${id}`);
      fetchVehicles();
    } catch (err) {
      console.error('Delete vehicle error:', err);
      alert(err.response?.data?.error || 'ลบข้อมูลรถไม่สำเร็จ');
    }
  };

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>จัดการรถลูกค้า</h1>
          <p className="subtitle">เพิ่ม แก้ไข และดูรายละเอียดรถของลูกค้า</p>
        </div>
        <div className="quotation-actions">
          <input
            type="text"
            className="search-input"
            placeholder="ค้นหายี่ห้อ รุ่น หรือทะเบียน..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn btn-primary" onClick={openAdd}>
            + เพิ่มรถ
          </button>
        </div>
      </div>
      {error && <div className="error-message">{error}</div>}
      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : vehicles.filter((vehicle) => {
        const term = search.toLowerCase();
        return (
          vehicle.brand?.toLowerCase().includes(term) ||
          vehicle.model?.toLowerCase().includes(term) ||
          vehicle.license_plate?.toLowerCase().includes(term) ||
          vehicle.customer_name?.toLowerCase().includes(term) ||
          vehicle.customer_code?.toLowerCase().includes(term)
        );
      }).length === 0 ? (
        <div className="empty-message">ไม่พบข้อมูลรถ</div>
      ) : (
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead>
              <tr>
                <th>ลูกค้า</th>
                <th>ยี่ห้อ/รุ่น</th>
                <th>ทะเบียน</th>
                <th>ไมล์</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.filter((vehicle) => {
                const term = search.toLowerCase();
                return (
                  vehicle.brand?.toLowerCase().includes(term) ||
                  vehicle.model?.toLowerCase().includes(term) ||
                  vehicle.license_plate?.toLowerCase().includes(term) ||
                  vehicle.customer_name?.toLowerCase().includes(term) ||
                  vehicle.customer_code?.toLowerCase().includes(term)
                );
              }).map((vehicle) => (
                <tr key={vehicle.id}>
                  <td data-label="ลูกค้า">
                    <span className="row-name-cell">
                      <span className="row-avatar" aria-hidden="true">{getNameInitials(vehicle.customer_name)}</span>
                      {vehicle.customer_name} ({vehicle.customer_code})
                    </span>
                  </td>
                  <td data-label="ยี่ห้อ/รุ่น">{vehicle.brand} {vehicle.model}</td>
                  <td data-label="ทะเบียน">{vehicle.license_plate || '-'}</td>
                  <td data-label="ไมล์">{vehicle.mileage ?? 0}</td>
                  <td className="actions" data-label="จัดการ">
                    <button onClick={() => openEdit(vehicle)}>แก้ไข</button>
                    <button className="btn-danger" onClick={() => deleteVehicle(vehicle.id)}>
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
              <h2>{editing ? 'แก้ไขรถ' : 'เพิ่มรถลูกค้า'}</h2>
              <button className="btn-close" onClick={closeModal}>✕</button>
            </div>
            {error && <div className="error-message">{error}</div>}
            <form onSubmit={saveVehicle} className="modal-form">
              <div className="form-group">
                <label>เลือกลูกค้า</label>
                <select
                  value={form.customer_id}
                  onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
                  required
                >
                  <option value="">-- เลือกลูกค้า --</option>
                  {customers.map((cust) => (
                    <option key={cust.id} value={cust.id}>
                      {cust.customer_code} · {cust.customer_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>ยี่ห้อ</label>
                <input
                  type="text"
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>รุ่น</label>
                <input
                  type="text"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>สี</label>
                <input
                  type="text"
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>ทะเบียน</label>
                <input
                  type="text"
                  value={form.license_plate}
                  onChange={(e) => setForm({ ...form, license_plate: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>เลขไมล์</label>
                <input
                  type="number"
                  min="0"
                  max="9999999"
                  value={form.mileage}
                  onChange={(e) => setForm({ ...form, mileage: Number(e.target.value) })}
                />
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={closeModal} disabled={saving}>ยกเลิก</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
