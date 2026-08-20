import React, { useEffect, useState } from 'react';
import client from '../api/client';

const emptyForm = {
  sku: '',
  name: '',
  position: 'lower',  // upper | lower
  axle: 'front',       // front | rear
  side: 'left',       // left | right
  stock_qty: 0,
  min_stock: 1,
};

const POSITION_LABEL = { upper: 'บน', lower: 'ล่าง' };
const SIDE_LABEL     = { left: 'ซ้าย', right: 'ขวา' };

const SIDE_OPTIONS = [
  { value: 'left',  label: '◀ ซ้าย' },
  { value: 'right', label: '▶ ขวา' },
];
const POSITION_OPTIONS = [
  { value: 'upper', label: '▲ บน' },
  { value: 'lower', label: '▼ ล่าง' },
];

export default function WingArmDashboard() {
  const [items, setItems]               = useState([]);
  const [form, setForm]                 = useState(emptyForm);
  const [editingId, setEditingId]       = useState(null);
  const [errorMsg, setErrorMsg]         = useState('');
  const [qrPreview, setQrPreview]       = useState(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [searchTerm, setSearchTerm]     = useState('');

  // ── filter แถบบน ──
  const [filterSide, setFilterSide]         = useState('');
  const [filterPosition, setFilterPosition] = useState('');

  // ── select & print ──
  const [selectMode, setSelectMode]   = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [printLoading, setPrintLoading] = useState(false);
  const [printQueue, setPrintQueue]   = useState([]);

  // ── กรองเฉพาะของใกล้หมด/หมด + พิมพ์เอกสารรายการ (คนละปุ่มกับพิมพ์ QR) ──
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [docPrintMode, setDocPrintMode] = useState(false);

  // ── stock modal ──
  const [stockModal, setStockModal]   = useState(null);
  const [stockDelta, setStockDelta]   = useState('');
  const [stockNote, setStockNote]     = useState('');
  const [stockType, setStockType]     = useState('IN');
  const [stockError, setStockError]   = useState('');

  const loadItems = async () => {
    const res = await client.get('/wing-arms');
    setItems(res.data);
  };

  useEffect(() => { loadItems(); }, []);

  useEffect(() => {
    if (printQueue.length === 0) return;
    const t = setTimeout(() => window.print(), 250);
    return () => clearTimeout(t);
  }, [printQueue]);

  useEffect(() => {
    const fn = () => { setPrintQueue([]); setDocPrintMode(false); };
    window.addEventListener('afterprint', fn);
    return () => window.removeEventListener('afterprint', fn);
  }, []);

  useEffect(() => {
    if (!docPrintMode) return;
    const t = setTimeout(() => window.print(), 100);
    return () => clearTimeout(t);
  }, [docPrintMode]);

  // ── filtered list ──
  const filtered = items.filter((r) => {
    const term = searchTerm.trim().toLowerCase();
    const matchText     = !term         || r.sku.toLowerCase().includes(term) || r.name.toLowerCase().includes(term);
    const matchSide     = !filterSide     || r.side     === filterSide;
    const matchPosition = !filterPosition || r.position === filterPosition;
    const matchLowStock = !lowStockOnly   || r.stock_qty <= r.min_stock;
    return matchText && matchSide && matchPosition && matchLowStock;
  });

  // ── helpers ──
  const tagLabel = (r) =>
    `${POSITION_LABEL[r.position]} ${SIDE_LABEL[r.side]}`;

  const openAdd = () => {
    setEditingId(null); setForm(emptyForm); setErrorMsg(''); setShowFormModal(true);
  };
  const openEdit = (item) => {
    setEditingId(item.id);
    setForm({ sku: item.sku, name: item.name, position: item.position,
              axle: item.axle, side: item.side,
              stock_qty: item.stock_qty, min_stock: item.min_stock });
    setErrorMsg(''); setShowFormModal(true);
  };
  const closeFormModal = () => {
    setShowFormModal(false); setEditingId(null); setForm(emptyForm); setErrorMsg('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault(); setErrorMsg('');
    try {
      if (editingId) await client.put(`/wing-arms/${editingId}`, form);
      else           await client.post('/wing-arms', form);
      closeFormModal(); loadItems();
    } catch (err) {
      setErrorMsg(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmId) return;
    await client.delete(`/wing-arms/${deleteConfirmId}`);
    setDeleteConfirmId(null);
    if (editingId === deleteConfirmId) closeFormModal();
    loadItems();
  };

  const handleShowQr = async (id) => {
    const res = await client.get(`/wing-arms/${id}/qrcode`);
    setQrPreview(res.data);
  };
  const handlePrintSingle = () => { if (qrPreview) setPrintQueue([qrPreview]); };

  const toggleSelectMode = () => { setSelectMode((p) => !p); setSelectedIds([]); };
  const toggleSelectOne  = (id) => setSelectedIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const selectAll        = () => setSelectedIds(filtered.map((r) => r.id));
  const clearSelection   = () => setSelectedIds([]);

  const handlePrintSelected = async () => {
    if (!selectedIds.length) return;
    setPrintLoading(true);
    try {
      const results = await Promise.all(
        selectedIds.map((id) => client.get(`/wing-arms/${id}/qrcode`).then((r) => r.data))
      );
      setPrintQueue(results);
    } catch { setErrorMsg('โหลด QR Code บางรายการไม่สำเร็จ'); }
    finally   { setPrintLoading(false); }
  };

  const openStockModal = (item) => {
    setStockModal(item); setStockDelta(''); setStockNote('');
    setStockType('IN'); setStockError('');
  };
  const closeStockModal = () => setStockModal(null);

  const handleStockSubmit = async (e) => {
    e.preventDefault(); setStockError('');
    const qty = parseInt(stockDelta, 10);
    if (!qty || qty <= 0) return setStockError('ระบุจำนวนที่มากกว่า 0');
    const delta = stockType === 'IN' ? qty : -qty;
    try {
      await client.patch(`/wing-arms/${stockModal.id}/stock`, { delta, note: stockNote });
      closeStockModal(); loadItems();
    } catch (err) {
      setStockError(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
    }
  };

  // ── ปุ่ม toggle filter ──
  const ToggleBtn = ({ value, current, onChange, label }) => (
    <button
      type="button"
      onClick={() => onChange(current === value ? '' : value)}
      style={{
        padding: '4px 12px', borderRadius: '20px', fontSize: '13px', cursor: 'pointer',
        border: '1px solid', transition: 'all .15s',
        background: current === value ? 'var(--color-text-primary, #222)' : 'transparent',
        color:      current === value ? 'var(--color-background-primary, #fff)' : 'var(--color-text-secondary, #666)',
        borderColor: current === value ? 'var(--color-text-primary, #222)' : 'var(--color-border-secondary, #ccc)',
      }}
    >
      {label}
    </button>
  );

  // ── Stock Badge ──
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
          ⚠️ {qty} ใกล้หมด
        </span>
      );
    }
    return (
      <span style={{ fontWeight: 600, color: '#15803d' }}>{qty}</span>
    );
  };

  return (
    <div className="office-dashboard container">
      {/* Header */}
      <div className="dashboard-header">
        <h2>จัดการปีกนก</h2>
        <div className="header-actions">
          {!selectMode && (
            <>
              <button type="button" onClick={toggleSelectMode}>🖨️ เลือกพิมพ์ QR</button>
              <button type="button" onClick={() => setDocPrintMode(true)}>🖨️ พิมพ์เอกสาร</button>
              <button className="btn-primary" onClick={openAdd}>+ เพิ่มรายการ</button>
            </>
          )}
          {selectMode && (
            <>
              <button type="button" onClick={selectAll}>เลือกทั้งหมด</button>
              <button type="button" onClick={clearSelection}>ล้างที่เลือก</button>
              <button
                type="button" className="btn-primary"
                disabled={!selectedIds.length || printLoading}
                onClick={handlePrintSelected}
              >
                {printLoading ? 'กำลังโหลด...' : `พิมพ์ QR (${selectedIds.length})`}
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
          placeholder="ค้นหาด้วยรหัส SKU หรือชื่อปีกนก..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searchTerm && (
          <button type="button" className="search-clear" onClick={() => setSearchTerm('')} aria-label="ล้างคำค้นหา">✕</button>
        )}
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '8px 0 12px' }}>
        <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', alignSelf: 'center' }}>กรอง:</span>
        <ToggleBtn value="upper"  current={filterPosition} onChange={setFilterPosition} label="บน" />
        <ToggleBtn value="lower"  current={filterPosition} onChange={setFilterPosition} label="ล่าง" />
        <ToggleBtn value="left"   current={filterSide}     onChange={setFilterSide}     label="ซ้าย" />
        <ToggleBtn value="right"  current={filterSide}     onChange={setFilterSide}     label="ขวา" />
        <button
          type="button"
          onClick={() => setLowStockOnly((v) => !v)}
          style={{
            padding: '4px 12px', borderRadius: '20px', fontSize: '13px', cursor: 'pointer',
            border: '1px solid', transition: 'all .15s',
            background: lowStockOnly ? '#92400e' : 'transparent',
            color: lowStockOnly ? '#fff' : 'var(--color-text-secondary, #666)',
            borderColor: lowStockOnly ? '#92400e' : 'var(--color-border-secondary, #ccc)',
          }}
        >
          ⚠️ ใกล้หมด/หมด
        </button>
        {(filterPosition || filterSide || lowStockOnly) && (
          <button
            type="button"
            onClick={() => { setFilterPosition(''); setFilterSide(''); setLowStockOnly(false); }}
            style={{ fontSize: '12px', color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
          >
            ล้างทั้งหมด
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
              <th>รหัส SKU</th>
              <th>ตำแหน่ง</th>
              <th>รายการปีกนก</th>
              <th>สต็อก</th>
              <th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                {selectMode && (
                  <td data-label="เลือก">
                    <input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggleSelectOne(r.id)} />
                  </td>
                )}
                <td data-label="รหัส SKU">{r.sku}</td>

                {/* ── ตำแหน่ง badge เต็ม cell ── */}
                <td data-label="ตำแหน่ง" style={{ padding: 0 }}>
                  <span style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    height: '100%',
                    padding: '10px 12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    background: r.side === 'left' ? '#dbeafe' : '#fce7f3',
                    color:      r.side === 'left' ? '#1e40af' : '#9d174d',
                  }}>
                    {tagLabel(r)}
                  </span>
                </td>

                <td data-label="รายการ">{r.name}</td>

                {/* ── Stock badge ── */}
                <td data-label="สต็อก">
                  <StockBadge qty={r.stock_qty} minStock={r.min_stock} />
                </td>

                {/* ── ปุ่มจัดการ ── */}
                <td data-label="จัดการ" className="actions">
                  <button onClick={() => openEdit(r)}>แก้ไข</button>
                  <button onClick={() => handleShowQr(r.id)}>QR</button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={selectMode ? 6 : 5} className="no-result-text">
                  {items.length === 0 ? 'ยังไม่มีรายการ' : `ไม่พบรายการที่ตรงกับเงื่อนไข`}
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

              <label>รหัส SKU</label>
              <input
                placeholder="เช่น CHCA005L-LA"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                required
              />

              <label>รายการปีกนก</label>
              <input
                placeholder="เช่น ปีกนกล่าง ซ้าย CHEVROLET AVEO..."
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />

              {/* ตำแหน่ง/ด้าน เลือกได้เฉพาะตอนเพิ่มรายการใหม่เท่านั้น — ตอนแก้ไข
                  รายการเดิม ค่าตำแหน่ง/ด้านเป็นของตายตัวติดกับ SKU นั้นอยู่แล้ว
                  ไม่ต้องเลือกซ้ำและไม่ต้องแสดงด้วย (เจ้าของร้านสั่งให้ตัดออกจากฟอร์ม
                  แก้ไขทั้งหมด) ค่าเดิมยังถูกส่งไปกับฟอร์มตามปกติ (มาจาก form state ที่
                  openEdit ตั้งไว้แล้ว) แค่ไม่มี UI ให้ดู/แก้ตรงนี้อีกต่อไป */}
              {!editingId && (
                <>
                  <label>ตำแหน่ง</label>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    {POSITION_OPTIONS.map((o) => (
                      <button key={o.value} type="button"
                        onClick={() => setForm({ ...form, position: o.value })}
                        style={{
                          flex: 1, padding: '8px', borderRadius: '8px', cursor: 'pointer',
                          border: '2px solid',
                          borderColor: form.position === o.value
                            ? (o.value === 'upper' ? '#0f766e' : '#b45309')
                            : 'var(--color-border-secondary)',
                          background: form.position === o.value
                            ? (o.value === 'upper' ? '#0f766e' : '#b45309')
                            : 'transparent',
                          color: form.position === o.value ? '#fff' : 'var(--color-text-secondary)',
                          fontWeight: form.position === o.value ? 600 : 400,
                        }}
                      >{o.label}</button>
                    ))}
                  </div>

                  <label>ด้าน</label>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    {SIDE_OPTIONS.map((o) => (
                      <button key={o.value} type="button"
                        onClick={() => setForm({ ...form, side: o.value })}
                        style={{
                          flex: 1, padding: '8px', borderRadius: '8px', cursor: 'pointer',
                          border: '2px solid',
                          borderColor: form.side === o.value
                            ? (o.value === 'left' ? '#1e40af' : '#9d174d')
                            : 'var(--color-border-secondary)',
                          background: form.side === o.value
                            ? (o.value === 'left' ? '#1e40af' : '#9d174d')
                            : 'transparent',
                          color: form.side === o.value ? '#fff' : 'var(--color-text-secondary)',
                          fontWeight: form.side === o.value ? 600 : 400,
                        }}
                      >{o.label}</button>
                    ))}
                  </div>
                </>
              )}

              <label>คงเหลือในสต็อก</label>
              <input
                type="number" min="0"
                value={form.stock_qty}
                onChange={(e) => setForm({ ...form, stock_qty: Number(e.target.value) })}
              />

              <label>แจ้งเตือนเมื่อต่ำกว่า</label>
              <input
                type="number" min="0"
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
                <button className="btn-danger btn-full" onClick={() => setDeleteConfirmId(editingId)}>
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

      {/* ── Modal: QR Preview ── */}
      {qrPreview && (
        <div className="modal-backdrop" onClick={() => setQrPreview(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>{qrPreview.name}</h3>
            <p>{qrPreview.sku}</p>
            <img src={qrPreview.qrcode} alt="QR Code" style={{ width: '100%' }} />
            <div className="modal-actions">
              <button onClick={handlePrintSingle}>🖨️ พิมพ์</button>
              <button onClick={() => setQrPreview(null)}>ปิด</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: รับ / เบิกสต็อก ── */}
      {stockModal && (
        <div className="modal-backdrop" onClick={closeStockModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">📦 รับ / เบิกสต็อก</h3>
            <p style={{ marginBottom: '4px' }}><strong>{stockModal.sku}</strong></p>
            <p style={{ marginBottom: '4px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
              {tagLabel(stockModal)}
            </p>
            <p style={{ marginBottom: '16px', fontSize: '14px' }}>{stockModal.name}</p>
            <p>สต็อกปัจจุบัน: <strong>{stockModal.stock_qty}</strong></p>
            <form onSubmit={handleStockSubmit} className="modal-form">
              <label>ประเภท</label>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                {[{ value: 'IN', label: '✅ รับเข้า' }, { value: 'OUT', label: '🔧 เบิกออก' }].map((o) => (
                  <button key={o.value} type="button"
                    onClick={() => setStockType(o.value)}
                    style={{
                      flex: 1, padding: '8px', borderRadius: '8px', cursor: 'pointer',
                      border: '2px solid',
                      borderColor: stockType === o.value ? 'var(--color-text-primary)' : 'var(--color-border-secondary)',
                      background:  stockType === o.value ? 'var(--color-text-primary)' : 'transparent',
                      color:       stockType === o.value ? 'var(--color-background-primary)' : 'var(--color-text-secondary)',
                    }}
                  >{o.label}</button>
                ))}
              </div>
              <label>จำนวน</label>
              <input type="number" min="1" placeholder="0" value={stockDelta} onChange={(e) => setStockDelta(e.target.value)} required />
              <label>หมายเหตุ</label>
              <input type="text" placeholder="เช่น รับจากซัพพลายเออร์" value={stockNote} onChange={(e) => setStockNote(e.target.value)} />
              {stockError && <p className="error-text">{stockError}</p>}
              <div className="modal-actions">
                <button type="submit" className="btn-primary">บันทึก</button>
                <button type="button" onClick={closeStockModal}>ยกเลิก</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Print Area (QR) ── */}
      <div id="qr-print-area">
        {printQueue.map((item) => (
          <div className="qr-print-label" key={item.sku}>
            <img src={item.qrcode} alt={item.sku} />
            <div className="qr-print-text">
              <div className="qr-print-code">{item.sku}</div>
              <div className="qr-print-name">{item.name}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── พื้นที่สำหรับพิมพ์เอกสารรายการ (ตาราง ไม่ใช่ QR) ── */}
      {docPrintMode && (
        <div id="stock-doc-print-area">
          <h2>รายการปีกนก{lowStockOnly ? ' — เฉพาะที่ใกล้หมด/หมด' : ''}</h2>
          <p>พิมพ์เมื่อ {new Date().toLocaleString('th-TH')}</p>
          <table>
            <thead>
              <tr>
                <th>รหัส SKU</th>
                <th>ตำแหน่ง</th>
                <th>รายการ</th>
                <th>คงเหลือ</th>
                <th>แจ้งเตือนเมื่อต่ำกว่า</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.sku}</td>
                  <td>{tagLabel(r)}</td>
                  <td>{r.name}</td>
                  <td>{r.stock_qty}</td>
                  <td>{r.min_stock}</td>
                  <td>{r.stock_qty === 0 ? 'หมด' : r.stock_qty <= r.min_stock ? 'ใกล้หมด' : 'ปกติ'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}