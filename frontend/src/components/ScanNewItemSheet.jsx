import React, { useEffect, useState } from 'react';
import client from '../api/client';
import { positionsFor, positionLabel } from '../utils/stockPositions';
import { ScanPositionChip as PositionChip } from './PositionChip';

// รหัสที่ยังไม่มีในสต๊อกรวม (หน้าสแกน โหมดรับเข้า) — กรอกรายละเอียดตรงนี้แล้วระบบสร้างรายการในสต๊อกรวม
// (เริ่ม 0 ชิ้น) และใส่จำนวนเข้าบิลเป็น "รอยืนยัน" ทีเดียว (POST /stock-receive/new-item) ยอดบวกจริงตอน
// กดยืนยันบวกสต๊อกเหมือนของที่สแกนเจอ ช่องต่าง ๆ ตรงกับฟอร์มเพิ่มรายการของหน้าสต๊อกรวม
const NEW_CATEGORY = '__new__';
const emptyFitment = { brand: '', model: '', year_from: '', year_to: '' };

// quantity box text → '' while retyping, else a whole number 0..100000
function qtyText(value) {
  if (value === '') return '';
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 0 ? String(Math.min(n, 100000)) : '';
}

export default function ScanNewItemSheet({ code, sessionId, onCreated, onPickExisting, onCancel }) {
  const [categories, setCategories] = useState([]);
  const [categoryId, setCategoryId] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [split, setSplit] = useState({ has_sides: false, has_axles: false, has_levels: false });
  const [oemCode, setOemCode] = useState(code || '');
  const [qty, setQty] = useState('1');
  const [codes, setCodes] = useState({});
  const [qtys, setQtys] = useState({});
  const [description, setDescription] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [minStock, setMinStock] = useState('1');
  const [fitments, setFitments] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    client.get('/stock-items/categories')
      .then((res) => {
        setCategories(res.data);
        if (res.data.length > 0) setCategoryId(String(res.data[0].id));
        else setCategoryId(NEW_CATEGORY);
      })
      .catch(() => setError('โหลดหมวดหมู่ไม่สำเร็จ'));
  }, []);

  const positions = positionsFor(split.has_sides, split.has_axles, split.has_levels);

  // ติ๊กแยกตำแหน่งครั้งแรก: ย้ายรหัสที่สแกนได้ไปไว้ตำแหน่งแรก (แก้/ย้ายเองได้)
  const toggleSplit = (key) => {
    const next = { ...split, [key]: !split[key] };
    const nextPositions = positionsFor(next.has_sides, next.has_axles, next.has_levels);
    if (nextPositions.length > 0 && !nextPositions.some((p) => (codes[p] || '').trim()) && oemCode.trim()) {
      setCodes({ [nextPositions[0]]: oemCode.trim() });
      setQtys({ [nextPositions[0]]: qty || '1' });
    }
    setSplit(next);
  };

  const updateFitment = (index, field, value) => {
    setFitments((list) => list.map((f, i) => (i === index ? { ...f, [field]: value } : f)));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const receiveTotal = positions.length > 0
      ? positions.reduce((sum, p) => sum + (Number(qtys[p]) || 0), 0)
      : Number(qty) || 0;
    if (positions.length > 0 ? !positions.some((p) => (codes[p] || '').trim()) : !oemCode.trim()) {
      setError('กรุณากรอกรหัสอะไหล่');
      return;
    }
    if (receiveTotal < 1) {
      setError('กรุณาใส่จำนวนที่รับเข้าอย่างน้อย 1 ชิ้น');
      return;
    }
    if (categoryId === NEW_CATEGORY && !newCategory.trim()) {
      setError('กรุณาพิมพ์ชื่อหมวดหมู่ใหม่');
      return;
    }

    setSaving(true);
    try {
      let category = categoryId;
      if (categoryId === NEW_CATEGORY) {
        const res = await client.post('/stock-items/categories', { name: newCategory.trim() });
        // keep the category just made, so a retry after another error does not try to create it again
        setCategories((list) => [...list, res.data]);
        setCategoryId(String(res.data.id));
        setNewCategory('');
        category = String(res.data.id);
      }
      const res = await client.post('/stock-receive/new-item', {
        receipt_session_id: sessionId,
        category_id: Number(category),
        ...split,
        oem_code: positions.length > 0 ? undefined : oemCode.trim(),
        qty: positions.length > 0 ? undefined : Number(qty),
        codes: positions.length > 0 ? Object.fromEntries(positions.map((p) => [p, (codes[p] || '').trim()])) : undefined,
        qtys: positions.length > 0 ? Object.fromEntries(positions.map((p) => [p, Number(qtys[p]) || 0])) : undefined,
        description: description.trim(),
        unit_cost: unitCost === '' ? undefined : unitCost,
        min_stock: Number(minStock) || 0,
        fitments: fitments.filter((f) => f.brand.trim() || f.model.trim()),
      });
      onCreated(res.data);
    } catch (err) {
      const data = err?.response?.data;
      if (data?.code === 'CODE_EXISTS' && data.matches?.length) {
        onPickExisting(data.matches);
        return;
      }
      setError(data?.error || 'เพิ่มรายการไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="scan-sheet-backdrop">
      <form className="scan-sheet scan-sheet--tall scan-new-item" role="dialog" aria-modal="true" aria-label="เพิ่มรายการใหม่" onSubmit={handleSubmit}>
        <div className="scan-sheet-handle" />
        <h2 className="scan-sheet-title">เพิ่มรายการใหม่เข้าบิล</h2>
        <p className="scan-sheet-sub">
          {code ? <>รหัส <b className="scan-code">{code}</b> ยังไม่มีในสต๊อกรวม — </> : null}
          กรอกรายละเอียดแล้วระบบจะสร้างในสต๊อกรวมให้ จำนวนจะบวกเข้าสต๊อกตอนกด “ยืนยันบวกสต๊อก”
        </p>

        <label className="scan-label" htmlFor="new-item-category">หมวดหมู่</label>
        <select id="new-item-category" className="scan-input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value={NEW_CATEGORY}>+ หมวดใหม่ (พิมพ์ชื่อเอง)</option>
        </select>
        {categoryId === NEW_CATEGORY && (
          <input
            className="scan-input scan-new-item-gap"
            placeholder="ชื่อหมวดหมู่ใหม่ เช่น ลูกหมาก"
            value={newCategory}
            maxLength={100}
            onChange={(e) => setNewCategory(e.target.value)}
            aria-label="ชื่อหมวดหมู่ใหม่"
          />
        )}

        <div className="scan-new-item-checks">
          <label><input type="checkbox" checked={split.has_sides} onChange={() => toggleSplit('has_sides')} /> แยกซ้าย / ขวา</label>
          <label><input type="checkbox" checked={split.has_axles} onChange={() => toggleSplit('has_axles')} /> แยกหน้า / หลัง</label>
          <label><input type="checkbox" checked={split.has_levels} onChange={() => toggleSplit('has_levels')} /> แยกบน / ล่าง</label>
        </div>

        {positions.length === 0 ? (
          <div className="scan-new-item-row2">
            <div>
              <label className="scan-label" htmlFor="new-item-code">รหัสอะไหล่</label>
              <input id="new-item-code" className="scan-input scan-input--mono" value={oemCode} maxLength={100}
                onChange={(e) => setOemCode(e.target.value)} placeholder="เช่น 45510-0K010" />
            </div>
            <div>
              <label className="scan-label" htmlFor="new-item-qty">จำนวนรับเข้า</label>
              <input id="new-item-qty" className="scan-input" type="number" inputMode="numeric" min="1" value={qty}
                onChange={(e) => setQty(qtyText(e.target.value))} />
            </div>
          </div>
        ) : (
          <div className="scan-new-item-positions">
            <div className="scan-new-item-pos-head"><span /><span>รหัสอะไหล่ ตำแหน่งนี้</span><span>รับเข้า</span></div>
            {positions.map((p) => (
              <div key={p} className="scan-new-item-pos-row">
                <PositionChip position={p} />
                <input className="scan-input scan-input--mono" placeholder="รหัส (ถ้ามี)" maxLength={100} value={codes[p] ?? ''}
                  onChange={(e) => setCodes((c) => ({ ...c, [p]: e.target.value }))} aria-label={`รหัส ${positionLabel(p)}`} />
                <input className="scan-input" type="number" inputMode="numeric" min="0" value={qtys[p] ?? ''} placeholder="0"
                  onChange={(e) => setQtys((q) => ({ ...q, [p]: qtyText(e.target.value) }))} aria-label={`จำนวน ${positionLabel(p)}`} />
              </div>
            ))}
          </div>
        )}

        <label className="scan-label" htmlFor="new-item-desc">รายละเอียดสินค้า</label>
        <input id="new-item-desc" className="scan-input" value={description} maxLength={500}
          onChange={(e) => setDescription(e.target.value)} placeholder="เช่น แร็คพวงมาลัย TOYOTA VIGO 2WD" />

        <div className="scan-new-item-row2">
          <div>
            <label className="scan-label" htmlFor="new-item-cost">ต้นทุนต่อชิ้น (บาท)</label>
            <input id="new-item-cost" className="scan-input" type="number" inputMode="decimal" min="0" step="0.01"
              value={unitCost} onChange={(e) => setUnitCost(e.target.value)} placeholder="ใส่ทีหลังได้" />
          </div>
          <div>
            <label className="scan-label" htmlFor="new-item-min">เตือนเมื่อเหลือ ≤</label>
            <input id="new-item-min" className="scan-input" type="number" inputMode="numeric" min="0"
              value={minStock} onChange={(e) => setMinStock(qtyText(e.target.value))} />
          </div>
        </div>

        <label className="scan-label">ใช้กับรถรุ่นไหน (ไม่บังคับ)</label>
        {fitments.map((f, i) => (
          <div key={i} className="scan-new-item-fit">
            <input className="scan-input" placeholder="ยี่ห้อ" maxLength={100} value={f.brand} onChange={(e) => updateFitment(i, 'brand', e.target.value)} aria-label="ยี่ห้อรถ" />
            <input className="scan-input" placeholder="รุ่น" maxLength={100} value={f.model} onChange={(e) => updateFitment(i, 'model', e.target.value)} aria-label="รุ่นรถ" />
            <input className="scan-input" type="number" placeholder="ปีเริ่ม" min="1950" max="2100" value={f.year_from} onChange={(e) => updateFitment(i, 'year_from', e.target.value)} aria-label="ปีเริ่ม ค.ศ." />
            <input className="scan-input" type="number" placeholder="ถึงปี" min="1950" max="2100" value={f.year_to} onChange={(e) => updateFitment(i, 'year_to', e.target.value)} aria-label="ถึงปี ค.ศ." />
            <button type="button" className="scan-new-item-fit-del" onClick={() => setFitments((list) => list.filter((_, j) => j !== i))} aria-label="ลบรุ่นรถนี้">✕</button>
          </div>
        ))}
        <button type="button" className="scan-btn scan-btn--ghost scan-btn--sm" onClick={() => setFitments((list) => [...list, { ...emptyFitment }])}>
          + เพิ่มรุ่นรถ
        </button>

        {error && <p className="scan-error scan-new-item-error">{error}</p>}

        <button type="submit" className="scan-btn scan-btn--block scan-btn--lg scan-btn--in scan-new-item-submit" disabled={saving}>
          {saving ? 'กำลังบันทึก...' : 'สร้างรายการ + เพิ่มเข้าบิล'}
        </button>
        <button type="button" className="scan-sheet-cancel" onClick={onCancel}>ยกเลิก</button>
      </form>
    </div>
  );
}
