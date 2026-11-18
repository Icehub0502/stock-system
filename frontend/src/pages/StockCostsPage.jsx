import React, { useCallback, useEffect, useState } from 'react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { canChange } from '../utils/roles';

// ต้นทุนที่ยังไม่ได้กรอก: lines of closed receive bills without a price per piece, and stock on the shelf with no cost at
// all (bought before costs were recorded). Data from GET /stock-receive/costs/missing.

function CostRow({ id, title, subtitle, onSave }) {
  const [value, setValue] = useState('');
  const [state, setState] = useState('');
  const save = async () => {
    setState('saving');
    try {
      await onSave(id, value);
      setState('saved');
    } catch (err) {
      setState(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
    }
  };
  if (state === 'saved') return null;
  return (
    <div className="sc-row">
      <div className="sc-row-main">
        <strong>{title}</strong>
        <span className="sc-muted">{subtitle}</span>
        {state && state !== 'saving' && <span className="sc-error">{state}</span>}
      </div>
      <div className="sc-row-side">
        <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="บาท/ชิ้น" value={value} onChange={(e) => setValue(e.target.value)} aria-label="ต้นทุนต่อชิ้น" />
        <button type="button" className="btn btn-primary" disabled={!value || state === 'saving'} onClick={save}>บันทึก</button>
      </div>
    </div>
  );
}

const formatBaht = (n) => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// A cost already typed, shown with an "แก้ไข" button that opens the price for correction
function FilledCostRow({ id, title, subtitle, cost, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [state, setState] = useState('');
  const open = () => { setValue(String(cost)); setState(''); setEditing(true); };
  const save = async () => {
    setState('saving');
    try {
      await onSave(id, value);
      setEditing(false);
      setState('saved');
    } catch (err) {
      setState(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
    }
  };
  const unchanged = value === '' || Number(value) === Number(cost);
  return (
    <div className="sc-row">
      <div className="sc-row-main">
        <strong>{title}</strong>
        <span className="sc-muted">{subtitle}</span>
        {state === 'saved' && <span className="sc-saved">แก้ไขต้นทุนแล้ว</span>}
        {state && state !== 'saving' && state !== 'saved' && <span className="sc-error">{state}</span>}
      </div>
      {editing ? (
        <div className="sc-row-side">
          <input type="number" inputMode="decimal" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !unchanged) save(); if (e.key === 'Escape') setEditing(false); }}
            aria-label="ต้นทุนต่อชิ้นที่ถูกต้อง" autoFocus />
          <button type="button" className="btn btn-primary" disabled={unchanged || state === 'saving'} onClick={save}>บันทึก</button>
          <button type="button" className="btn btn-secondary" disabled={state === 'saving'} onClick={() => setEditing(false)}>ยกเลิก</button>
        </div>
      ) : (
        <div className="sc-row-side">
          <span className="sc-cost">{formatBaht(cost)} บาท/ชิ้น</span>
          <button type="button" className="btn btn-secondary" onClick={open}>แก้ไข</button>
        </div>
      )}
    </div>
  );
}

// Costs already typed (closed receive bills, and hand-typed costs for managers), searchable, each with an edit button
function FilledCostsPanel({ canSetItemCost, onChanged, refreshKey }) {
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback((text) => {
    client.get('/stock-receive/costs/filled', { params: { search: text } })
      .then((res) => { setData(res.data.data); setError(''); })
      .catch((err) => setError(err.response?.data?.error || 'โหลดไม่สำเร็จ'));
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => load(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search, load, refreshKey]);

  // the list is not fetched again after a save, so the corrected row stays where it is and shows the new price
  const saveLine = async (id, value) => {
    await client.put(`/stock-receive/costs/lines/${id}`, { unit_cost: Number(value) });
    setData((d) => ({ ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, unit_cost: Number(value) } : l)) }));
    onChanged();
  };
  const saveItem = async (id, value) => {
    await client.put(`/stock-receive/costs/items/${id}`, { manual_cost: Number(value) });
    setData((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, manual_cost: Number(value) } : i)) }));
    onChanged();
  };

  const items = canSetItemCost ? (data?.items || []) : [];
  return (
    <div className="dash-panel">
      <div className="dash-panel-title">ต้นทุนที่กรอกแล้ว (แก้ไขได้)</div>
      <p className="sc-muted">ใส่ต้นทุนผิด กด "แก้ไข" ที่รายการนั้นแล้วใส่ราคาที่ถูกต้อง ระบบจะคำนวณต้นทุนเฉลี่ยของสินค้าใหม่ให้ และบันทึกราคาเดิมไว้ในประวัติการใช้งาน</p>
      <div className="sc-add">
        <input type="search" placeholder="ค้นหาชื่อสินค้า, รหัส OEM, เลขบิล หรือร้าน" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="ค้นหาต้นทุนที่กรอกแล้ว" />
      </div>
      {error && <div className="error-message">{error}</div>}
      {!data ? <div className="loading">กำลังโหลด...</div> : (
        <>
          {data.lines.length === 0 && items.length === 0 && (
            <div className="empty-message">{search.trim() ? 'ไม่พบรายการที่ค้นหา' : 'ยังไม่มีต้นทุนที่กรอกไว้'}</div>
          )}
          {data.lines.map((l) => (
            <FilledCostRow
              key={`l${l.id}`}
              id={l.id}
              cost={l.unit_cost}
              title={`${l.category_name} · ${l.description || l.oem_code} × ${l.qty}`}
              subtitle={`บิล ${l.invoice_no} · ${l.supplier_name || 'ไม่ระบุร้าน'} · ${l.bill_date}`}
              onSave={saveLine}
            />
          ))}
          {items.map((i) => (
            <FilledCostRow
              key={`i${i.id}`}
              id={i.id}
              cost={i.manual_cost}
              title={`${i.category_name} · ${i.description || i.oem_code}`}
              subtitle={`ต้นทุนที่ใส่เอง (ของก่อนเริ่มบันทึกต้นทุน) · เหลือ ${i.stock_qty} ชิ้น`}
              onSave={saveItem}
            />
          ))}
          {data.lines.length >= 100 && <p className="sc-muted">แสดง 100 รายการล่าสุด ถ้าไม่เจอให้พิมพ์ค้นหา</p>}
        </>
      )}
    </div>
  );
}

export default function StockCostsPage() {
  const { user } = useAuth();
  const canSetItemCost = canChange(user, 'manager');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    client.get('/stock-receive/costs/missing')
      .then((res) => { setData(res.data.data); setError(''); })
      .catch((err) => setError(err.response?.data?.error || 'โหลดไม่สำเร็จ'));
  }, []);
  useEffect(() => { load(); }, [load]);

  // After a save the lists are fetched again: a priced bill line also gives its item a cost, so that item must leave
  // "สินค้าในสต๊อกที่ยังไม่มีต้นทุนเลย" too (rows are keyed by id, so what is typed in other rows stays)
  // the "ต้นทุนที่กรอกแล้ว" list is fetched again too, so a cost just typed can be corrected right away
  const [filledKey, setFilledKey] = useState(0);
  const saveLine = async (id, value) => { await client.put(`/stock-receive/costs/lines/${id}`, { unit_cost: Number(value) }); load(); setFilledKey((k) => k + 1); };
  const saveItem = async (id, value) => { await client.put(`/stock-receive/costs/items/${id}`, { manual_cost: Number(value) }); load(); setFilledKey((k) => k + 1); };

  if (!data) return <div className="quotation-page">{error ? <div className="error-message">{error}</div> : <div className="loading">กำลังโหลด...</div>}</div>;

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>กรอกต้นทุนที่ยังขาด</h1>
          <p className="subtitle">ต้นทุนต่อชิ้นของสินค้าที่รับเข้ามา ใช้คำนวณกำไรและมูลค่าสต๊อกในหน้าเจ้าของ กรอกเสร็จแถวจะย้ายไปอยู่ใน "ต้นทุนที่กรอกแล้ว" ด้านล่าง ซึ่งแก้ไขได้ถ้ากรอกผิด</p>
        </div>
      </div>
      {error && <div className="error-message">{error}</div>}

      <div className="dash-panel">
        <div className="dash-panel-title">รายการในบิลรับเข้าที่ยังไม่ใส่ต้นทุน ({data.lines.length})</div>
        {data.lines.length === 0 ? <div className="empty-message">ไม่มีรายการค้าง</div> : data.lines.map((l) => (
          <CostRow
            key={l.id}
            id={l.id}
            title={`${l.category_name} · ${l.description || l.oem_code} × ${l.qty}`}
            subtitle={`บิล ${l.invoice_no} · ${l.supplier_name || 'ไม่ระบุร้าน'} · ${l.bill_date}`}
            onSave={saveLine}
          />
        ))}
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">สินค้าในสต๊อกที่ยังไม่มีต้นทุนเลย ({data.items.length})</div>
        <p className="sc-muted">ของที่ซื้อมาก่อนเริ่มบันทึกต้นทุน ใส่ต้นทุนโดยประมาณไว้ก่อนได้ (เฉพาะผู้จัดการ) เมื่อรับเข้ารอบใหม่พร้อมราคา ระบบจะใช้ราคาจากบิลแทน</p>
        {data.items.length === 0 ? <div className="empty-message">ทุกรายการมีต้นทุนแล้ว</div> : data.items.map((i) => (
          canSetItemCost ? (
            <CostRow key={i.id} id={i.id} title={`${i.category_name} · ${i.description || i.oem_code}`} subtitle={`เหลือ ${i.stock_qty} ชิ้น`} onSave={saveItem} />
          ) : (
            <div key={i.id} className="sc-row"><div className="sc-row-main"><strong>{i.category_name} · {i.description || i.oem_code}</strong><span className="sc-muted">เหลือ {i.stock_qty} ชิ้น</span></div></div>
          )
        ))}
      </div>

      <FilledCostsPanel canSetItemCost={canSetItemCost} onChanged={load} refreshKey={filledKey} />
    </div>
  );
}
