import React, { useCallback, useEffect, useState } from 'react';
import client from '../api/client';

// ร้านอะไหล่: the shops the stock is bought from. Staff can also type a new shop while opening a receive bill; here a
// manager tidies the list (rename, which categories it is usually bought for, hide). Data from /suppliers.

function SupplierRow({ supplier, onChanged, onError }) {
  const [name, setName] = useState(supplier.name);
  const [guide, setGuide] = useState(supplier.guide_categories || '');
  const dirty = name !== supplier.name || guide !== (supplier.guide_categories || '');

  const save = async (patch) => {
    try {
      await client.put(`/suppliers/${supplier.id}`, patch);
      onError('');
      onChanged();
    } catch (err) {
      onError(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
    }
  };

  return (
    <div className={`sc-row ${supplier.is_active ? '' : 'sc-row-off'}`}>
      <div className="sc-row-main">
        <input type="text" value={name} maxLength={150} onChange={(e) => setName(e.target.value)} aria-label="ชื่อร้าน" />
        <input type="text" value={guide} maxLength={255} placeholder="หมวดที่มักซื้อ เช่น แร็ค,ปีกนก" onChange={(e) => setGuide(e.target.value)} aria-label="หมวดที่มักซื้อ" />
        <span className="sc-muted">{supplier.bills} บิล{supplier.is_active ? '' : ' · ซ่อนอยู่'}</span>
      </div>
      <div className="sc-row-side">
        <button type="button" className="btn btn-primary" disabled={!dirty} onClick={() => save({ name, guide_categories: guide })}>บันทึก</button>
        <button type="button" className="btn btn-secondary" onClick={() => save({ is_active: !supplier.is_active })}>{supplier.is_active ? 'ซ่อน' : 'แสดงอีกครั้ง'}</button>
      </div>
    </div>
  );
}

export default function SuppliersPage() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');

  const load = useCallback(() => {
    client.get('/suppliers', { params: { all: 1 } })
      .then((res) => setRows(res.data.data))
      .catch((err) => setError(err.response?.data?.error || 'โหลดไม่สำเร็จ'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    try {
      await client.post('/suppliers', { name: newName });
      setNewName('');
      setError('');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'เพิ่มไม่สำเร็จ');
    }
  };

  if (!rows) return <div className="quotation-page">{error ? <div className="error-message">{error}</div> : <div className="loading">กำลังโหลด...</div>}</div>;

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>ร้านอะไหล่</h1>
          <p className="subtitle">ร้านที่สั่งของเข้าสต็อก พนักงานเลือกตอนเปิดบิลรับเข้า (พิมพ์ร้านใหม่ได้เอง) ร้านเดียวซื้อได้หลายหมวด หมวดที่ระบุเป็นแค่คำแนะนำ</p>
        </div>
      </div>
      {error && <div className="error-message">{error}</div>}
      <form className="sc-add" onSubmit={add}>
        <input type="text" value={newName} maxLength={150} placeholder="ชื่อร้านใหม่" onChange={(e) => setNewName(e.target.value)} aria-label="ชื่อร้านใหม่" />
        <button type="submit" className="btn btn-primary" disabled={!newName.trim()}>เพิ่มร้าน</button>
      </form>
      <div className="dash-panel">
        {rows.length === 0 ? <div className="empty-message">ยังไม่มีร้านอะไหล่</div> : rows.map((s) => <SupplierRow key={s.id} supplier={s} onChanged={load} onError={setError} />)}
      </div>
    </div>
  );
}
