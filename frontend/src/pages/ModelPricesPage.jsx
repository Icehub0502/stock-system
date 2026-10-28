import React, { useCallback, useEffect, useState } from 'react';
import client from '../api/client';
import ComboInput from '../components/ComboInput';
import { formatMoney } from '../utils/format';

// Standard prices per vehicle generation (shared by every branch of the same owner), and the prices staff keep typing
// on quotations that a manager can promote to standard prices. See backend/src/routes/modelPrices.routes.js.

const TABS = [
  { key: 'prices', label: 'ราคามาตรฐาน' },
  { key: 'typed', label: 'ราคาที่พนักงานกรอกบ่อย' },
];

const errorText = (err, fallback) => err.response?.data?.error || fallback;

export default function ModelPricesPage() {
  const [tab, setTab] = useState('prices');
  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>ราคามาตรฐานตามรุ่นรถ</h1>
          <p className="subtitle">
            ราคาของแร็ค ชุดโปรช่วงล่าง โช๊ค ฯลฯ ต่อรุ่นรถ (แยกตามเจเนอเรชัน) ใช้ร่วมกันทุกสาขาของเจ้าของเดียวกัน
            ขึ้นให้อัตโนมัติในใบเสนอราคา
          </p>
        </div>
      </div>
      <div className="dev-tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`dev-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'prices' ? <PricesTab /> : <TypedPricesTab />}
    </div>
  );
}

// brand + generation pickers: the brand is searched, then its generations ("Vios ปี '13-22'") are searched
function useBrandModels(brandText) {
  const [brands, setBrands] = useState([]);
  const [models, setModels] = useState([]);
  useEffect(() => {
    client.get('/vehicle-models/brands').then((res) => setBrands(res.data.data || [])).catch(() => setBrands([]));
  }, []);
  const brand = brands.find((b) => b.toLowerCase() === brandText.trim().toLowerCase()) || '';
  useEffect(() => {
    if (!brand) { setModels([]); return; }
    client.get('/vehicle-models/models', { params: { brand } })
      .then((res) => setModels((res.data.data || []).filter((m) => !m.pending).map((m) => ({ id: m.id, display_name: m.display_name }))))
      .catch(() => setModels([]));
  }, [brand]);
  return { brands, brand, models };
}

function PricesTab() {
  const [brandText, setBrandText] = useState('');
  const [modelText, setModelText] = useState('');
  const [search, setSearch] = useState('');
  const { brands, brand, models } = useBrandModels(brandText);
  const model = models.find((m) => m.display_name === modelText);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    client.get('/model-prices', { params: { brand: brand || undefined, vehicle_model_id: model?.id, search: search.trim() || undefined } })
      .then((res) => { setRows(res.data.data); setError(''); })
      .catch((err) => setError(errorText(err, 'โหลดไม่สำเร็จ')))
      .finally(() => setLoading(false));
  }, [brand, model?.id, search]);
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const remove = async (row) => {
    if (!window.confirm(`เอาราคามาตรฐานของ "${row.item_name}" (${row.brand} ${row.display_name}) ออก? ข้อมูลยังเก็บไว้ในระบบ`)) return;
    try {
      await client.delete(`/model-prices/${row.id}`);
      load();
    } catch (err) {
      setError(errorText(err, 'ลบไม่สำเร็จ'));
    }
  };

  return (
    <>
      {error && <div className="error-message">{error}</div>}
      <div className="qpp-filter-bar">
        <div className="form-group">
          <label>ยี่ห้อ</label>
          <ComboInput value={brandText} options={brands.map((b) => ({ value: b }))} allowCustom={false} placeholder="ทุกยี่ห้อ พิมพ์ค้นหา"
            onChange={(v) => { setBrandText(v); setModelText(''); }} />
        </div>
        <div className="form-group">
          <label>รุ่น (ปี)</label>
          <ComboInput value={modelText} options={models.map((m) => ({ value: m.display_name }))} allowCustom={false}
            disabled={!brand} placeholder={brand ? 'ทุกรุ่น พิมพ์ค้นหา' : 'เลือกยี่ห้อก่อน'} onChange={setModelText} />
        </div>
        <div className="form-group qpp-filter-search">
          <label>ชื่อรายการ</label>
          <input type="text" className="search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="เช่น โช๊ค แร็ค ชุดโปร" />
        </div>
        <div className="form-group">
          <label>&nbsp;</label>
          <button type="button" className="btn btn-primary" onClick={() => setForm({ brandText: brand || brandText, modelText: model ? model.display_name : '', item_name: '', part_price: '', labor_price: '', is_set: false })}>
            + เพิ่มราคามาตรฐาน
          </button>
        </div>
      </div>

      {loading ? <div className="loading">กำลังโหลด...</div> : rows.length === 0 ? (
        <div className="empty-message">ยังไม่มีราคามาตรฐาน กด "+ เพิ่มราคามาตรฐาน" หรือรอให้พนักงานทำใบเสนอราคา แล้วดูที่แท็บ "ราคาที่พนักงานกรอกบ่อย"</div>
      ) : (
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead><tr><th>ยี่ห้อ / รุ่น</th><th>รายการ</th><th>ราคา</th><th>ค่าแรง (แยกบรรทัด)</th><th>แก้ล่าสุด</th><th>จัดการ</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td data-label="ยี่ห้อ / รุ่น">{r.brand} · {r.display_name}</td>
                  <td data-label="รายการ">{r.item_name}{r.is_set ? <span className="dev-chip">ชุด</span> : null}</td>
                  <td data-label="ราคา">฿{formatMoney(r.part_price)}</td>
                  <td data-label="ค่าแรง">{r.labor_price != null ? `฿${formatMoney(r.labor_price)}` : <span className="dev-detail">รวมในราคา</span>}</td>
                  <td data-label="แก้ล่าสุด">{r.updated_by || '-'}</td>
                  <td className="actions" data-label="จัดการ">
                    <button type="button" onClick={() => setForm({
                      id: r.id, vehicle_model_id: r.vehicle_model_id, brandText: r.brand, modelText: r.display_name, item_name: r.item_name,
                      part_price: String(Number(r.part_price)), labor_price: r.labor_price != null ? String(Number(r.labor_price)) : '', is_set: Boolean(r.is_set),
                    })}>แก้ไข</button>
                    <button type="button" className="btn-danger" onClick={() => remove(r)}>ลบ</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && <PriceForm initial={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </>
  );
}

function PriceForm({ initial, onClose, onSaved }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [itemOptions, setItemOptions] = useState([]);
  const editing = Boolean(initial.id);
  const { brands, models } = useBrandModels(form.brandText);
  const model = editing ? { id: initial.vehicle_model_id } : models.find((m) => m.display_name === form.modelText);

  // items of the product & service list matching what is typed
  useEffect(() => {
    if (editing || !form.item_name.trim()) { setItemOptions([]); return undefined; }
    const timer = setTimeout(() => {
      client.get('/service-items', { params: { search: form.item_name.trim() } })
        .then((res) => setItemOptions([...new Set((res.data.data || []).map((it) => it.product_name))].slice(0, 30).map((name) => ({ value: name }))))
        .catch(() => setItemOptions([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [form.item_name, editing]);

  const save = async (e) => {
    e.preventDefault();
    if (!model) { setError('กรุณาเลือกยี่ห้อและรุ่น (ปี) จากรายการ'); return; }
    setSaving(true);
    setError('');
    try {
      await client.put('/model-prices', {
        vehicle_model_id: model.id,
        item_name: form.item_name,
        part_price: form.part_price,
        labor_price: form.labor_price === '' ? null : form.labor_price,
        is_set: form.is_set,
      });
      onSaved();
    } catch (err) {
      setError(errorText(err, 'บันทึกไม่สำเร็จ'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => !saving && onClose()}>
      <div className="modal-card medium" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{editing ? 'แก้ราคามาตรฐาน' : 'เพิ่มราคามาตรฐาน'}</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>
        {error && <div className="error-message">{error}</div>}
        <form onSubmit={save} className="modal-form">
          <div className="form-group">
            <label>ยี่ห้อ</label>
            {editing ? <input type="text" value={form.brandText} disabled /> : (
              <ComboInput value={form.brandText} options={brands.map((b) => ({ value: b }))} allowCustom={false} placeholder="พิมพ์ค้นหายี่ห้อ"
                onChange={(v) => setForm({ ...form, brandText: v, modelText: '' })} />
            )}
          </div>
          <div className="form-group">
            <label>รุ่น (ปี)</label>
            {editing ? <input type="text" value={form.modelText} disabled /> : (
              <ComboInput value={form.modelText} options={models.map((m) => ({ value: m.display_name }))} allowCustom={false}
                disabled={models.length === 0} placeholder={models.length === 0 ? 'เลือกยี่ห้อก่อน' : 'พิมพ์ค้นหา เช่น vios 13'}
                onChange={(v) => setForm({ ...form, modelText: v })} />
            )}
          </div>
          <div className="form-group">
            <label>ชื่อรายการ (ตรงกับในรายการสินค้า/บริการ)</label>
            {editing ? <input type="text" value={form.item_name} disabled /> : (
              <ComboInput value={form.item_name} options={itemOptions} customLabel="ใช้ชื่อที่พิมพ์" placeholder="เช่น โช๊คอัพหน้า"
                onChange={(v) => setForm({ ...form, item_name: v })} />
            )}
          </div>
          <div className="form-group">
            <label>ราคา (บาท) — ราคาที่ขายลูกค้า ส่วนใหญ่รวมค่าแรงแล้ว</label>
            <input type="number" min="0" step="0.01" value={form.part_price} onChange={(e) => setForm({ ...form, part_price: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>ค่าแรงแยกบรรทัด (บาท) — ใส่เฉพาะรายการที่คิดค่าแรงแยก เว้นว่างถ้ารวมในราคาแล้ว</label>
            <input type="number" min="0" step="0.01" value={form.labor_price} onChange={(e) => setForm({ ...form, labor_price: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="dev-year-present">
              <input type="checkbox" checked={form.is_set} onChange={(e) => setForm({ ...form, is_set: e.target.checked })} />
              เป็นชุด (ราคานี้คือราคารวมทั้งชุด เช่น ชุดโปรช่วงล่าง)
            </label>
          </div>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>ยกเลิก</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TypedPricesTab() {
  const [rows, setRows] = useState([]);
  const [min, setMin] = useState(2);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    client.get('/model-prices/suggestions', { params: { min } })
      .then((res) => { setRows(res.data.data); setError(''); })
      .catch((err) => setError(errorText(err, 'โหลดไม่สำเร็จ')))
      .finally(() => setLoading(false));
  }, [min]);
  useEffect(() => { load(); }, [load]);

  const promote = async (row) => {
    const input = window.prompt(
      `ตั้งราคามาตรฐานของ "${row.item_name}" (${row.brand} ${row.model_name})\n${row.stable ? 'ราคา 3 ครั้งล่าสุดเท่ากัน' : 'ราคาที่กรอกยังไม่นิ่ง ตรวจดูก่อน'}`,
      String(row.last_price)
    );
    if (input === null || input.trim() === '') return;
    const price = Number(input);
    if (!Number.isFinite(price) || price < 0) { setError('ราคาไม่ถูกต้อง'); return; }
    try {
      await client.put('/model-prices', { vehicle_model_id: row.vehicle_model_id, item_name: row.item_name, part_price: price });
      load();
    } catch (err) {
      setError(errorText(err, 'บันทึกไม่สำเร็จ'));
    }
  };

  return (
    <>
      <p className="subtitle">
        ราคาที่พนักงานกรอกเองในใบเสนอราคา แยกตามรุ่นรถและรายการ เมื่อเห็นว่าราคานิ่งแล้ว กด "ตั้งเป็นราคามาตรฐาน"
        (ระบบแจ้ง "นิ่งแล้ว" เมื่อราคา 3 ครั้งล่าสุดเท่ากัน) รายการที่ราคาล่าสุดเท่ากับราคามาตรฐานอยู่แล้วจะไม่แสดง
      </p>
      {error && <div className="error-message">{error}</div>}
      <div className="qpp-filter-bar">
        <div className="form-group">
          <label>แสดงรายการที่กรอกอย่างน้อย</label>
          <select value={min} onChange={(e) => setMin(Number(e.target.value))}>
            {[1, 2, 3, 5].map((n) => <option key={n} value={n}>{n} ครั้ง</option>)}
          </select>
        </div>
      </div>
      {loading ? <div className="loading">กำลังโหลด...</div> : rows.length === 0 ? (
        <div className="empty-message">ยังไม่มีรายการ (ต้องเลือกรุ่นรถในใบเสนอราคาก่อน ระบบถึงจดราคาให้)</div>
      ) : (
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead><tr><th>ยี่ห้อ / รุ่น</th><th>รายการ</th><th>กรอกมา</th><th>ราคา 3 ครั้งล่าสุด</th><th>ต่ำสุด-สูงสุด</th><th>มาตรฐานตอนนี้</th><th>จัดการ</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.vehicle_model_id}|${r.item_name}`}>
                  <td data-label="ยี่ห้อ / รุ่น">{r.brand} · {r.model_name}</td>
                  <td data-label="รายการ">{r.item_name}{r.stable ? <span className="dev-chip">นิ่งแล้ว</span> : null}</td>
                  <td data-label="กรอกมา">{r.times} ครั้ง</td>
                  <td data-label="ราคา 3 ครั้งล่าสุด">{r.recent_prices.map((p) => `฿${formatMoney(p)}`).join(' · ')}</td>
                  <td data-label="ต่ำสุด-สูงสุด">฿{formatMoney(r.min_price)} - ฿{formatMoney(r.max_price)}</td>
                  <td data-label="มาตรฐานตอนนี้">{r.standard_price != null ? `฿${formatMoney(r.standard_price)}` : <span className="dev-detail">ยังไม่มี</span>}</td>
                  <td className="actions" data-label="จัดการ">
                    <button type="button" onClick={() => promote(r)}>ตั้งเป็นราคามาตรฐาน</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
