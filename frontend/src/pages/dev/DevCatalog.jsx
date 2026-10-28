import React, { useCallback, useEffect, useState } from 'react';
import client from '../../api/client';
import ComboInput from '../../components/ComboInput';
import { formatMoney } from '../../utils/format';
import { formatDateTime } from './DevOverview';

// Shared parts catalogue (สมุดกลาง): models typed in by shops waiting for review, the vehicle model list,
// and the master parts / prices every shop starts from.

const TABS = [
  { key: 'pending', label: 'รอตรวจ' },
  { key: 'models', label: 'รุ่นรถ' },
  { key: 'parts', label: 'อะไหล่และราคากลาง' },
];

function errorText(err, fallback) {
  return err.response?.data?.error || fallback;
}

export default function DevCatalog({ onChanged }) {
  const [tab, setTab] = useState('pending');
  const [summary, setSummary] = useState(null);

  const loadSummary = useCallback(() => {
    client.get('/dev/catalog/summary').then((res) => setSummary(res.data.data)).catch(() => {});
  }, []);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const changed = () => {
    loadSummary();
    if (onChanged) onChanged();
  };

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>สมุดรุ่นรถและราคากลาง</h1>
          <p className="subtitle">
            {summary
              ? `${summary.brands} ยี่ห้อ · ${summary.models} รุ่น · ${summary.parts} อะไหล่ในสมุดกลาง`
              : 'ข้อมูลกลางที่ทุกร้านใช้ร่วมกัน แก้ได้เฉพาะแอดมิน'}
          </p>
        </div>
      </div>

      <div className="dev-tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`dev-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === 'pending' && summary && summary.pending > 0 && <span className="dev-tab-count">{summary.pending}</span>}
          </button>
        ))}
      </div>

      {tab === 'pending' && <PendingTab onChanged={changed} />}
      {tab === 'models' && <ModelsTab onChanged={changed} />}
      {tab === 'parts' && <PartsTab onChanged={changed} />}
    </div>
  );
}

// ── models typed in by staff ────────────────────────────────────────────────

function PendingTab({ onChanged }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    client.get('/dev/catalog/pending')
      .then((res) => setRows(res.data.data))
      .catch((err) => setError(errorText(err, 'โหลดไม่สำเร็จ')))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (request, fallback) => {
    try {
      await request();
      setError('');
      load();
      onChanged();
    } catch (err) {
      setError(errorText(err, fallback));
    }
  };

  const approve = (row) => {
    if (!window.confirm(`อนุมัติ "${row.brand} ${row.model}" เข้าสมุดกลาง? ทุกร้านจะเห็นรุ่นนี้`)) return;
    act(() => client.post(`/dev/catalog/pending/${row.id}/approve`), 'อนุมัติไม่สำเร็จ');
  };
  const reject = (row) => {
    if (!window.confirm(`ปฏิเสธ "${row.brand} ${row.model}"? งานที่ร้านบันทึกไว้แล้วยังใช้ชื่อเดิม`)) return;
    act(() => client.delete(`/dev/catalog/pending/${row.id}`), 'ปฏิเสธไม่สำเร็จ');
  };

  return (
    <>
      <p className="subtitle">รุ่นที่พนักงานพิมพ์เองเพราะหาไม่เจอ ร้านที่ส่งมาเห็นและใช้ได้ทันที ร้านอื่นยังไม่เห็นจนกว่าจะอนุมัติ</p>
      {error && <div className="error-message">{error}</div>}
      {loading ? <div className="loading">กำลังโหลด...</div> : rows.length === 0 ? (
        <div className="empty-message">ไม่มีรุ่นรอตรวจ</div>
      ) : (
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead><tr><th>ยี่ห้อ</th><th>รุ่นที่พิมพ์</th><th>ร้าน</th><th>ส่งเมื่อ</th><th>รุ่นใกล้เคียงในสมุด</th><th>จัดการ</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td data-label="ยี่ห้อ">{r.brand}</td>
                  <td data-label="รุ่นที่พิมพ์"><strong>{r.model}</strong></td>
                  <td data-label="ร้าน">{r.shop_name || '-'}<div className="dev-detail">{r.submitted_by || ''}</div></td>
                  <td data-label="ส่งเมื่อ">{formatDateTime(r.submitted_at)}</td>
                  <td data-label="รุ่นใกล้เคียงในสมุด">
                    {r.similar.length === 0 ? <span className="dev-detail">ไม่พบ ดูเป็นรุ่นใหม่</span>
                      : r.similar.map((s) => <span key={s.id} className="dev-chip">{s.label}</span>)}
                  </td>
                  <td className="actions" data-label="จัดการ">
                    <button type="button" onClick={() => approve(r)}>อนุมัติ</button>
                    <button type="button" onClick={() => setMerging(r)}>รวมกับรุ่นที่มีอยู่</button>
                    <button type="button" className="btn-danger" onClick={() => reject(r)}>ปฏิเสธ</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {merging && (
        <MergeModal
          row={merging}
          onClose={() => setMerging(null)}
          onMerge={(targetId) => {
            setMerging(null);
            act(() => client.post(`/dev/catalog/pending/${merging.id}/merge`, { target_id: targetId }), 'รวมรุ่นไม่สำเร็จ');
          }}
        />
      )}
    </>
  );
}

function MergeModal({ row, onClose, onMerge }) {
  const [models, setModels] = useState([]);
  const [text, setText] = useState(row.similar[0]?.label || '');

  useEffect(() => {
    client.get('/dev/catalog/models', { params: { brand: row.brand } }).then((res) => setModels(res.data.data));
  }, [row.brand]);

  const target = models.find((m) => m.label === text);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card medium" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>รวม “{row.model}” กับรุ่นที่มีอยู่</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>
        <p className="subtitle">
          รถ ใบเสนอราคา และราคาอะไหล่ของร้าน {row.shop_name} ที่ใช้ชื่อ “{row.model}” จะถูกเปลี่ยนเป็นชื่อรุ่นที่เลือก
        </p>
        <div className="form-group">
          <label>รุ่นในสมุดของ {row.brand}</label>
          <ComboInput value={text} onChange={setText} options={models.map((m) => ({ value: m.label }))} placeholder="พิมพ์ค้นหารุ่น" />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" disabled={!target} onClick={() => onMerge(target.id)}>รวมรุ่น</button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>ยกเลิก</button>
        </div>
      </div>
    </div>
  );
}

// ── vehicle models ──────────────────────────────────────────────────────────

function ModelsTab({ onChanged }) {
  const [brands, setBrands] = useState([]);
  const [brand, setBrand] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);

  const loadBrands = useCallback(() => {
    client.get('/dev/catalog/brands').then((res) => setBrands(res.data.data));
  }, []);
  useEffect(() => { loadBrands(); }, [loadBrands]);

  const load = useCallback(() => {
    client.get('/dev/catalog/models', { params: { brand, search } })
      .then((res) => setRows(res.data.data))
      .catch((err) => setError(errorText(err, 'โหลดไม่สำเร็จ')));
  }, [brand, search]);
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const save = async (e) => {
    e.preventDefault();
    try {
      const body = { brand: form.brand, model: form.model, year_range: form.year_range };
      if (form.id) await client.patch(`/dev/catalog/models/${form.id}`, body);
      else await client.post('/dev/catalog/models', body);
      setForm(null);
      setError('');
      load();
      loadBrands();
      onChanged();
    } catch (err) {
      setError(errorText(err, 'บันทึกไม่สำเร็จ'));
    }
  };

  const renameBrand = async () => {
    const to = window.prompt(`ชื่อใหม่ของยี่ห้อ "${brand}" (เปลี่ยนในสมุด ราคากลาง และราคาของทุกร้าน)`, brand);
    if (!to || to.trim() === brand) return;
    try {
      await client.patch('/dev/catalog/brands', { from: brand, to: to.trim() });
      setBrand(to.trim());
      setError('');
      loadBrands();
      onChanged();
    } catch (err) {
      setError(errorText(err, 'เปลี่ยนชื่อยี่ห้อไม่สำเร็จ'));
    }
  };

  return (
    <>
      {error && <div className="error-message">{error}</div>}
      <div className="qpp-filter-bar">
        <div className="form-group">
          <label>ยี่ห้อ</label>
          <select value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">-- ทุกยี่ห้อ --</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="form-group qpp-filter-search">
          <label>ค้นหา</label>
          <input type="text" className="search-input" placeholder="ยี่ห้อ/รุ่น" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="form-group">
          <label>&nbsp;</label>
          <div className="dev-purge-row">
            <button type="button" className="btn btn-primary" onClick={() => setForm({ brand, model: '', year_range: '' })}>+ เพิ่มรุ่น</button>
            {brand && <button type="button" className="btn btn-secondary" onClick={renameBrand}>เปลี่ยนชื่อยี่ห้อ</button>}
          </div>
        </div>
      </div>

      <div className="quotation-table-wrap">
        <table className="quotation-table">
          <thead><tr><th>ยี่ห้อ</th><th>รุ่น</th><th>ช่วงปี</th><th>จัดการ</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label="ยี่ห้อ">{r.brand}</td>
                <td data-label="รุ่น">{r.model}</td>
                <td data-label="ช่วงปี">{r.year_range || '-'}</td>
                <td className="actions" data-label="จัดการ">
                  <button type="button" onClick={() => setForm({ id: r.id, brand: r.brand, model: r.model, year_range: r.year_range || '' })}>แก้ไข</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan="4" className="empty-message">ไม่พบรุ่นรถ</td></tr>}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="modal-backdrop" onClick={() => setForm(null)}>
          <div className="modal-card medium" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{form.id ? 'แก้ไขรุ่นรถ' : 'เพิ่มรุ่นรถ'}</h2>
              <button className="btn-close" onClick={() => setForm(null)}>✕</button>
            </div>
            {form.id && <div className="info-message">เปลี่ยนชื่อแล้ว ราคากลางและราคาของทุกร้านที่ผูกกับรุ่นนี้จะเปลี่ยนตาม</div>}
            <form onSubmit={save} className="modal-form">
              <div className="form-group">
                <label>ยี่ห้อ</label>
                <input type="text" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>รุ่น</label>
                <input type="text" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>ช่วงปี (ถ้ามี)</label>
                <input type="text" value={form.year_range} onChange={(e) => setForm({ ...form, year_range: e.target.value })} placeholder="เช่น 2012-2018" />
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary">บันทึก</button>
                <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>ยกเลิก</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ── master parts and prices ─────────────────────────────────────────────────

function PartsTab({ onChanged }) {
  const [brands, setBrands] = useState([]);
  const [brand, setBrand] = useState('');
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);

  useEffect(() => {
    client.get('/dev/catalog/brands').then((res) => setBrands(res.data.data));
  }, []);
  useEffect(() => {
    setModel('');
    if (!brand) { setModels([]); return; }
    client.get('/dev/catalog/models', { params: { brand } }).then((res) => setModels(res.data.data));
  }, [brand]);

  const ready = Boolean((brand && model) || search.trim());
  const load = useCallback(() => {
    if (!ready) { setRows([]); return; }
    client.get('/dev/catalog/parts', { params: { brand, model, search: search.trim() } })
      .then((res) => setRows(res.data.data))
      .catch((err) => setError(errorText(err, 'โหลดไม่สำเร็จ')));
  }, [brand, model, search, ready]);
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const patch = async (row, body, fallback) => {
    try {
      await client.patch(`/dev/catalog/parts/${row.id}`, body);
      setError('');
      load();
      onChanged();
    } catch (err) {
      setError(errorText(err, fallback));
    }
  };

  const changePrice = (row) => {
    const input = window.prompt(`ราคากลางใหม่ของ "${row.part_name}" (${row.model})\nร้านที่ยังไม่ปรับราคาเองจะได้ราคานี้ทันที`, String(Number(row.price)));
    if (input === null || input.trim() === '') return;
    const price = Number(input);
    if (!Number.isFinite(price) || price < 0) { setError('ราคาไม่ถูกต้อง'); return; }
    patch(row, { price }, 'แก้ราคาไม่สำเร็จ');
  };

  const toggleActive = (row) => {
    const text = row.is_active
      ? `ซ่อน "${row.part_name}" จากทุกร้าน? (ไม่ลบ เปิดกลับมาได้)`
      : `เปิด "${row.part_name}" ให้ทุกร้านเห็นอีกครั้ง?`;
    if (window.confirm(text)) patch(row, { is_active: !row.is_active }, 'แก้ไขไม่สำเร็จ');
  };

  const rename = (row) => {
    const name = window.prompt('ชื่ออะไหล่ใหม่ (ชื่อที่ร้านปรับราคาไว้จะเปลี่ยนตามด้วย)', row.part_name);
    if (name && name.trim() !== row.part_name) patch(row, { part_name: name.trim() }, 'เปลี่ยนชื่อไม่สำเร็จ');
  };

  const add = async (e) => {
    e.preventDefault();
    try {
      await client.post('/dev/catalog/parts', {
        brand, model, part_name: form.part_name, category: form.category, description: form.description, price: Number(form.price) || 0,
      });
      setForm(null);
      setError('');
      load();
      onChanged();
    } catch (err) {
      setError(errorText(err, 'เพิ่มอะไหล่ไม่สำเร็จ'));
    }
  };

  return (
    <>
      <p className="subtitle">ราคากลางที่ร้านใหม่ทุกร้านเริ่มใช้ แก้ราคาแล้วร้านที่ไม่ได้ตั้งราคาเองจะเปลี่ยนตามทันที ร้านที่ตั้งราคาเองไว้ไม่ถูกแตะ</p>
      {error && <div className="error-message">{error}</div>}
      <div className="qpp-filter-bar">
        <div className="form-group">
          <label>ยี่ห้อ</label>
          <select value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">-- เลือกยี่ห้อ --</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>รุ่น</label>
          <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!brand}>
            <option value="">-- เลือกรุ่น --</option>
            {models.map((m) => <option key={m.id} value={m.label}>{m.label}</option>)}
          </select>
        </div>
        <div className="form-group qpp-filter-search">
          <label>หรือค้นหาชื่ออะไหล่ข้ามรุ่น</label>
          <input type="text" className="search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ชื่ออะไหล่/รายละเอียด" />
        </div>
        <div className="form-group">
          <label>&nbsp;</label>
          <button
            type="button" className="btn btn-primary" disabled={!(brand && model)}
            title={brand && model ? undefined : 'เลือกยี่ห้อและรุ่นก่อน'}
            onClick={() => setForm({ part_name: '', category: '', description: '', price: '' })}
          >
            + เพิ่มอะไหล่
          </button>
        </div>
      </div>

      {!ready ? <div className="empty-message">เลือกยี่ห้อและรุ่น หรือพิมพ์ค้นหา เพื่อดูอะไหล่</div> : (
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead><tr><th>ยี่ห้อ / รุ่น</th><th>อะไหล่</th><th>หมวด</th><th>ราคากลาง</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.is_active ? '' : 'row-muted'}>
                  <td data-label="ยี่ห้อ / รุ่น">{r.brand} · {r.model}</td>
                  <td data-label="อะไหล่">{r.part_name}{r.description && <div className="dev-detail">{r.description}</div>}</td>
                  <td data-label="หมวด">{r.category || '-'}</td>
                  <td data-label="ราคากลาง">{r.needs_price ? <span className="dev-chip">ยังไม่ตั้งราคา</span> : `฿${formatMoney(r.price)}`}</td>
                  <td data-label="สถานะ">{r.is_active ? 'ใช้งาน' : 'ซ่อนอยู่'}</td>
                  <td className="actions" data-label="จัดการ">
                    <button type="button" onClick={() => changePrice(r)}>แก้ราคา</button>
                    <button type="button" onClick={() => rename(r)}>แก้ชื่อ</button>
                    <button type="button" className={r.is_active ? 'btn-danger' : ''} onClick={() => toggleActive(r)}>{r.is_active ? 'ซ่อน' : 'เปิดใช้'}</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan="6" className="empty-message">ไม่พบอะไหล่</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <div className="modal-backdrop" onClick={() => setForm(null)}>
          <div className="modal-card medium" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>เพิ่มอะไหล่ให้ {brand} · {model}</h2>
              <button className="btn-close" onClick={() => setForm(null)}>✕</button>
            </div>
            <form onSubmit={add} className="modal-form">
              <div className="form-group">
                <label>ชื่ออะไหล่</label>
                <input type="text" value={form.part_name} onChange={(e) => setForm({ ...form, part_name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>หมวด (ถ้ามี)</label>
                <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </div>
              <div className="form-group">
                <label>รายละเอียด (ถ้ามี)</label>
                <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="form-group">
                <label>ราคากลาง (บาท)</label>
                <input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary">บันทึก</button>
                <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>ยกเลิก</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
