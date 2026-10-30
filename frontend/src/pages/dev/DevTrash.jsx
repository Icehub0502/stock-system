import React, { useCallback, useEffect, useState } from 'react';
import client from '../../api/client';
import { formatBytes, formatDateTime } from './DevOverview';

const ENTITY_FILTERS = [
  ['', 'ทุกประเภท'], ['customers', 'ลูกค้า'], ['vehicles', 'รถ'], ['jobs', 'งาน/คิว'], ['quotations', 'ใบเสนอราคา'],
  ['receipts', 'ใบเสร็จ'], ['claims', 'เคลม'], ['warranties', 'การรับประกัน'], ['technicians', 'ช่าง'],
];

// Fields worth showing in the detail view, in this order; the rest of the row is still there when restoring
const DETAIL_LABEL = {
  customer_name: 'ชื่อลูกค้า', customer_code: 'รหัสลูกค้า', phone: 'โทร', brand: 'ยี่ห้อ', model: 'รุ่น', license_plate: 'ทะเบียน',
  job_no: 'เลขงาน', queue_no: 'คิว', job_date: 'วันที่งาน', status: 'สถานะ', quotation_no: 'เลขใบเสนอราคา', receipt_no: 'เลขใบเสร็จ',
  total_amount: 'ยอดรวม', claim_no: 'เลขเคลม', code: 'รหัส', name: 'ชื่อ', warranty_name: 'ชื่อการรับประกัน',
  receipt_date: 'วันที่ใบเสร็จ', quotation_date: 'วันที่ใบเสนอราคา', symptom: 'อาการ', created_at: 'สร้างเมื่อ',
};

export default function DevTrash() {
  const [rows, setRows] = useState([]);
  const [shops, setShops] = useState([]);
  const [filters, setFilters] = useState({ shop_id: '', entity: '', q: '', state: 'deleted' });
  const [stats, setStats] = useState(null);
  const [settings, setSettings] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    client.get('/dev/trash', { params })
      .then((res) => setRows(res.data.data))
      .catch((err) => setError(err.response?.data?.error || 'โหลดไม่สำเร็จ'));
  }, [filters]);

  const loadSide = useCallback(() => {
    client.get('/dev/trash/stats').then((res) => setStats(res.data.data)).catch(() => {});
    client.get('/dev/trash/settings').then((res) => setSettings(res.data.data)).catch(() => {});
  }, []);

  useEffect(() => { client.get('/dev/shops').then((res) => setShops(res.data.data)).catch(() => {}); loadSide(); }, [loadSide]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const open = async (row) => {
    try {
      const res = await client.get(`/dev/trash/${row.id}`);
      setDetail(res.data.data);
    } catch (err) {
      alert(err.response?.data?.error || 'เปิดรายการไม่สำเร็จ');
    }
  };

  const restore = async (row) => {
    if (!window.confirm(`กู้คืน "${row.entity_name}: ${row.label}" กลับเข้าร้าน ${row.shop_name}?`)) return;
    setBusyId(row.id);
    try {
      await client.post(`/dev/trash/${row.id}/restore`);
      setDetail(null);
      load();
      loadSide();
      alert('กู้คืนเรียบร้อย');
    } catch (err) {
      alert(err.response?.data?.error || 'กู้คืนไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  };

  const removeForever = async (row) => {
    if (!window.confirm(`ลบ "${row.label}" ถาวร? กู้คืนไม่ได้อีก (ไฟล์รูปที่เกี่ยวข้องจะถูกลบด้วย)`)) return;
    setBusyId(row.id);
    try {
      await client.delete(`/dev/trash/${row.id}`);
      setDetail(null);
      load();
      loadSide();
    } catch (err) {
      alert(err.response?.data?.error || 'ลบไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    try {
      const res = await client.put('/dev/trash/settings', {
        auto_cleanup: settings.auto_cleanup,
        keep_days: Number(settings.keep_days),
        photo_keep_days: Number(settings.photo_keep_days),
      });
      setSettings(res.data.data);
      alert('บันทึกแล้ว');
    } catch (err) {
      alert(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
    }
  };

  const purge = async (photosOnly) => {
    const days = Number(window.prompt(photosOnly ? 'ลบไฟล์รูปของรายการที่ถูกลบมานานเกินกี่วัน?' : 'ลบรายการในถังขยะที่เก่ากว่ากี่วัน? (ถาวร)', '365'));
    if (!Number.isInteger(days) || days < 0) return;
    if (!window.confirm(photosOnly ? `ลบไฟล์รูปที่เก่ากว่า ${days} วัน?` : `ลบรายการที่เก่ากว่า ${days} วัน ถาวร?`)) return;
    try {
      const res = await client.post('/dev/trash/purge', { older_than_days: days, photos_only: photosOnly });
      alert(photosOnly ? `ลบไฟล์รูปของ ${res.data.photos} รายการ` : `ลบ ${res.data.records} รายการ`);
      load();
      loadSide();
    } catch (err) {
      alert(err.response?.data?.error || 'ลบไม่สำเร็จ');
    }
  };

  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>รายการที่ถูกลบ</h1>
          <p className="subtitle">ทุกอย่างที่พนักงานลบจะถูกเก็บสำเนาไว้ที่นี่ กู้คืนได้ (พร้อมรายการลูกและการเชื่อมโยง)</p>
        </div>
      </div>
      {error && <div className="error-message">{error}</div>}

      <div className="owner-range">
        <select value={filters.shop_id} onChange={(e) => setFilter('shop_id', e.target.value)}>
          <option value="">ทุกร้าน</option>
          {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={filters.entity} onChange={(e) => setFilter('entity', e.target.value)}>
          {ENTITY_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={filters.state} onChange={(e) => setFilter('state', e.target.value)}>
          <option value="deleted">ยังไม่ได้กู้</option>
          <option value="restored">กู้คืนแล้ว</option>
          <option value="all">ทั้งหมด</option>
        </select>
        <input placeholder="ค้นหาชื่อ/เลขที่/ทะเบียน" value={filters.q} onChange={(e) => setFilter('q', e.target.value)} />
      </div>

      <div className="quotation-table-wrap">
        <table className="quotation-table">
          <thead><tr><th>ลบเมื่อ</th><th>ร้าน</th><th>ประเภท</th><th>รายการ</th><th>ผู้ลบ</th><th>จัดการ</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label="ลบเมื่อ">{formatDateTime(r.deleted_at)}</td>
                <td data-label="ร้าน">{r.shop_name}</td>
                <td data-label="ประเภท">{r.entity_name}</td>
                <td data-label="รายการ">
                  {r.label}
                  {r.has_photos ? (r.photos_purged_at ? ' (รูปถูกลบแล้ว)' : ' 📷') : ''}
                  {r.restored_at ? ` — กู้คืนเมื่อ ${formatDateTime(r.restored_at)}` : ''}
                </td>
                <td data-label="ผู้ลบ">{r.deleted_by_name || '-'}</td>
                <td className="actions" data-label="จัดการ">
                  <button type="button" onClick={() => open(r)}>ดู</button>
                  {!r.restored_at && <button type="button" className="btn-primary" disabled={busyId === r.id} onClick={() => restore(r)}>กู้คืน</button>}
                  <button type="button" className="btn-danger" disabled={busyId === r.id} onClick={() => removeForever(r)}>ลบถาวร</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6}>ไม่มีรายการ</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">พื้นที่และการเก็บ</div>
        {stats && (
          <p className="subtitle">
            {stats.by_entity.length === 0 ? 'ถังขยะว่าง' : stats.by_entity.map((e) => `${e.entity_name} ${e.records} รายการ (${formatBytes(e.bytes)})`).join(' · ')}
            {stats.records_with_photo_files > 0 ? ` · ยังมีไฟล์รูปค้างของ ${stats.records_with_photo_files} รายการ` : ''}
          </p>
        )}
        {settings && (
          <form onSubmit={saveSettings} className="dev-settings-form">
            <label>
              <input type="checkbox" checked={settings.auto_cleanup} onChange={(e) => setSettings({ ...settings, auto_cleanup: e.target.checked })} />
              {' '}ลบอัตโนมัติ (ปิดไว้ = เก็บทั้งหมด ไม่ลบเอง)
            </label>
            <label>เก็บรายการไว้ (วัน, 0 = ไม่จำกัด)
              <input type="number" min="0" max="3650" value={settings.keep_days} onChange={(e) => setSettings({ ...settings, keep_days: e.target.value })} />
            </label>
            <label>เก็บไฟล์รูปไว้ (วัน, 0 = ไม่จำกัด)
              <input type="number" min="0" max="3650" value={settings.photo_keep_days} onChange={(e) => setSettings({ ...settings, photo_keep_days: e.target.value })} />
            </label>
            <button type="submit" className="btn btn-primary">บันทึกการตั้งค่า</button>
          </form>
        )}
        <div className="dev-purge-row">
          <button type="button" className="btn btn-secondary" onClick={() => purge(true)}>ลบเฉพาะไฟล์รูปที่เก่ากว่า…</button>
          <button type="button" className="btn btn-danger" onClick={() => purge(false)}>ลบรายการที่เก่ากว่า… (ถาวร)</button>
        </div>
      </div>

      {detail && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <div className="modal-card medium" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{detail.entity_name}: {detail.label}</h2>
              <button type="button" className="btn-close" onClick={() => setDetail(null)}>✕</button>
            </div>
            <p className="subtitle">ร้าน {detail.shop_name} · ลบเมื่อ {formatDateTime(detail.deleted_at)} โดย {detail.deleted_by_name || '-'}</p>
            <table className="quotation-table">
              <tbody>
                {Object.entries(detail.record || {}).filter(([k, v]) => DETAIL_LABEL[k] && v !== null && v !== '').map(([k, v]) => (
                  <tr key={k}><td><strong>{DETAIL_LABEL[k]}</strong></td><td>{String(v)}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="subtitle">
              ประกอบด้วย: {detail.parts.map((p) => `${p.table} ${p.rows} แถว`).join(' · ')}
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setDetail(null)}>ปิด</button>
              {!detail.restored_at && (
                <button type="button" className="btn btn-primary" disabled={busyId === detail.id} onClick={() => restore({ ...detail, shop_name: detail.shop_name })}>กู้คืน</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
