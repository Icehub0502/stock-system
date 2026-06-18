import React, { useEffect, useState } from 'react';
import client from '../api/client';

const emptyForm = { model_code: '', name: '', stock_qty: 0, min_stock: 1 };

export default function OfficeDashboard() {
  const [racks, setRacks] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [qrPreview, setQrPreview] = useState(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const loadRacks = async () => {
    const res = await client.get('/racks');
    setRacks(res.data);
  };

  useEffect(() => { loadRacks(); }, []);

  // ── Search (client-side filter จากข้อมูลที่โหลดมาแล้ว) ──
  const filteredRacks = racks.filter((r) => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return true;
    return (
      r.model_code.toLowerCase().includes(term) ||
      r.name.toLowerCase().includes(term)
    );
  });

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setErrorMsg('');
    setShowFormModal(true);
  };

  const openEdit = (rack) => {
    setEditingId(rack.id);
    setForm({
      model_code: rack.model_code,
      name: rack.name,
      stock_qty: rack.stock_qty,
      min_stock: rack.min_stock,
    });
    setErrorMsg('');
    setShowFormModal(true);
  };

  const closeFormModal = () => {
    setShowFormModal(false);
    setEditingId(null);
    setForm(emptyForm);
    setErrorMsg('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      if (editingId) {
        await client.put(`/racks/${editingId}`, form);
      } else {
        await client.post('/racks', form);
      }
      closeFormModal();
      loadRacks();
    } catch (err) {
      setErrorMsg(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmId) return;
    await client.delete(`/racks/${deleteConfirmId}`);
    setDeleteConfirmId(null);
    // ถ้า modal แก้ไขเปิดอยู่ให้ปิดด้วย
    if (editingId === deleteConfirmId) closeFormModal();
    loadRacks();
  };

  const handleShowQr = async (id) => {
    const res = await client.get(`/racks/${id}/qrcode`);
    setQrPreview(res.data);
  };

  return (
    <div className="office-dashboard container">
      {/* Header */}
      <div className="dashboard-header">
        <h2>จัดการรายการแร็ค OEM</h2>
        <button className="btn-primary" onClick={openAdd}>+ เพิ่มรายการ</button>
      </div>

      {/* Search */}
      <div className="search-bar">
        <input
          type="text"
          placeholder="ค้นหาด้วยรหัสรุ่น หรือชื่อรายการ..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searchTerm && (
          <button
            type="button"
            className="search-clear"
            onClick={() => setSearchTerm('')}
            aria-label="ล้างคำค้นหา"
          >
            ✕
          </button>
        )}
      </div>

      {/* Table */}
      <div className="table-wrapper">
        <table className="rack-table">
          <thead>
            <tr>
              <th>รหัสรุ่น</th>
              <th>รายการแร็ค OEM</th>
              <th>สต็อก</th>
              <th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {filteredRacks.map((r) => (
              <tr key={r.id} className={r.stock_qty <= r.min_stock ? 'low-stock' : ''}>
                <td data-label="รหัสรุ่น">{r.model_code}</td>
                <td data-label="รายการ">{r.name}</td>
                <td data-label="สต็อก">
                  <span className="stock-value">
                    {r.stock_qty}
                    {r.stock_qty <= r.min_stock && <span className="warn-badge">⚠️ ต่ำ</span>}
                  </span>
                </td>
                <td data-label="จัดการ" className="actions">
                  <button onClick={() => openEdit(r)}>แก้ไข</button>
                  <button onClick={() => handleShowQr(r.id)}>QR</button>
                </td>
              </tr>
            ))}
            {filteredRacks.length === 0 && (
              <tr>
                <td colSpan={4} className="no-result-text">
                  {racks.length === 0
                    ? 'ยังไม่มีรายการ'
                    : `ไม่พบรายการที่ตรงกับ "${searchTerm}"`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Modal: เพิ่ม / แก้ไข ── */}
      {showFormModal && (
        <div className="modal-backdrop" onClick={closeFormModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">
              {editingId ? '✏️ แก้ไขรายการ' : '➕ เพิ่มรายการใหม่'}
            </h3>

            <form onSubmit={handleSubmit} className="modal-form">
              <label>รหัสรุ่น</label>
              <input
                placeholder="เช่น RTTO5201"
                value={form.model_code}
                onChange={(e) => setForm({ ...form, model_code: e.target.value })}
                required
              />

              <label>รายการแร็ค OEM</label>
              <input
                placeholder="ชื่อรายการ"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />

              <label>คงเหลือในสต็อก</label>
              <input
                type="number"
                min="0"
                value={form.stock_qty}
                onChange={(e) => setForm({ ...form, stock_qty: Number(e.target.value) })}
              />

              <label>แจ้งเตือนเมื่อต่ำกว่า</label>
              <input
                type="number"
                min="0"
                value={form.min_stock}
                onChange={(e) => setForm({ ...form, min_stock: Number(e.target.value) })}
              />

              {errorMsg && <p className="error-text">{errorMsg}</p>}

              <div className="modal-actions">
                <button type="submit" className="btn-primary">
                  {editingId ? 'บันทึกการแก้ไข' : 'เพิ่มรายการ'}
                </button>
                <button type="button" onClick={closeFormModal}>ยกเลิก</button>
              </div>
            </form>

            {/* ── ปุ่มลบ อยู่ด้านล่าง modal แก้ไขเท่านั้น ── */}
            {editingId && (
              <div className="modal-delete-zone">
                <hr />
                <button
                  className="btn-danger btn-full"
                  onClick={() => setDeleteConfirmId(editingId)}
                >
                  🗑️ ลบรายการนี้
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modal: ยืนยันลบ ── */}
      {deleteConfirmId && (
        <div className="modal-backdrop" onClick={() => setDeleteConfirmId(null)}>
          <div className="modal-card modal-warning" onClick={(e) => e.stopPropagation()}>
            <h3>⚠️ ยืนยันการลบ</h3>
            <p>คุณต้องการลบรายการนี้ใช่หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้</p>
            <div className="modal-actions">
              <button className="btn-danger" onClick={handleDelete}>ยืนยันลบ</button>
              <button onClick={() => setDeleteConfirmId(null)}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: QR Code ── */}
      {qrPreview && (
        <div className="modal-backdrop" onClick={() => setQrPreview(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>{qrPreview.name}</h3>
            <p>{qrPreview.model_code}</p>
            <img src={qrPreview.qrcode} alt="QR Code" style={{ width: '100%' }} />
            <div className="modal-actions">
              <button onClick={() => window.print()}>🖨️ พิมพ์</button>
              <button onClick={() => setQrPreview(null)}>ปิด</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}