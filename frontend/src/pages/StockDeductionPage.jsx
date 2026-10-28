import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import client from '../api/client';
import useRealtimeEvent from '../hooks/useRealtimeEvent';
import PositionChip from '../components/PositionChip';
import { positionLabel } from '../utils/stockPositions';

// หน้าตัดสต๊อก — ตัดจาก "สต๊อกรวม" (stock_items) ผ่าน POST /api/stock-deductions
// (เดิมตัดจากตารางเก่า racks/wing_arms ทำให้ยอดสต๊อกรวมไม่ลด)
//
// ชิ้นที่แยกตำแหน่ง (ซ้าย/ขวา/หน้า/หลัง/บน/ล่าง) เลือกได้ว่าจะตัดตำแหน่งไหนบ้างและกี่ชิ้นต่อตำแหน่ง
// แล้วตัดพร้อมกันในครั้งเดียว (ตำแหน่งไหนสต๊อกไม่พอ = ไม่ตัดเลยสักตำแหน่ง) — ชิ้นที่แยกซ้าย/ขวาอย่าง
// เดียว (ปีกนกใช้ทีละคู่) ติ๊กทั้งสองข้างไว้ให้เป็นค่าเริ่มต้น
// เลือก "รุ่นรถ" แบบ 2 ขั้น (ยี่ห้อ → รุ่น) จากแคตตาล็อก vehicle_models ไว้สรุปในหน้ารายงาน

const ALL_TAB = 'all';

function todayLocalDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// ค่าเริ่มต้นของแถวที่จะตัด: ชิ้นธรรมดาแถวเดียว / ปีกนก (ซ้าย-ขวา) ติ๊กทั้งคู่ / อื่น ๆ ยังไม่ติ๊ก
function defaultLines(item) {
  if (item.positions.length === 0) return { _: { checked: true, qty: '' } };
  const pairByDefault = Boolean(item.has_sides) && !item.has_axles && !item.has_levels;
  return Object.fromEntries(
    item.positions.map((p) => [p.position, { checked: pairByDefault && p.qty > 0, qty: '1' }])
  );
}

export default function StockDeductionPage() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(ALL_TAB);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [lines, setLines] = useState({});

  const [brands, setBrands] = useState([]);
  const [brand, setBrand] = useState('');
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [note, setNote] = useState('');
  const [txDate, setTxDate] = useState(todayLocalDate());
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const loadItems = useCallback(async ({ silent } = {}) => {
    try {
      if (!silent) setLoading(true);
      const [itemsRes, catRes] = await Promise.all([
        client.get('/stock-items'),
        client.get('/stock-items/categories'),
      ]);
      setItems(itemsRes.data || []);
      setCategories(catRes.data || []);
    } catch (err) {
      setErrorMsg('โหลดรายการอะไหล่ไม่สำเร็จ');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { loadItems(); }, [loadItems]);

  // Realtime: ยอดคงเหลือเปลี่ยนจากเครื่องอื่น → รีเฟรชเงียบ ๆ แต่เลื่อนไว้ถ้ากำลังเปิดฟอร์มตัดสต๊อกอยู่
  // (selected เก็บยอดไว้ตรวจ max ของฟอร์ม จะเพี้ยนถ้าข้อมูลเปลี่ยนกลางทาง) หรือกำลังส่งฟอร์ม
  const pendingRefreshRef = useRef(false);
  useRealtimeEvent(
    ['stock:item-created', 'stock:item-updated', 'stock:item-deleted'],
    () => {
      if (selected !== null || submitting) {
        pendingRefreshRef.current = true;
        return;
      }
      loadItems({ silent: true });
    }
  );
  useEffect(() => {
    if (selected === null && !submitting && pendingRefreshRef.current) {
      pendingRefreshRef.current = false;
      loadItems({ silent: true });
    }
  }, [selected, submitting, loadItems]);

  useEffect(() => {
    client.get('/vehicle-models/brands').then((res) => setBrands(res.data.data || [])).catch(() => setBrands([]));
  }, []);

  useEffect(() => {
    if (!brand) { setModels([]); setModel(''); return; }
    client.get('/vehicle-models/models', { params: { brand } }).then((res) => setModels(res.data.data || [])).catch(() => setModels([]));
  }, [brand]);

  const countsByCategory = useMemo(() => {
    const map = {};
    items.forEach((i) => { map[i.category_id] = (map[i.category_id] || 0) + 1; });
    return map;
  }, [items]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((i) => {
      if (activeTab !== ALL_TAB && i.category_id !== activeTab) return false;
      if (!term) return true;
      const text = `${i.oem_code} ${i.positions.map((p) => p.oem_code || '').join(' ')} ${i.description}`.toLowerCase();
      return text.includes(term);
    });
  }, [items, activeTab, search]);

  const activeCategory = categories.find((c) => c.id === activeTab) || null;

  const selectItem = (item) => {
    setSelected(item);
    setLines(defaultLines(item));
    setBrand('');
    setModel('');
    setTxDate(todayLocalDate());
    setErrorMsg('');
    setSuccessMsg('');
  };

  const resetForm = () => {
    setSelected(null);
    setLines({});
    setBrand('');
    setModel('');
    setNote('');
    setTxDate(todayLocalDate());
  };

  const updateLine = (key, changes) => setLines((prev) => ({ ...prev, [key]: { ...prev[key], ...changes } }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    if (!selected) return setErrorMsg('กรุณาเลือกอะไหล่ก่อน');

    // ประกอบรายการที่จะตัด + ตรวจจำนวนต่อตำแหน่งไม่เกินยอดคงเหลือ
    const payloadLines = [];
    if (selected.positions.length === 0) {
      const quantity = Number(lines._?.qty);
      if (!Number.isInteger(quantity) || quantity <= 0) return setErrorMsg('กรุณาระบุจำนวนเต็มที่มากกว่า 0');
      if (quantity > selected.stock_qty) return setErrorMsg(`สต๊อกเหลือไม่พอ (คงเหลือ ${selected.stock_qty})`);
      payloadLines.push({ qty: quantity });
    } else {
      for (const p of selected.positions) {
        const line = lines[p.position];
        if (!line?.checked) continue;
        const quantity = Number(line.qty);
        if (!Number.isInteger(quantity) || quantity <= 0) return setErrorMsg(`${positionLabel(p.position)}: กรุณาระบุจำนวนเต็มที่มากกว่า 0`);
        if (quantity > p.qty) return setErrorMsg(`${positionLabel(p.position)}: สต๊อกเหลือไม่พอ (คงเหลือ ${p.qty})`);
        payloadLines.push({ position: p.position, qty: quantity });
      }
      if (payloadLines.length === 0) return setErrorMsg('กรุณาติ๊กเลือกตำแหน่งที่จะตัดอย่างน้อย 1 ตำแหน่ง');
    }
    if (!txDate) return setErrorMsg('กรุณาระบุวันที่ตัดสต๊อก');
    if (txDate > todayLocalDate()) return setErrorMsg('เลือกวันที่ในอนาคตไม่ได้');

    setSubmitting(true);
    try {
      const vehicleModel = brand ? `${brand} ${model}`.trim() : null;
      await client.post('/stock-deductions', {
        item_id: selected.id,
        lines: payloadLines,
        vehicle_model: vehicleModel,
        deduction_date: txDate,
        note,
      });
      const summary = payloadLines
        .map((l) => (l.position ? `${positionLabel(l.position)} ${l.qty}` : `${l.qty}`))
        .join(' + ');
      setSuccessMsg(`ตัดสต๊อก "${selected.description || selected.oem_code}" (${summary}) สำเร็จ`);
      resetForm();
      loadItems({ silent: true });
    } catch (err) {
      setErrorMsg(err.response?.data?.error || 'ตัดสต๊อกไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="office-dashboard container">
      <div className="dashboard-header">
        <h2>ตัดสต๊อก <span className="dashboard-header-sub">— เบิกอะไหล่ออกจากสต๊อกรวม</span></h2>
      </div>

      <div className="stock-all-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={activeTab === ALL_TAB}
          className={`stock-all-tab${activeTab === ALL_TAB ? ' stock-all-tab--active' : ''}`}
          onClick={() => setActiveTab(ALL_TAB)}>
          ทั้งหมด <span className="stock-all-tab-count">{items.length}</span>
        </button>
        {categories.map((c) => (
          <button key={c.id} type="button" role="tab" aria-selected={activeTab === c.id}
            className={`stock-all-tab${activeTab === c.id ? ' stock-all-tab--active' : ''}`}
            onClick={() => setActiveTab(c.id)}>
            {c.name} <span className="stock-all-tab-count">{countsByCategory[c.id] || 0}</span>
          </button>
        ))}
      </div>

      <div className="search-bar">
        <input
          type="text"
          placeholder={activeCategory ? `ค้นหาในหมวด ${activeCategory.name} (รหัส OEM / รายละเอียด)...` : 'ค้นหาในทุกหมวด (รหัส OEM / รายละเอียด)...'}
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
                {activeTab === ALL_TAB && <th>หมวด</th>}
                <th>รหัส OEM</th>
                <th>รายละเอียด</th>
                <th>คงเหลือ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((it) => (
                <tr key={it.id} className="clickable-row" onClick={() => selectItem(it)}>
                  {activeTab === ALL_TAB && <td data-label="หมวด">{it.category_name}</td>}
                  <td data-label="รหัส OEM">
                    {it.positions.length === 0 ? <strong>{it.oem_code}</strong> : it.positions.map((p) => (
                      <div key={p.position} className="stock-all-pos-row">
                        <PositionChip position={p.position} />
                        <span className="stock-all-code">{p.oem_code || '—'}</span>
                      </div>
                    ))}
                  </td>
                  <td data-label="รายละเอียด">{it.description || '—'}</td>
                  <td data-label="คงเหลือ">
                    {it.positions.length === 0 ? <strong>{it.stock_qty}</strong> : it.positions.map((p) => (
                      <div key={p.position} className="stock-all-pos-row">
                        <PositionChip position={p.position} />
                        <strong>{p.qty}</strong>
                      </div>
                    ))}
                  </td>
                  <td data-label=""><button type="button" className="btn-primary">เลือก</button></td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={activeTab === ALL_TAB ? 5 : 4} className="no-result-text">
                    {items.length === 0 ? 'ยังไม่มีรายการอะไหล่ในสต๊อกรวม' : 'ไม่พบรายการที่ตรงเงื่อนไข'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* เปิดเป็น modal ทับหน้ารายการเดิม — ปิดแล้วกลับมาเห็นรายการ/คำค้นเดิมทันที */}
      {selected && (
        <div className="modal-backdrop" onClick={resetForm}>
          <div className="modal-card" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">📦 ตัดสต๊อก: {selected.description || selected.oem_code}</h3>
            <p style={{ margin: '0 0 12px', color: '#6b7280', fontSize: 13 }}>{selected.category_name}</p>

            <form onSubmit={handleSubmit} className="modal-form">
              {selected.positions.length === 0 ? (
                <>
                  <p style={{ margin: 0 }}><strong>รหัส:</strong> {selected.oem_code} · <strong>คงเหลือ:</strong> {selected.stock_qty}</p>
                  <label>จำนวนที่ตัดออก</label>
                  <input type="number" min="1" step="1" max={selected.stock_qty} value={lines._?.qty ?? ''}
                    onChange={(e) => updateLine('_', { qty: e.target.value })} required autoFocus />
                </>
              ) : (
                <>
                  <label>เลือกตำแหน่งที่จะตัด และจำนวนต่อตำแหน่ง</label>
                  <div className="ded-pos-list">
                    {selected.positions.map((p) => {
                      const line = lines[p.position] || { checked: false, qty: '1' };
                      return (
                        <div key={p.position} className={`ded-pos-row${line.checked ? ' is-on' : ''}${p.qty === 0 ? ' is-empty' : ''}`}>
                          <label className="ded-pos-main">
                            <input type="checkbox" checked={Boolean(line.checked)} disabled={p.qty === 0}
                              onChange={(e) => updateLine(p.position, { checked: e.target.checked })} />
                            <PositionChip position={p.position} />
                            <span className="stock-all-code">{p.oem_code || '—'}</span>
                          </label>
                          <span className="ded-pos-stock">คงเหลือ {p.qty}</span>
                          <input type="number" min="1" step="1" max={p.qty} value={line.qty}
                            disabled={!line.checked}
                            onChange={(e) => updateLine(p.position, { qty: e.target.value })}
                            aria-label={`จำนวนที่ตัด ${positionLabel(p.position)}`} />
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              <label>ยี่ห้อรถ</label>
              <select value={brand} onChange={(e) => { setBrand(e.target.value); setModel(''); }}>
                <option value="">-- เลือกยี่ห้อ --</option>
                {brands.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>

              {brand && (
                <>
                  <label>รุ่นรถ</label>
                  <select value={model} onChange={(e) => setModel(e.target.value)}>
                    <option value="">-- เลือกรุ่น --</option>
                    {models.map((m) => <option key={m.display_name} value={m.display_name}>{m.display_name}</option>)}
                  </select>
                </>
              )}

              <label>วันที่ตัดสต๊อก</label>
              <input type="date" value={txDate} max={todayLocalDate()} onChange={(e) => setTxDate(e.target.value)} required />
              {txDate !== todayLocalDate() && (
                <p style={{ margin: '4px 0 0', color: '#92400e', fontSize: 13 }}>
                  ⚠️ กำลังตัดสต๊อกย้อนหลัง — จะถูกบันทึกเป็นวันที่ {txDate}
                </p>
              )}

              <label>หมายเหตุ</label>
              <input type="text" placeholder="เช่น คิว 12 / ใบเสร็จ IV..." value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} />

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
      {errorMsg && !selected && <p className="error-text">{errorMsg}</p>}
    </div>
  );
}
