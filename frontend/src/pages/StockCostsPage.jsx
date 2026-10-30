import React, { useCallback, useEffect, useState } from 'react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { hasRole } from '../utils/roles';

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

export default function StockCostsPage() {
  const { user } = useAuth();
  const canSetItemCost = hasRole(user, 'manager');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    client.get('/stock-receive/costs/missing')
      .then((res) => { setData(res.data.data); setError(''); })
      .catch((err) => setError(err.response?.data?.error || 'โหลดไม่สำเร็จ'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveLine = async (id, value) => { await client.put(`/stock-receive/costs/lines/${id}`, { unit_cost: Number(value) }); };
  const saveItem = async (id, value) => { await client.put(`/stock-receive/costs/items/${id}`, { manual_cost: Number(value) }); };

  if (!data) return <div className="quotation-page">{error ? <div className="error-message">{error}</div> : <div className="loading">กำลังโหลด...</div>}</div>;

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>กรอกต้นทุนที่ยังขาด</h1>
          <p className="subtitle">ต้นทุนต่อชิ้นของสินค้าที่รับเข้ามา ใช้คำนวณกำไรและมูลค่าสต๊อกในหน้าเจ้าของ กรอกเสร็จแถวจะหายไป</p>
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
    </div>
  );
}
