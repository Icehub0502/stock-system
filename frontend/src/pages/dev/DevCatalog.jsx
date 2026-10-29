import React, { useCallback, useEffect, useState } from 'react';
import client from '../../api/client';
import ComboInput from '../../components/ComboInput';
import { formatDateTime } from './DevOverview';

// Shared vehicle model book (สมุดรุ่นรถ): models typed in by shops waiting for review, and the vehicle model list.
// (The old master parts / prices screen is gone; standard prices now live in pages/ModelPricesPage.jsx.)

const TABS = [
  { key: 'pending', label: 'รอตรวจ' },
  { key: 'models', label: 'รุ่นรถ' },
];

// "2013-2022" / "2022-ปัจจุบัน" <-> the three year fields of the form; text that does not fit (old rows such as
// "1990s-2001") is kept as it is until the administrator types a new range
function parseYears(yearRange) {
  const match = /^(\d{4})-(\d{4}|ปัจจุบัน)$/.exec(yearRange || '');
  if (!match) return { year_from: '', year_to: '', to_present: false, year_raw: yearRange || '' };
  return { year_from: match[1], year_to: match[2] === 'ปัจจุบัน' ? '' : match[2], to_present: match[2] === 'ปัจจุบัน', year_raw: '' };
}

function composeYears(form) {
  if (!form.year_from) return form.year_raw || '';
  return `${form.year_from}-${form.to_present || !form.year_to ? 'ปัจจุบัน' : form.year_to}`;
}

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
              ? `${summary.brands} ยี่ห้อ · ${summary.models} รุ่น`
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
          รถและใบเสนอราคาของร้าน {row.shop_name} ที่ใช้ชื่อ “{row.model}” จะถูกเปลี่ยนเป็นชื่อรุ่นที่เลือก
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
      const body = { brand: form.brand, model: form.model, year_range: composeYears(form) };
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

  const removeModel = async (row) => {
    if (!window.confirm(`ลบรุ่น "${row.brand} ${row.display_name}" ออกจากสมุด?
รถของลูกค้าที่ใช้ชื่อนี้จะยังอยู่ แต่ต้องเลือกรุ่นใหม่ตอนใช้ราคามาตรฐาน`)) return;
    try {
      await client.delete(`/dev/catalog/models/${row.id}`);
      setError('');
      load();
      loadBrands();
      onChanged();
    } catch (err) {
      setError(errorText(err, 'ลบรุ่นรถไม่สำเร็จ'));
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
            <button type="button" className="btn btn-primary" onClick={() => setForm({ brand, model: '', ...parseYears(''), newBrand: false })}>+ เพิ่มรุ่น</button>
            <button type="button" className="btn btn-primary" onClick={() => setForm({ brand: '', model: '', ...parseYears(''), newBrand: true })}>+ เพิ่มยี่ห้อใหม่</button>
            {brand && <button type="button" className="btn btn-secondary" onClick={renameBrand}>เปลี่ยนชื่อยี่ห้อ</button>}
          </div>
        </div>
      </div>

      <div className="quotation-table-wrap">
        <table className="quotation-table">
          <thead><tr><th>ยี่ห้อ</th><th>ชื่อรุ่น (ที่พนักงานเห็น)</th><th>ช่วงปี</th><th>จัดการ</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label="ยี่ห้อ">{r.brand}</td>
                <td data-label="ชื่อรุ่น">{r.display_name}</td>
                <td data-label="ช่วงปี">{r.year_range || '-'}</td>
                <td className="actions" data-label="จัดการ">
                  <button type="button" onClick={() => setForm({ id: r.id, brand: r.brand, model: r.model, ...parseYears(r.year_range), newBrand: false })}>แก้ไข</button>
                  <button type="button" className="btn-danger" onClick={() => removeModel(r)}>ลบ</button>
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
              <h2>{form.id ? 'แก้ไขรุ่นรถ' : (form.newBrand ? 'เพิ่มยี่ห้อใหม่' : 'เพิ่มรุ่นรถ')}</h2>
              <button className="btn-close" onClick={() => setForm(null)}>✕</button>
            </div>
            {error && <div className="error-message">{error}</div>}
            {form.id && <div className="info-message">เปลี่ยนชื่อแล้ว ราคากลางและราคาของทุกร้านที่ผูกกับรุ่นนี้จะเปลี่ยนตาม</div>}
            {form.newBrand && <div className="info-message">ยี่ห้อใหม่เกิดจากการเพิ่มรุ่นแรกของยี่ห้อนั้น กรอกชื่อยี่ห้อและรุ่นแรกด้านล่าง</div>}
            <form onSubmit={save} className="modal-form">
              <div className="form-group">
                <label>ยี่ห้อ</label>
                <ComboInput
                  value={form.brand}
                  options={brands.map((b) => ({ value: b }))}
                  placeholder={form.newBrand ? 'ชื่อยี่ห้อใหม่ เช่น Toyota' : 'พิมพ์ค้นหายี่ห้อ'}
                  customLabel="ยี่ห้อใหม่"
                  required
                  onChange={(value) => setForm({ ...form, brand: value })}
                />
              </div>
              <div className="form-group">
                <label>รุ่น</label>
                <input type="text" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>ช่วงปี (ปีที่เริ่มขายจนถึงปีที่เลิกขาย)</label>
                <div className="dev-year-row">
                  <input type="number" min="1950" max="2100" placeholder="ปีเริ่ม เช่น 2013" value={form.year_from} onChange={(e) => setForm({ ...form, year_from: e.target.value, year_raw: '' })} />
                  <span>ถึง</span>
                  <input type="number" min="1950" max="2100" placeholder="ปีสิ้นสุด เช่น 2022" value={form.to_present ? '' : form.year_to} disabled={form.to_present} onChange={(e) => setForm({ ...form, year_to: e.target.value })} />
                  <label className="dev-year-present">
                    <input type="checkbox" checked={form.to_present} onChange={(e) => setForm({ ...form, to_present: e.target.checked, year_to: '' })} /> ปัจจุบัน
                  </label>
                </div>
                {form.year_raw && <div className="dev-detail">ช่วงปีเดิม: {form.year_raw} (กรอกปีด้านบนเพื่อเปลี่ยนเป็นรูปแบบมาตรฐาน)</div>}
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
