import React, { useEffect, useMemo, useState } from 'react';
import client from '../api/client';

// รวมรายการจาก racks + wing_arms มาค้นหา/เลือกในหน้าเดียว (แค่ระดับหน้าเว็บ ไม่ได้
// รวมตารางฐานข้อมูลจริง — เจ้าของร้านเลือกไม่รวมเพราะมี QR code พิมพ์ติดชั้นวางจริง
// ที่อ้างอิง endpoint เดิมของแต่ละระบบอยู่แล้ว) กดตัดสต๊อกแล้วเรียก endpoint เดิมของ
// แต่ละระบบตรง ๆ ไม่เขียนตรรกะตัดสต๊อกซ้ำเลย — เลือกอะไหล่แล้วเลือก "รุ่นรถ" แบบ
// 2 ขั้น (ยี่ห้อก่อน แล้วค่อยรุ่น) จากแคตตาล็อก vehicle_models ที่มีอยู่แล้ว (ใช้
// endpoint เดียวกับหน้าคีออส/จัดการราคาอะไหล่) ไม่เดาให้เลย ให้พนักงานเลือกตรง ๆ
// (เจ้าของร้านสั่งตัดการเดาออก หลังลองใช้ช่องพิมพ์ข้อความอิสระแล้วไม่ชอบ) เอาไปสรุป
// ในหน้ารายงาน (StockUsageReportPage.jsx) — ฟอร์มยืนยันเปิดเป็น modal ทับหน้า
// รายการเดิม (ไม่สลับเนื้อหาทั้งหน้า) ปิด modal แล้วกลับมาเห็นรายการเดิมทันที
//
// ปีกนก (wing_arm) ใช้ทีละคู่เสมอ (ซ้าย+ขวา) — เลือกข้างไหนก็ได้ 1 ตัว ระบบหาคู่
// ให้อัตโนมัติจาก axle/position ตรงกัน + side ตรงข้าม + ชื่อไม่รวมคำว่าซ้าย/ขวาตรงกัน
// แล้วตัดสต๊อกทั้งคู่พร้อมกันผ่าน PATCH /wing-arms/pair-stock (อะตอมิกฝั่ง backend)
// ถ้าหาคู่ไม่เจอ (ข้อมูลไม่ครบ/ตั้งชื่อไม่ตรงกัน) จะตัดได้แค่ข้างที่เลือกพร้อมเตือน
function stripSideWord(name) {
  return String(name || '').replace(/(ซ้าย|ขวา)\s*/, '').trim();
}

function findWingArmPair(item, wingArms) {
  return wingArms.find((w) =>
    w.id !== item.id &&
    w.axle === item.axle &&
    w.position === item.position &&
    w.side !== item.side &&
    stripSideWord(w.name) === stripSideWord(item.name)
  ) || null;
}

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
    ...wingArms.map((w) => ({
      type: 'wing_arm', id: w.id, code: w.sku, name: w.name, stock_qty: w.stock_qty,
      axle: w.axle, position: w.position, side: w.side,
    })),
  ], [racks, wingArms]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return combined;
    return combined.filter((it) => it.code.toLowerCase().includes(term) || it.name.toLowerCase().includes(term));
  }, [combined, search]);

  // ปีกนกที่กำลังเลือก จะพยายามหาคู่ซ้าย-ขวาให้เสมอ — คำนวณใหม่ทุกครั้งที่ wingArms
  // โหลดใหม่ (กันสต๊อกคงเหลือของคู่ไม่อัปเดตหลังตัดไปแล้วรอบก่อน)
  const pair = useMemo(() => {
    if (!selected || selected.type !== 'wing_arm') return null;
    return findWingArmPair(selected, wingArms);
  }, [selected, wingArms]);

  const selectItem = (item) => {
    setSelected(item);
    setQty('');
    setBrand('');
    setModel('');
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

  const maxQty = useMemo(() => {
    if (!selected) return 0;
    return pair ? Math.min(selected.stock_qty, pair.stock_qty) : selected.stock_qty;
  }, [selected, pair]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    const quantity = Number(qty);
    if (!selected) return setErrorMsg('กรุณาเลือกอะไหล่ก่อน');
    if (!quantity || quantity <= 0) return setErrorMsg('กรุณาระบุจำนวนที่มากกว่า 0');
    if (quantity > maxQty) return setErrorMsg(`สต๊อกเหลือไม่พอ (คงเหลือสูงสุด ${maxQty})`);

    setSubmitting(true);
    try {
      const modelLabel = models.find((m) => m.model === model)?.label || model;
      const vehicle_model = brand ? `${brand} ${modelLabel}`.trim() : null;
      if (selected.type === 'rack') {
        await client.post('/transactions/out', { model_code: selected.code, qty: quantity, note, vehicle_model });
      } else if (pair) {
        const leftItem = selected.side === 'left' ? selected : pair;
        const rightItem = selected.side === 'left' ? pair : selected;
        await client.patch('/wing-arms/pair-stock', {
          left_id: leftItem.id, right_id: rightItem.id, qty: quantity, note, vehicle_model,
        });
      } else {
        await client.patch(`/wing-arms/${selected.id}/stock`, { delta: -quantity, note, vehicle_model });
      }
      setSuccessMsg(
        pair
          ? `ตัดสต๊อก "${stripSideWord(selected.name)}" (ซ้าย+ขวา) จำนวน ${quantity} คู่ สำเร็จ`
          : `ตัดสต๊อก "${selected.name}" จำนวน ${quantity} สำเร็จ`
      );
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

      {/* เปิดเป็น modal ทับหน้ารายการเดิม — ไม่สลับเนื้อหาทั้งหน้า ปิดแล้วกลับมาเห็น
          รายการเดิมทันที (search/scroll position ไม่หาย) */}
      {selected && (
        <div className="modal-backdrop" onClick={resetForm}>
          <div className="modal-card" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">📦 ตัดสต๊อก: {selected.name}</h3>
            <p style={{ marginBottom: 4 }}><strong>รหัส:</strong> {selected.code}</p>
            <p style={{ marginBottom: selected.type === 'wing_arm' ? 4 : 16 }}>
              <strong>สต็อกคงเหลือ:</strong> {selected.stock_qty}
            </p>

            {selected.type === 'wing_arm' && (
              pair ? (
                <p style={{ marginBottom: 16, color: '#15803d', fontSize: 14 }}>
                  ✅ พบคู่: <strong>{pair.sku}</strong> ({pair.side === 'left' ? 'ซ้าย' : 'ขวา'}) สต็อกคงเหลือ {pair.stock_qty} — จะตัดพร้อมกันทั้งคู่
                </p>
              ) : (
                <p style={{ marginBottom: 16, color: '#92400e', fontSize: 14 }}>
                  ⚠️ ไม่พบคู่ซ้าย-ขวาอัตโนมัติ จะตัดสต๊อกเฉพาะรายการนี้รายการเดียว
                </p>
              )
            )}

            <form onSubmit={handleSubmit} className="modal-form">
              <label>จำนวนที่ตัดออก{pair ? ' (ต่อข้าง)' : ''}</label>
              <input
                type="number"
                min="1"
                max={maxQty}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                required
              />

              <label>ยี่ห้อรถ</label>
              <select value={brand} onChange={(e) => { setBrand(e.target.value); setModel(''); }}>
                <option value="">-- เลือกยี่ห้อ --</option>
                {brands.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>

              {brand && (
                <>
                  <label>รุ่นรถ</label>
                  <select value={model} onChange={(e) => setModel(e.target.value)}>
                    <option value="">-- เลือกรุ่น --</option>
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
        </div>
      )}

      {successMsg && <p style={{ color: '#15803d', fontWeight: 600, marginTop: 12 }}>✅ {successMsg}</p>}
    </div>
  );
}
