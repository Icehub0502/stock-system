import React, { useEffect, useState } from 'react';
import client from '../api/client';

const emptyForm = { category: '', product_name: '', warranty_id: '', is_set: false, components: [{ component_name: '', default_qty: 1 }] };

export default function ServiceItemManagementPage() {
  const [items, setItems] = useState([]);
  const [warranties, setWarranties] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const fetchWarrantyList = async () => {
    try {
      const res = await client.get('/warranties');
      setWarranties(res.data.data || []);
    } catch (err) {
      console.error('Error loading warranties:', err);
    }
  };

  const fetchItems = async () => {
    try {
      setLoading(true);
      const res = await client.get('/service-items', { params: { search } });
      setItems(res.data.data || []);
    } catch (err) {
      console.error('Error loading service items:', err);
      setError('โหลดรายการสินค้า/บริการไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWarrantyList();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchItems();
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowModal(true);
    setError('');
  };

  const openEdit = async (item) => {
    setEditing(item);
    setError('');
    if (item.is_set) {
      try {
        const res = await client.get(`/service-items/${item.id}/components`);
        const components = res.data.data || [];
        setForm({
          category: item.category || '',
          product_name: item.product_name || '',
          warranty_id: item.warranty_id || '',
          is_set: true,
          components: components.length > 0
            ? components.map((c) => ({ component_name: c.component_name, default_qty: c.default_qty }))
            : [{ component_name: '', default_qty: 1 }],
        });
      } catch (err) {
        console.error('Error loading set components:', err);
        setForm({ ...emptyForm, category: item.category || '', product_name: item.product_name || '', warranty_id: item.warranty_id || '', is_set: true });
      }
    } else {
      setForm({
        category: item.category || '',
        product_name: item.product_name || '',
        warranty_id: item.warranty_id || '',
        is_set: false,
        components: [{ component_name: '', default_qty: 1 }],
      });
    }
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
    setForm(emptyForm);
    setError('');
  };

  const setComponentField = (index, field, value) => {
    setForm((prev) => {
      const next = [...prev.components];
      next[index] = { ...next[index], [field]: field === 'default_qty' ? Number(value) : value };
      return { ...prev, components: next };
    });
  };

  const addComponentRow = () => {
    setForm((prev) => ({ ...prev, components: [...prev.components, { component_name: '', default_qty: 1 }] }));
  };

  const removeComponentRow = (index) => {
    setForm((prev) => ({ ...prev, components: prev.components.filter((_, idx) => idx !== index) }));
  };

  const saveItem = async (e) => {
    e.preventDefault();
    if (!form.category.trim() || !form.product_name.trim()) {
      setError('กรุณากรอกหมวดและชื่อรายการ');
      return;
    }
    if (form.is_set && form.components.filter((c) => c.component_name.trim()).length === 0) {
      setError('กรุณาเพิ่มรายการย่อยของชุดอย่างน้อยหนึ่งรายการ');
      return;
    }
    try {
      const payload = {
        category: form.category,
        product_name: form.product_name,
        warranty_id: form.warranty_id || null,
        is_set: form.is_set,
        components: form.is_set ? form.components.filter((c) => c.component_name.trim()) : [],
      };
      if (editing) {
        await client.put(`/service-items/${editing.id}`, { ...payload, is_active: 1 });
      } else {
        await client.post('/service-items', payload);
      }
      closeModal();
      fetchItems();
    } catch (err) {
      console.error('Save service item error:', err);
      setError(err.response?.data?.error || 'บันทึกรายการสินค้าบริการไม่สำเร็จ');
    }
  };

  const deleteItem = async (id) => {
    if (!window.confirm('คุณแน่ใจว่าจะลบรายการนี้หรือไม่?')) return;
    try {
      await client.delete(`/service-items/${id}`);
      fetchItems();
    } catch (err) {
      console.error('Delete service item error:', err);
      alert(err.response?.data?.error || 'ลบรายการไม่สำเร็จ');
    }
  };

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>จัดการรายการสินค้า/บริการ</h1>
          <p className="subtitle">เพิ่ม แก้ไข และจัดการรายการบริการพร้อมการรับประกัน หรือจัดชุดสินค้าหลายรายการย่อย</p>
        </div>
        <div className="quotation-actions">
          <input
            type="text"
            className="search-input"
            placeholder="ค้นหาหมวดหรือชื่อรายการ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn btn-primary" onClick={openAdd}>
            + เพิ่มรายการ
          </button>
        </div>
      </div>
      {error && !showModal && <div className="error-message">{error}</div>}
      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : items.length === 0 ? (
        <div className="empty-message">ไม่พบรายการ</div>
      ) : (
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead>
              <tr>
                <th>หมวด</th>
                <th>รายการ</th>
                <th>ประเภท</th>
                <th>การรับประกัน</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td data-label="หมวด">{item.category}</td>
                  <td data-label="รายการ">{item.product_name}</td>
                  <td data-label="ประเภท">{item.is_set ? <span className="status-badge status-badge-warning">📦 ชุด</span> : <span className="status-badge status-badge-neutral">รายการเดี่ยว</span>}</td>
                  <td data-label="การรับประกัน">{item.warranty_name || '-'}</td>
                  <td className="actions" data-label="จัดการ">
                    <button onClick={() => openEdit(item)}>แก้ไข</button>
                    <button className="btn-danger" onClick={() => deleteItem(item.id)}>
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
              <h2>{editing ? 'แก้ไขรายการ' : 'เพิ่มรายการใหม่'}</h2>
              <button className="btn-close" onClick={closeModal}>✕</button>
            </div>
            {error && <div className="error-message">{error}</div>}
            <form onSubmit={saveItem} className="modal-form">
              <div className="form-group">
                <label>หมวด</label>
                <input
                  type="text"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>ชื่อรายการ{form.is_set ? ' (ชื่อชุด)' : ''}</label>
                <input
                  type="text"
                  value={form.product_name}
                  onChange={(e) => setForm({ ...form, product_name: e.target.value })}
                  placeholder={form.is_set ? 'เช่น ชุดโปรช่วงล่าง รถยนต์' : ''}
                  required
                />
              </div>

              <div className="form-group checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={form.is_set}
                    onChange={(e) => setForm({ ...form, is_set: e.target.checked })}
                  />
                  {' '}เป็นชุดสินค้า (มีหลายรายการย่อย)
                </label>
              </div>

              <div className="form-group">
                <label>การรับประกัน{form.is_set ? ' (ใช้กับทั้งชุด)' : ''}</label>
                <select
                  value={form.warranty_id || ''}
                  onChange={(e) => setForm({ ...form, warranty_id: e.target.value || null })}
                >
                  <option value="">ไม่มีการรับประกัน</option>
                  {warranties.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.warranty_name} ({w.warranty_year} ปี / {w.warranty_km.toLocaleString()} กม)
                    </option>
                  ))}
                </select>
              </div>

              {form.is_set && (
                <div className="form-group">
                  <label>รายการย่อยในชุด</label>
                  {form.components.map((comp, idx) => (
                    <div key={idx} className="set-component-row">
                      <input
                        type="text"
                        className="set-component-name"
                        placeholder="เช่น ปีกนกล่าง 1 คู่"
                        value={comp.component_name}
                        onChange={(e) => setComponentField(idx, 'component_name', e.target.value)}
                      />
                      <input
                        type="number"
                        className="set-component-qty"
                        min="1"
                        step="1"
                        value={comp.default_qty}
                        onChange={(e) => setComponentField(idx, 'default_qty', e.target.value)}
                        title="จำนวนเริ่มต้น"
                      />
                      <button
                        type="button"
                        className="btn-remove"
                        onClick={() => removeComponentRow(idx)}
                        disabled={form.components.length === 1}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button type="button" className="btn btn-secondary" onClick={addComponentRow}>
                    + เพิ่มรายการย่อย
                  </button>
                </div>
              )}

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
