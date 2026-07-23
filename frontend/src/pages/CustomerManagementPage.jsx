import React, { useEffect, useState } from 'react';
import client from '../api/client';

export default function CustomerManagementPage() {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ customer_name: '', phone: '' });
  const [saving, setSaving] = useState(false);

  const fetchCustomers = async () => {
    try {
      setLoading(true);
      const res = await client.get('/customers', { params: { search } });
      setCustomers(res.data.data || []);
    } catch (err) {
      console.error('Error loading customers:', err);
      setError('โหลดลูกค้าไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchCustomers();
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const openAdd = () => {
    setEditing(null);
    setForm({ customer_name: '', phone: '' });
    setShowModal(true);
    setError('');
  };

  const openEdit = (customer) => {
    setEditing(customer);
    setForm({
      customer_name: customer.customer_name || '',
      phone: customer.phone || '',
    });
    setShowModal(true);
    setError('');
  };

  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
    setForm({ customer_name: '', phone: '' });
    setError('');
  };

  const saveCustomer = async (e) => {
    e.preventDefault();
    if (saving) return; // กันกดปุ่มบันทึกซ้ำ (double-click) ยิง request ซ้ำ — เคยทำให้
    // บอทดันข้อความอัปเดตเข้ากลุ่มไลน์ซ้ำสองรอบสำหรับการแก้ไขครั้งเดียว
    if (!form.customer_name.trim()) {
      setError('กรุณากรอกชื่อลูกค้า');
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await client.put(`/customers/${editing.id}`, form);
      } else {
        await client.post('/customers', form);
      }
      closeModal();
      fetchCustomers();
    } catch (err) {
      console.error('Save customer error:', err);
      setError(err.response?.data?.error || 'บันทึกลูกค้าไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const deleteCustomer = async (id) => {
    if (!window.confirm('คุณแน่ใจว่าจะลบลูกค้ารายนี้หรือไม่?')) return;
    try {
      await client.delete(`/customers/${id}`);
      fetchCustomers();
    } catch (err) {
      console.error('Delete customer error:', err);
      alert(err.response?.data?.error || 'ลบลูกค้าไม่สำเร็จ');
    }
  };

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>จัดการลูกค้า</h1>
          <p className="subtitle">เพิ่ม แก้ไข และค้นหาลูกค้า</p>
        </div>
        <div className="quotation-actions">
          <input
            type="text"
            className="search-input"
            placeholder="ค้นหาชื่อ เบอร์ หรือรหัสลูกค้า..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn btn-primary" onClick={openAdd}>
            + เพิ่มลูกค้า
          </button>
        </div>
      </div>
      {error && <div className="error-message">{error}</div>}
      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : customers.length === 0 ? (
        <div className="empty-message">ไม่พบลูกค้า</div>
      ) : (
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead>
              <tr>
                <th>รหัสลูกค้า</th>
                <th>ชื่อลูกค้า</th>
                <th>โทรศัพท์</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td data-label="รหัสลูกค้า">{customer.customer_code}</td>
                  <td data-label="ชื่อลูกค้า">{customer.customer_name}</td>
                  <td data-label="โทรศัพท์">{customer.phone || '-'}</td>
                  <td className="actions" data-label="จัดการ">
                    <button onClick={() => openEdit(customer)}>แก้ไข</button>
                    <button className="btn-danger" onClick={() => deleteCustomer(customer.id)}>
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
              <h2>{editing ? 'แก้ไขลูกค้า' : 'เพิ่มลูกค้าใหม่'}</h2>
              <button className="btn-close" onClick={closeModal}>✕</button>
            </div>
            {error && <div className="error-message">{error}</div>}
            <form onSubmit={saveCustomer} className="modal-form">
              <div className="form-group">
                <label>ชื่อลูกค้า</label>
                <input
                  type="text"
                  name="customer_name"
                  value={form.customer_name}
                  onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>โทรศัพท์</label>
                <input
                  type="tel"
                  name="phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={closeModal} disabled={saving}>
                  ยกเลิก
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
