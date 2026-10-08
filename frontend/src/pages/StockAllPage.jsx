import React, { useCallback, useEffect, useMemo, useState } from 'react';
import client from '../api/client';
import useRealtimeEvent from '../hooks/useRealtimeEvent';

const ALL_TAB = 'all';
const emptyFitment = { brand: '', model: '', year_from: '', year_to: '' };
const emptyForm = {
  category_id: '', oem_code: '', description: '', has_sides: false, has_axles: false,
  stock_qty: 0, stocks: {}, codes: {}, min_stock: 1, fitments: [],
};
const POSITION_LABEL = {
  left: 'ซ้าย', right: 'ขวา', front: 'หน้า', rear: 'หลัง',
  front_left: 'หน้าซ้าย', front_right: 'หน้าขวา', rear_left: 'หลังซ้าย', rear_right: 'หลังขวา',
};

// สีประจำตำแหน่ง (ตัวอักษร / พื้นอ่อน) ใช้ทั้งในตารางและในฟอร์ม ให้รู้ทันทีว่ารหัส/จำนวนไหนคือด้านไหน
// ซ้าย=น้ำเงิน ขวา=แดง หน้า=ม่วง หลัง=ส้ม — โช๊ค 4 ตำแหน่งใช้ 4 สีไม่ซ้ำกัน
const POSITION_COLOR = {
  left: { fg: '#1d4ed8', bg: '#dbeafe' },
  right: { fg: '#b91c1c', bg: '#fee2e2' },
  front: { fg: '#6d28d9', bg: '#ede9fe' },
  rear: { fg: '#c2410c', bg: '#ffedd5' },
  front_left: { fg: '#1d4ed8', bg: '#dbeafe' },
  front_right: { fg: '#b91c1c', bg: '#fee2e2' },
  rear_left: { fg: '#047857', bg: '#d1fae5' },
  rear_right: { fg: '#c2410c', bg: '#ffedd5' },
};

function PositionChip({ position }) {
  const color = POSITION_COLOR[position] || { fg: '#374151', bg: '#e5e7eb' };
  return (
    <span className="stock-all-chip-pos" style={{ color: color.fg, background: color.bg }}>
      {POSITION_LABEL[position] || position}
    </span>
  );
}

// ตำแหน่งที่แยกยอด — ต้องตรงกับ positionsFor ใน backend/src/routes/stockItems.routes.js
function positionsFor(hasSides, hasAxles) {
  if (hasSides && hasAxles) return ['front_left', 'front_right', 'rear_left', 'rear_right'];
  if (hasSides) return ['left', 'right'];
  if (hasAxles) return ['front', 'rear'];
  return [];
}

// ของแยกตำแหน่ง ต้องมีครบทุกตำแหน่งถึงใช้ได้ → นับเป็น "ใกล้หมด/หมด" ตามตำแหน่งที่น้อยที่สุด
function effectiveQty(item) {
  return item.positions.length > 0 ? Math.min(...item.positions.map((p) => p.qty)) : item.stock_qty;
}

function formatFitment(f) {
  const years = f.year_from && f.year_to
    ? (f.year_from === f.year_to ? `${f.year_from}` : `${f.year_from}-${f.year_to}`)
    : (f.year_from ? `${f.year_from}+` : (f.year_to ? `ถึง ${f.year_to}` : ''));
  return `${f.brand} ${f.model}${years ? ` ${years}` : ''}`;
}

const REASON_LABEL = { create: 'เพิ่มรายการ', adjust: 'ปรับ +/−', set: 'ตั้งยอด' };

function QtyBadge({ qty, minStock }) {
  const cls = qty === 0 ? 'stock-all-qty--out' : qty <= minStock ? 'stock-all-qty--low' : 'stock-all-qty--ok';
  return <span className={`stock-all-qty ${cls}`}>{qty}</span>;
}

function formatDateTime(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
}

export default function StockAllPage() {
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(ALL_TAB);
  const [searchTerm, setSearchTerm] = useState('');
  const [stockFilter, setStockFilter] = useState(''); // '' | 'low' | 'out'
  const [errorMsg, setErrorMsg] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [movements, setMovements] = useState([]);

  // ── เลือกหลายรายการเพื่อพิมพ์ป้าย QR (เหมือนหน้า StockRack เดิม) ──
  // หนึ่งรายการแยกตำแหน่งได้หลายป้าย (หนึ่งป้ายต่อรหัส OEM ของแต่ละตำแหน่ง) ป้ายพิมพ์ผ่าน
  // #qr-print-area ตัวเดียวกับหน้าเดิม (สไตล์อยู่ใน app.css) QR เป็นรหัสล้วน ๆ จึงสแกนที่
  // หน้า /scan ได้ และป้ายเก่าที่ติดของไปแล้วก็ใช้ต่อได้เพราะรหัสเดียวกัน
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [printLoading, setPrintLoading] = useState(false);
  const [printQueue, setPrintQueue] = useState([]);

  const load = useCallback(async () => {
    try {
      const [catRes, itemRes] = await Promise.all([
        client.get('/stock-items/categories'),
        client.get('/stock-items'),
      ]);
      setCategories(catRes.data);
      setItems(itemRes.data);
      setErrorMsg('');
    } catch (err) {
      setErrorMsg(err.response?.data?.error || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // สั่งพิมพ์เมื่อโหลดป้ายเสร็จ (หน่วงเล็กน้อยให้รูป QR เรนเดอร์ก่อน) และล้างคิวหลังพิมพ์/ยกเลิก
  useEffect(() => {
    if (printQueue.length === 0) return undefined;
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, [printQueue]);

  useEffect(() => {
    const handleAfterPrint = () => setPrintQueue([]);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, []);

  // ฟอร์มเปิดอยู่ = กำลังพิมพ์ ไม่รีเฟรชทับ (ข้อมูลฟอร์มอยู่ใน state แยกอยู่แล้ว แต่รายการ
  // ข้างหลังเปลี่ยนได้ปลอดภัย) — รีเฟรชเงียบ ๆ ทุกครั้งที่เครื่องอื่นแก้สต๊อก
  useRealtimeEvent(['stock:item-created', 'stock:item-updated', 'stock:item-deleted'], load);

  const countsByCategory = useMemo(() => {
    const map = {};
    items.forEach((i) => { map[i.category_id] = (map[i.category_id] || 0) + 1; });
    return map;
  }, [items]);

  const visibleItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return items.filter((i) => {
      // พิมพ์ค้นหา = ค้นข้ามทุกหมวด (ไม่ติดแท็บ) จะได้หารหัสเจอแม้ไม่รู้ว่าอยู่หมวดไหน
      if (!term && activeTab !== ALL_TAB && i.category_id !== activeTab) return false;
      if (term && !`${i.oem_code} ${i.positions.map((p) => p.oem_code || '').join(' ')} ${i.description} ${i.fitments.map(formatFitment).join(' ')}`.toLowerCase().includes(term)) return false;
      const qty = effectiveQty(i);
      if (stockFilter === 'out' && qty !== 0) return false;
      if (stockFilter === 'low' && !(qty > 0 && qty <= i.min_stock)) return false;
      return true;
    });
  }, [items, activeTab, searchTerm, stockFilter]);

  const brandOptions = useMemo(
    () => [...new Set(items.flatMap((i) => i.fitments.map((f) => f.brand)))].sort(),
    [items]
  );
  const modelOptions = useMemo(
    () => [...new Set(items.flatMap((i) => i.fitments.map((f) => f.model)))].sort(),
    [items]
  );

  const formPositions = positionsFor(form.has_sides, form.has_axles);

  const showCategoryColumn = activeTab === ALL_TAB || searchTerm.trim() !== '';
  const activeCategory = categories.find((c) => c.id === activeTab) || null;

  function toggleSelectMode() {
    setSelectMode((prev) => !prev);
    setSelectedIds([]);
  }

  function toggleSelectOne(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handlePrintSelected() {
    // เฉพาะรายการที่ยังมีอยู่ในตาราง (เครื่องอื่นอาจซ่อนไปแล้วระหว่างเลือก)
    const ids = selectedIds.filter((id) => items.some((i) => i.id === id));
    if (ids.length === 0) return;
    setPrintLoading(true);
    setErrorMsg('');
    try {
      const res = await client.get('/stock-receive/qrcodes', { params: { ids: ids.join(',') } });
      if (res.data.labels.length === 0) {
        setErrorMsg('รายการที่เลือกยังไม่มีรหัส OEM จึงไม่มี QR ให้พิมพ์');
      } else {
        setPrintQueue(res.data.labels);
      }
    } catch (err) {
      setErrorMsg(err.response?.data?.error || 'โหลด QR Code ไม่สำเร็จ ลองใหม่อีกครั้ง');
    } finally {
      setPrintLoading(false);
    }
  }

  function openAdd() {
    setEditingItem(null);
    setMovements([]);
    setForm({ ...emptyForm, category_id: activeCategory ? activeCategory.id : (categories[0]?.id ?? '') });
    setErrorMsg('');
    setShowForm(true);
  }

  async function openEdit(item) {
    setEditingItem(item);
    setForm({
      category_id: item.category_id,
      oem_code: item.oem_code,
      description: item.description,
      has_sides: Boolean(item.has_sides),
      has_axles: Boolean(item.has_axles),
      stock_qty: item.stock_qty,
      stocks: Object.fromEntries(item.positions.map((p) => [p.position, p.qty])),
      codes: Object.fromEntries(item.positions.map((p) => [p.position, p.oem_code || ''])),
      min_stock: item.min_stock,
      fitments: item.fitments.map((f) => ({
        brand: f.brand, model: f.model, year_from: f.year_from ?? '', year_to: f.year_to ?? '',
      })),
    });
    setMovements([]);
    setErrorMsg('');
    setShowForm(true);
    try {
      const res = await client.get(`/stock-items/${item.id}/movements`);
      setMovements(res.data);
    } catch {
      // ประวัติโหลดไม่ได้ไม่กระทบการแก้ไข
    }
  }

  function closeForm() {
    setShowForm(false);
    setEditingItem(null);
    setErrorMsg('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (formPositions.length > 0 && !formPositions.some((p) => (form.codes[p] || '').trim())) {
      setErrorMsg('กรุณากรอกรหัส OEM อย่างน้อยหนึ่งตำแหน่ง');
      return;
    }
    setSaving(true);
    setErrorMsg('');
    try {
      const payload = {
        category_id: Number(form.category_id),
        oem_code: form.oem_code,
        codes: Object.fromEntries(formPositions.map((p) => [p, form.codes[p] || ''])),
        description: form.description,
        min_stock: Number(form.min_stock),
        // แถวที่ยังไม่กรอกยี่ห้อ/รุ่นเลย (กด "เพิ่มรุ่นรถ" ค้างไว้) ไม่ส่งไป
        fitments: form.fitments.filter((f) => f.brand.trim() || f.model.trim()),
      };
      if (editingItem) {
        await client.put(`/stock-items/${editingItem.id}`, payload);
        const note = 'แก้ไขจากหน้าแก้ไขรายการ';
        if (editingItem.positions.length > 0) {
          for (const { position, qty } of editingItem.positions) {
            const value = Number(form.stocks[position]);
            if (value !== qty) {
              await client.patch(`/stock-items/${editingItem.id}/qty`, { position, set_to: value, note });
            }
          }
        } else if (Number(form.stock_qty) !== editingItem.stock_qty) {
          await client.patch(`/stock-items/${editingItem.id}/qty`, { set_to: Number(form.stock_qty), note });
        }
      } else {
        await client.post('/stock-items', {
          ...payload,
          has_sides: form.has_sides,
          has_axles: form.has_axles,
          stock_qty: Number(form.stock_qty),
          stocks: Object.fromEntries(
            positionsFor(form.has_sides, form.has_axles).map((p) => [p, Number(form.stocks[p] || 0)])
          ),
        });
      }
      closeForm();
      await load();
    } catch (err) {
      setErrorMsg(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  function updateFitment(index, field, value) {
    setForm((prev) => ({
      ...prev,
      fitments: prev.fitments.map((f, i) => (i === index ? { ...f, [field]: value } : f)),
    }));
  }

  function addFitment() {
    setForm((prev) => ({ ...prev, fitments: [...prev.fitments, { ...emptyFitment }] }));
  }

  function removeFitment(index) {
    setForm((prev) => ({ ...prev, fitments: prev.fitments.filter((_, i) => i !== index) }));
  }

  async function handleHide() {
    if (!editingItem) return;
    if (!window.confirm(`ซ่อนรายการ "${editingItem.oem_code}" ออกจากสต๊อก?\n(ประวัติยังเก็บไว้ ไม่ได้ลบจริง)`)) return;
    try {
      await client.delete(`/stock-items/${editingItem.id}`);
      closeForm();
      await load();
    } catch (err) {
      setErrorMsg(err.response?.data?.error || 'ลบรายการไม่สำเร็จ');
    }
  }

  async function handleAddCategory() {
    const name = window.prompt('ชื่อหมวดหมู่ใหม่');
    if (!name || !name.trim()) return;
    try {
      const res = await client.post('/stock-items/categories', { name });
      await load();
      setActiveTab(res.data.id);
    } catch (err) {
      alert(err.response?.data?.error || 'เพิ่มหมวดหมู่ไม่สำเร็จ');
    }
  }

  async function handleRenameCategory() {
    if (!activeCategory) return;
    const name = window.prompt('แก้ชื่อหมวดหมู่', activeCategory.name);
    if (!name || !name.trim() || name.trim() === activeCategory.name) return;
    try {
      await client.put(`/stock-items/categories/${activeCategory.id}`, { name });
      await load();
    } catch (err) {
      alert(err.response?.data?.error || 'แก้ชื่อหมวดหมู่ไม่สำเร็จ');
    }
  }

  if (loading) return <div className="loading container">กำลังโหลด...</div>;

  return (
    <div className="office-dashboard container">
      <div className="dashboard-header">
        <h2>สต๊อกรวม <span className="dashboard-header-sub">— แยกตามหมวดหมู่ ค้นด้วยรหัส OEM</span></h2>
        <div className="header-actions">
          {!selectMode ? (
            <>
              <button type="button" onClick={toggleSelectMode}>🖨️ เลือกพิมพ์ QR</button>
              <button className="btn-primary" onClick={openAdd} disabled={categories.length === 0}>+ เพิ่มรายการ</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setSelectedIds(visibleItems.map((i) => i.id))}>เลือกทั้งหมดที่เห็น</button>
              <button type="button" onClick={() => setSelectedIds([])}>ล้างที่เลือก</button>
              <button type="button" className="btn-primary" disabled={selectedIds.length === 0 || printLoading}
                onClick={handlePrintSelected}>
                {printLoading ? 'กำลังโหลด...' : `พิมพ์ QR ที่เลือก (${selectedIds.length})`}
              </button>
              <button type="button" onClick={toggleSelectMode}>ยกเลิก</button>
            </>
          )}
        </div>
      </div>

      <div className="stock-all-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === ALL_TAB}
          className={`stock-all-tab${activeTab === ALL_TAB ? ' stock-all-tab--active' : ''}`}
          onClick={() => setActiveTab(ALL_TAB)}
        >
          ทั้งหมด <span className="stock-all-tab-count">{items.length}</span>
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={activeTab === c.id}
            className={`stock-all-tab${activeTab === c.id ? ' stock-all-tab--active' : ''}`}
            onClick={() => setActiveTab(c.id)}
          >
            {c.name} <span className="stock-all-tab-count">{countsByCategory[c.id] || 0}</span>
          </button>
        ))}
        <button type="button" className="stock-all-tab stock-all-tab--add" onClick={handleAddCategory}>+ หมวดใหม่</button>
        {activeCategory && (
          <button type="button" className="stock-all-tab stock-all-tab--add" onClick={handleRenameCategory}>✏️ แก้ชื่อหมวด</button>
        )}
      </div>

      <div className="search-bar">
        <input
          type="text"
          placeholder="ค้นหารหัส OEM หรือรายละเอียด (ค้นข้ามทุกหมวด)..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searchTerm && (
          <button type="button" className="search-clear" onClick={() => setSearchTerm('')} aria-label="ล้างคำค้นหา">✕</button>
        )}
      </div>

      <div className="stock-all-filters">
        <span className="stock-all-filters-label">กรอง:</span>
        <button type="button" className={`stock-all-chip${stockFilter === 'low' ? ' stock-all-chip--active' : ''}`}
          onClick={() => setStockFilter(stockFilter === 'low' ? '' : 'low')}>⚠️ ใกล้หมด</button>
        <button type="button" className={`stock-all-chip${stockFilter === 'out' ? ' stock-all-chip--active' : ''}`}
          onClick={() => setStockFilter(stockFilter === 'out' ? '' : 'out')}>❌ หมด</button>
      </div>

      {errorMsg && !showForm && <p className="error-text">{errorMsg}</p>}

      <div className="table-wrapper">
        <table className="rack-table">
          <thead>
            <tr>
              {selectMode && <th></th>}
              {showCategoryColumn && <th>หมวด</th>}
              <th>รหัส OEM</th>
              <th>รายละเอียด</th>
              <th>ใช้กับรถ</th>
              <th>จำนวน</th>
              <th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item) => (
              <tr key={item.id}>
                {selectMode && (
                  <td data-label="เลือก">
                    <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelectOne(item.id)} />
                  </td>
                )}
                {showCategoryColumn && <td data-label="หมวด">{item.category_name}</td>}
                <td data-label="รหัส OEM">
                  {item.positions.length === 0 ? (
                    <strong className="stock-all-code">{item.oem_code}</strong>
                  ) : item.positions.map(({ position, oem_code: code }) => (
                    <div key={position} className="stock-all-pos-row">
                      <PositionChip position={position} />
                      <span className="stock-all-code" style={{ color: POSITION_COLOR[position]?.fg }}>
                        {code || '—'}
                      </span>
                    </div>
                  ))}
                </td>
                <td data-label="รายละเอียด">{item.description || '—'}</td>
                <td data-label="ใช้กับรถ">
                  {item.fitments.length === 0 ? '—' : (
                    <div className="stock-all-fitments">
                      {item.fitments.slice(0, 2).map((f, i) => <div key={i}>{formatFitment(f)}</div>)}
                      {item.fitments.length > 2 && (
                        <button type="button" className="stock-all-more" onClick={() => openEdit(item)}>
                          +{item.fitments.length - 2} รุ่น
                        </button>
                      )}
                    </div>
                  )}
                </td>
                <td data-label="จำนวน">
                  {item.positions.length === 0 ? (
                    <QtyBadge qty={item.stock_qty} minStock={item.min_stock} />
                  ) : item.positions.map(({ position, qty }) => (
                    <div key={position} className="stock-all-pos-row">
                      <PositionChip position={position} />
                      <QtyBadge qty={qty} minStock={item.min_stock} />
                    </div>
                  ))}
                </td>
                <td data-label="จัดการ" className="stock-all-actions">
                  <button onClick={() => openEdit(item)}>แก้ไข</button>
                </td>
              </tr>
            ))}
            {visibleItems.length === 0 && (
              <tr>
                <td colSpan={(showCategoryColumn ? 6 : 5) + (selectMode ? 1 : 0)} className="no-result-text">
                  {items.length === 0 ? 'ยังไม่มีรายการ กด "+ เพิ่มรายการ" เพื่อเริ่มกรอก' : 'ไม่พบรายการที่ตรงเงื่อนไข'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── พื้นที่พิมพ์ป้าย QR (ซ่อนบนจอ แสดงเฉพาะตอนพิมพ์ — ดู #qr-print-area ใน app.css) ── */}
      <div id="qr-print-area">
        {printQueue.map((label) => (
          <div className="qr-print-label" key={`${label.item_id}-${label.position || 'one'}`}>
            <img src={label.qrcode} alt={label.code} />
            <div className="qr-print-text">
              <div className="qr-print-code">{label.code}</div>
              <div className="qr-print-name">{label.name}</div>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="modal-backdrop" onClick={closeForm}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">{editingItem ? '✏️ แก้ไขรายการ' : '➕ เพิ่มรายการใหม่'}</h3>
            <form onSubmit={handleSubmit} className="modal-form">
              <label>หมวดหมู่</label>
              <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} required>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>

              <label className="stock-all-check">
                <input
                  type="checkbox"
                  checked={form.has_sides}
                  disabled={Boolean(editingItem)}
                  onChange={(e) => setForm({ ...form, has_sides: e.target.checked })}
                />
                ชิ้นนี้แยกซ้าย / ขวา{editingItem ? ' (เปลี่ยนหลังสร้างไม่ได้)' : ''}
              </label>
              <label className="stock-all-check">
                <input
                  type="checkbox"
                  checked={form.has_axles}
                  disabled={Boolean(editingItem)}
                  onChange={(e) => setForm({ ...form, has_axles: e.target.checked })}
                />
                ชิ้นนี้แยกหน้า / หลัง (เช่น โช๊ค){editingItem ? ' (เปลี่ยนหลังสร้างไม่ได้)' : ''}
              </label>

              {formPositions.length === 0 && (
                <>
                  <label>รหัส OEM</label>
                  <input
                    placeholder="เช่น 45510-0K010"
                    value={form.oem_code}
                    maxLength={100}
                    onChange={(e) => setForm({ ...form, oem_code: e.target.value })}
                    required
                    autoFocus
                  />
                </>
              )}

              <label>รายละเอียดสินค้า</label>
              <input
                placeholder="เช่น แร็คพวงมาลัย TOYOTA VIGO 2WD"
                value={form.description}
                maxLength={500}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />

              {formPositions.length > 0 ? (
                <div className="stock-all-pos-form">
                  <div className="stock-all-pos-form-head">
                    <span />
                    <span>รหัส OEM ของตำแหน่งนี้</span>
                    <span>จำนวน</span>
                  </div>
                  {formPositions.map((position) => (
                    <div key={position} className="stock-all-pos-form-row">
                      <PositionChip position={position} />
                      <input
                        placeholder="รหัส OEM"
                        value={form.codes[position] ?? ''}
                        maxLength={100}
                        onChange={(e) => setForm({ ...form, codes: { ...form.codes, [position]: e.target.value } })}
                      />
                      <input type="number" min="0" step="1" value={form.stocks[position] ?? 0}
                        onChange={(e) => setForm({ ...form, stocks: { ...form.stocks, [position]: e.target.value } })} required />
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <label>จำนวนคงเหลือ</label>
                  <input type="number" min="0" step="1" value={form.stock_qty}
                    onChange={(e) => setForm({ ...form, stock_qty: e.target.value })} required />
                </>
              )}

              <label>แจ้งเตือนเมื่อต่ำกว่าหรือเท่ากับ</label>
              <input type="number" min="0" step="1" value={form.min_stock}
                onChange={(e) => setForm({ ...form, min_stock: e.target.value })} required />

              <label>ใช้กับรถรุ่นไหน / ปีอะไร (ปี ค.ศ.)</label>
              <div className="stock-all-fit-list">
                {form.fitments.map((f, index) => (
                  <div key={index} className="stock-all-fit-row">
                    <input placeholder="ยี่ห้อ" list="stock-all-brands" value={f.brand} maxLength={100}
                      onChange={(e) => updateFitment(index, 'brand', e.target.value)} />
                    <input placeholder="รุ่น" list="stock-all-models" value={f.model} maxLength={100}
                      onChange={(e) => updateFitment(index, 'model', e.target.value)} />
                    <input type="number" placeholder="ปีเริ่ม" min="1950" max="2100" value={f.year_from}
                      onChange={(e) => updateFitment(index, 'year_from', e.target.value)} />
                    <input type="number" placeholder="ถึงปี" min="1950" max="2100" value={f.year_to}
                      onChange={(e) => updateFitment(index, 'year_to', e.target.value)} />
                    <button type="button" className="stock-all-fit-remove" onClick={() => removeFitment(index)}
                      aria-label="ลบรุ่นรถนี้">✕</button>
                  </div>
                ))}
                <button type="button" className="stock-all-tab stock-all-tab--add" onClick={addFitment}>+ เพิ่มรุ่นรถ</button>
              </div>
              <datalist id="stock-all-brands">{brandOptions.map((b) => <option key={b} value={b} />)}</datalist>
              <datalist id="stock-all-models">{modelOptions.map((m) => <option key={m} value={m} />)}</datalist>

              {errorMsg && <p className="error-text">{errorMsg}</p>}

              <div className="modal-actions">
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'กำลังบันทึก...' : editingItem ? 'บันทึกการแก้ไข' : 'เพิ่มรายการ'}
                </button>
                <button type="button" onClick={closeForm}>ยกเลิก</button>
              </div>
            </form>

            {editingItem && (
              <>
                <div className="stock-all-history">
                  <h4>ประวัติการเปลี่ยนจำนวน</h4>
                  {movements.length === 0 ? (
                    <p className="stock-all-history-empty">ยังไม่มีประวัติ</p>
                  ) : (
                    <ul>
                      {movements.map((m) => (
                        <li key={m.id}>
                          <span>{formatDateTime(m.created_at)} · {m.user_name}</span>
                          <span>{REASON_LABEL[m.reason] || m.reason}{m.position ? ` (${POSITION_LABEL[m.position] || m.position})` : ''}: {m.qty_before} → <strong>{m.qty_after}</strong></span>
                          {m.note && <em>{m.note}</em>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="modal-delete-zone">
                  <hr />
                  <button className="btn-danger btn-full" type="button" onClick={handleHide}>🗑️ ซ่อนรายการนี้</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
