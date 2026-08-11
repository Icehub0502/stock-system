import React, { useEffect, useMemo, useState } from 'react';
import client from '../api/client';

// รวมรายการจาก racks + wing_arms มาค้นหา/เลือกในหน้าเดียว (แค่ระดับหน้าเว็บ ไม่ได้
// รวมตารางฐานข้อมูลจริง — เจ้าของร้านเลือกไม่รวมเพราะมี QR code พิมพ์ติดชั้นวางจริง
// ที่อ้างอิง endpoint เดิมของแต่ละระบบอยู่แล้ว) กดตัดสต๊อกแล้วเรียก endpoint เดิมของ
// แต่ละระบบตรง ๆ (POST /transactions/out สำหรับแร็ค, PATCH /wing-arms/:id/stock
// สำหรับปีกนก) ไม่เขียนตรรกะตัดสต๊อกซ้ำเลย — จุดใหม่จริง ๆ มีแค่ช่องยี่ห้อ/รุ่นรถ
// (ไม่บังคับกรอก) ที่ทั้งสอง endpoint เพิ่งรองรับให้บันทึกลง transactions.vehicle_brand/
// vehicle_model เพื่อเอาไปสรุปในหน้ารายงาน (ดู StockUsageReportPage.jsx)
export default function StockDeductionPage() {
  const [racks, setRacks] = useState([]);
  const [wingArms, setWingArms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  const [qty, setQty] = useState('');
  const [brands, setBrands] = useState([]);
  const [brand, setBrand] = useState('');
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const loadItems = async () => {
    try {
      setLoading(true);
      const [racksRes, wingArmsRes] = await Promise.all([
        client.get('/racks'),
        client.get('/wing-arms'),
      ]);
      setRacks(racksRes.data || []);
      setWingArms(wingArmsRes.data || []);
    } catch (err) {
      setErrorMsg('โหลดรายการอะไหล่ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadItems(); }, []);

  useEffect(() => {
    client.get('/vehicle-models/brands').then((res) => setBrands(res.data.data || []));
  }, []);

  useEffect(() => {
    if (!brand) { setModels([]); setModel(''); return; }
    client.get('/vehicle-models/models', { params: { brand } }).then((res) => setModels(res.data.data || []));
  }, [brand]);

  const combined = useMemo(() => [
    ...racks.map((r) => ({ type: 'rack', id: r.id, code: r.model_code, name: r.name, stock_qty: r.stock_qty })),
    ...wingArms.map((w) => ({ type: 'wing_arm', id: w.id, code: w.sku, name: w.name, stock_qty: w.stock_qty })),
  ], [racks, wingArms]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return combined;
    return combined.filter((it) => it.code.toLowerCase().includes(term) || it.name.toLowerCase().includes(term));
  }, [combined, search]);

  const selectItem = (item) => {
    setSelected(item);
    setSearch('');
    setQty('');
    setErrorMsg('');
    setSuccessMsg('');
  };

  const resetForm = () => {
    setSelected(null);
    setQty('');
    setBrand('');
    setModel('');
    setNote('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    const quantity = Number(qty);
    if (!selected) return setErrorMsg('กรุณาเลือกอะไหล่ก่อน');
    if (!quantity || quantity <= 0) return setErrorMsg('กรุณาระบุจำนวนที่มากกว่า 0');
    if (quantity > selected.stock_qty) return setErrorMsg(`สต๊อกเหลือไม่พอ (คงเหลือ ${selected.stock_qty})`);

    setSubmitting(true);
    try {
      if (selected.type === 'rack') {
        await client.post('/transactions/out', {
          model_code: selected.code,
          qty: quantity,
          note,
          vehicle_brand: brand || null,
          vehicle_model: model || null,
        });
      } else {
        await client.patch(`/wing-arms/${selected.id}/stock`, {
          delta: -quantity,
          note,
          vehicle_brand: brand || null,
          vehicle_model: model || null,
        });
      }
      setSuccessMsg(`ตัดสต๊อก "${selected.name}" จำนวน ${quantity} สำเร็จ`);
      resetForm();
      loadItems();
    } catch (err) {
      setErrorMsg(err.response?.data?.error || 'ตัดสต๊อกไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="office-dashboard container">
      <div className="dashboard-header">
        <h2>ตัดสต๊อก <span className="dashboard-header-sub">— เบิกอะไหล่ออกจากสต็อก (แร็ค/ปีกนก)</span></h2>
      </div>

      {!selected && (
        <>
          <div className="search-bar">
            <input
              type="text"
              placeholder="ค้นหาด้วยรหัสรุ่น/SKU หรือชื่อรายการ..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button type="button" className="search-clear" onClick={() => setSearch('')} aria-label="ล้างคำค้นหา">✕</button>
            )}
          </div>

          {loading ? (
            <div className="loading">กำลังโหลด...</div>
          ) : (
            <div className="table-wrapper">
              <table className="rack-table">
                <thead>
                  <tr>
                    <th>ประเภท</th>
                    <th>รหัส</th>
                    <th>รายการ</th>
                    <th>สต็อกคงเหลือ</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((it) => (
                    <tr key={`${it.type}-${it.id}`} className="clickable-row" onClick={() => selectItem(it)}>
                      <td data-label="ประเภท">{it.type === 'rack' ? 'แร็ค' : 'ปีกนก'}</td>
                      <td data-label="รหัส">{it.code}</td>
                      <td data-label="รายการ">{it.name}</td>
                      <td data-label="สต็อกคงเหลือ">{it.stock_qty}</td>
                      <td data-label=""><button type="button" className="btn-primary">เลือก</button></td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={5} className="no-result-text">
                        {combined.length === 0 ? 'ยังไม่มีรายการอะไหล่ในสต๊อก' : `ไม่พบรายการที่ตรงกับ "${search}"`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {selected && (
        <div className="modal-card" style={{ maxWidth: 480 }}>
          <h3 className="modal-title">📦 ตัดสต๊อก: {selected.name}</h3>
          <p style={{ marginBottom: 4 }}><strong>รหัส:</strong> {selected.code}</p>
          <p style={{ marginBottom: 16 }}><strong>สต็อกคงเหลือ:</strong> {selected.stock_qty}</p>

          <form onSubmit={handleSubmit} className="modal-form">
            <label>จำนวนที่ตัดออก</label>
            <input
              type="number"
              min="1"
              max={selected.stock_qty}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              required
            />

            <label>ยี่ห้อรถ (ไม่บังคับ — กรอกเพื่อใช้ทำรายงานสรุปทีหลัง)</label>
            <select value={brand} onChange={(e) => { setBrand(e.target.value); setModel(''); }}>
              <option value="">-- ไม่ระบุ --</option>
              {brands.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>

            {brand && (
              <>
                <label>รุ่นรถ</label>
                <select value={model} onChange={(e) => setModel(e.target.value)}>
                  <option value="">-- ไม่ระบุ --</option>
                  {models.map((m) => (
                    <option key={m.model} value={m.model}>{m.label}</option>
                  ))}
                </select>
              </>
            )}

            <label>หมายเหตุ</label>
            <input type="text" placeholder="เช่น คิว 12 / ใบเสร็จ IV..." value={note} onChange={(e) => setNote(e.target.value)} />

            {errorMsg && <p className="error-text">{errorMsg}</p>}

            <div className="modal-actions">
              <button type="submit" className="btn-danger" disabled={submitting}>
                {submitting ? 'กำลังบันทึก...' : 'ยืนยันตัดสต๊อก'}
              </button>
              <button type="button" onClick={resetForm} disabled={submitting}>ยกเลิก</button>
            </div>
          </form>
        </div>
      )}

      {successMsg && <p style={{ color: '#15803d', fontWeight: 600, marginTop: 12 }}>✅ {successMsg}</p>}
    </div>
  );
}
