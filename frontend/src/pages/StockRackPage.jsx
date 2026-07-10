import React, { useEffect, useState } from 'react';
import client from '../api/client';

const emptyForm = { model_code: '', name: '', stock_qty: 0, min_stock: 1 };

// ── Stock Badge Component ──
const StockBadge = ({ qty, minStock }) => {
  if (qty === 0) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        background: '#fee2e2', color: '#991b1b',
        border: '1px solid #fca5a5',
        borderRadius: '20px', padding: '3px 10px',
        fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap',
      }}>
        ❌ หมด
      </span>
    );
  }
  if (qty <= minStock) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        background: '#fef9c3', color: '#92400e',
        border: '1px solid #fde68a',
        borderRadius: '20px', padding: '3px 10px',
        fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap',
      }}>
        ⚠️ {qty} ต่ำ
      </span>
    );
  }
  return (
    <span style={{ fontWeight: 600, color: '#15803d' }}>{qty}</span>
  );
};

export default function StockRackPage() {
  const [racks, setRacks] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [qrPreview, setQrPreview] = useState(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  // ── เลือกหลายรายการเพื่อพิมพ์ QR ──
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [printLoading, setPrintLoading] = useState(false);
  const [printQueue, setPrintQueue] = useState([]);

  const loadRacks = async () => {
    const res = await client.get('/racks');
    setRacks(res.data);
  };

  useEffect(() => { loadRacks(); }, []);

  useEffect(() => {
    if (printQueue.length === 0) return;
    const timer = setTimeout(() => window.print(), 250);
    return () => clearTimeout(timer);
  }, [printQueue]);

  useEffect(() => {
    const handleAfterPrint = () => setPrintQueue([]);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, []);

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
    if (editingId === deleteConfirmId) closeFormModal();
    loadRacks();
  };

  const handleShowQr = async (id) => {
    const res = await client.get(`/racks/${id}/qrcode`);
    setQrPreview(res.data);
  };

  const toggleSelectMode = () => {
    setSelectMode((prev) => !prev);
    setSelectedIds([]);
  };

  const toggleSelectOne = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAllFiltered = () => {
    setSelectedIds(filteredRacks.map((r) => r.id));
  };

  const clearSelection = () => setSelectedIds([]);

  const handlePrintSelected = async () => {
    const validIds = selectedIds.filter((id) => racks.some((r) => r.id === id));
    if (validIds.length === 0) return;
    setPrintLoading(true);
    setErrorMsg('');
    try {
      const results = await Promise.all(
        validIds.map((id) => client.get(`/racks/${id}/qrcode`).then((res) => res.data))
      );
      setPrintQueue(results);
    } catch (err) {
      setErrorMsg('โหลด QR Code บางรายการไม่สำเร็จ ลองใหม่อีกครั้ง');
    } finally {
      setPrintLoading(false);
    }
  };

  const handlePrintSingle = () => {
    if (qrPreview) setPrintQueue([qrPreview]);
  };

  return (
    <div className="office-dashboard container">
      {/* Header */}
      <div className="dashboard-header">
        <h2>StockRack <span className="dashboard-header-sub">— จัดการรายการแร็ค OEM</span></h2>
        <div className="header-actions">
          {!selectMode && (
            <>
              <button type="button" onClick={toggleSelectMode}>
                🖨️ เลือกพิมพ์ QR
              </button>
              <button className="btn-primary" onClick={openAdd}>+ เพิ่มรายการ</button>
            </>
          )}
          {selectMode && (
            <>
              <button type="button" onClick={selectAllFiltered}>เลือกทั้งหมด</button>
              <button type="button" onClick={clearSelection}>ล้างที่เลือก</button>
              <button
                type="button"
                className="btn-primary"
                disabled={selectedIds.length === 0 || printLoading}
                onClick={handlePrintSelected}
              >
                {printLoading ? 'กำลังโหลด...' : `พิมพ์ QR ที่เลือก (${selectedIds.length})`}
              </button>
              <button type="button" onClick={toggleSelectMode}>ยกเลิก</button>
            </>
          )}
        </div>
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

      {errorMsg && !showFormModal && <p className="error-text">{errorMsg}</p>}

      {/* Table */}
      <div className="table-wrapper">
        <table className="rack-table">
          <thead>
            <tr>
              {selectMode && <th></th>}
              <th>รหัสรุ่น</th>
              <th>รายการแร็ค OEM</th>
              <th>สต็อก</th>
              <th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {filteredRacks.map((r) => (
              <tr key={r.id}>
                {selectMode && (
                  <td data-label="เลือก">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(r.id)}
                      onChange={() => toggleSelectOne(r.id)}
                    />
                  </td>
                )}
                <td data-label="รหัสรุ่น">{r.model_code}</td>
                <td data-label="รายการ">{r.name}</td>
                <td data-label="สต็อก">
                  <StockBadge qty={r.stock_qty} minStock={r.min_stock} />
                </td>
                <td data-label="จัดการ" className="actions">
                  <button onClick={() => openEdit(r)}>แก้ไข</button>
                  <button onClick={() => handleShowQr(r.id)}>QR</button>
                </td>
              </tr>
            ))}
            {filteredRacks.length === 0 && (
              <tr>
                <td colSpan={selectMode ? 5 : 4} className="no-result-text">
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

      {/* ── Modal: QR Code (พรีวิวรายการเดียว) ── */}
      {qrPreview && (
        <div className="modal-backdrop" onClick={() => setQrPreview(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>{qrPreview.name}</h3>
            <p>{qrPreview.model_code}</p>
            <img src={qrPreview.qrcode} alt="QR Code" style={{ width: '100%' }} />
            <div className="modal-actions">
              <button onClick={handlePrintSingle}>🖨️ พิมพ์</button>
              <button onClick={() => setQrPreview(null)}>ปิด</button>
            </div>
          </div>
        </div>
      )}

      {/* ── พื้นที่สำหรับพิมพ์ QR ── */}
      <div id="qr-print-area">
        {printQueue.map((item) => (
          <div className="qr-print-label" key={item.model_code}>
            <img src={item.qrcode} alt={item.model_code} />
            <div className="qr-print-text">
              <div className="qr-print-code">{item.model_code}</div>
              <div className="qr-print-name">{item.name}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}