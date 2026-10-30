import React, { useCallback, useEffect, useState } from 'react';
import client from '../../api/client';

// กิจกรรมผู้ใช้ (platform administrator only): every change made by every signed-in user, newest first, with what was
// sent and how the record looked before. Data from GET /dev/activity (backend/src/routes/devActivity.routes.js).

const KIND_LABEL = { create: 'เพิ่ม', update: 'แก้ไข', delete: 'ลบ', action: 'ทำรายการ', login: 'เข้าสู่ระบบ' };
const ROLE_LABEL = { technician: 'ช่าง', office: 'ออฟฟิศ', manager: 'ผู้จัดการ', owner: 'เจ้าของ', dev: 'แอดมิน' };
const ENTITIES = [
  ['customers', 'ลูกค้า'], ['vehicles', 'รถ'], ['quotations', 'ใบเสนอราคา'], ['receipts', 'ใบเสร็จ'], ['jobs', 'งาน/คิว'],
  ['claims', 'เคลม'], ['warranties', 'การรับประกัน'], ['service-items', 'รายการสินค้า/บริการ'], ['stock-items', 'สต๊อก'],
  ['stock-receive', 'รับเข้าสต๊อก'], ['stock-deductions', 'ตัดสต๊อก'], ['users', 'บัญชีผู้ใช้'], ['technicians', 'ช่าง'],
  ['doc-settings', 'หัวกระดาษ'], ['model-prices', 'ราคามาตรฐาน'], ['settings', 'ตั้งค่า'], ['auth', 'บัญชี/เข้าสู่ระบบ'],
];
// records the administrator can bring back from the trash
const RESTORABLE = new Set(['customers', 'vehicles', 'jobs', 'quotations', 'receipts', 'claims', 'warranties', 'technicians']);

const EMPTY_FILTERS = { user: '', kind: '', entity: '', entity_id: '', failed: false, q: '', from: '', to: '' };

function paramsOf(filters, beforeId) {
  const p = { limit: 100 };
  Object.entries(filters).forEach(([k, v]) => { if (v) p[k] = k === 'failed' ? '1' : v; });
  if (beforeId) p.before_id = beforeId;
  return p;
}

function Json({ title, value }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="da-json">
      <div className="da-json-title">{title}</div>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

function Detail({ id }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    client.get(`/dev/activity/${id}`).then((res) => setD(res.data.data)).catch((err) => setError(err.response?.data?.error || 'โหลดไม่สำเร็จ'));
  }, [id]);
  if (error) return <div className="error-message">{error}</div>;
  if (!d) return <div className="loading">กำลังโหลด...</div>;
  return (
    <div className="da-detail">
      <div className="da-meta">
        <span>{d.method} {d.path}</span>
        <span>สถานะ {d.status}</span>
        <span>ใช้เวลา {d.duration_ms ?? '-'} ms</span>
        <span>IP {d.ip || '-'}</span>
        <span title={d.user_agent || ''}>{(d.user_agent || '-').slice(0, 60)}</span>
      </div>
      {d.error_text && <div className="error-message">ข้อความผิดพลาด: {d.error_text}</div>}
      <Json title="ข้อมูลของรายการก่อนถูกแก้/ลบ" value={d.before_data} />
      <Json title="ข้อมูลที่ส่งมา" value={d.request_body} />
      {d.kind === 'delete' && RESTORABLE.has(d.entity) && <p className="da-hint">กู้คืนได้ที่เมนู “รายการที่ถูกลบ”</p>}
    </div>
  );
}

export default function DevActivity() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [summary, setSummary] = useState(null);

  const load = useCallback((append = false, beforeId = null) => {
    setLoading(true);
    client.get('/dev/activity', { params: paramsOf(filters, beforeId) })
      .then((res) => {
        setRows((prev) => (append ? [...prev, ...res.data.data] : res.data.data));
        setHasMore(res.data.has_more);
        setError('');
      })
      .catch((err) => setError(err.response?.data?.error || 'โหลดไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => {
    const timer = setTimeout(() => load(false), 300);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    client.get('/dev/activity/summary').then((res) => setSummary(res.data.data)).catch(() => {});
  }, []);

  const set = (patch) => { setOpen(null); setFilters((f) => ({ ...f, ...patch })); };

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>กิจกรรมผู้ใช้</h1>
          <p className="subtitle">ทุกการเพิ่ม/แก้ไข/ลบของทุกบัญชี พร้อมข้อมูลก่อนแก้ (ไม่รวมการเปิดดู) เก็บ 1 ปี</p>
        </div>
      </div>

      {summary && (
        <div className="dash-panel">
          <div className="dash-panel-title">วันนี้ · เข้าสู่ระบบสำเร็จ {summary.logins.ok} · ไม่สำเร็จ {summary.logins.failed}</div>
          {summary.users.length === 0 ? <div className="empty-message">วันนี้ยังไม่มีกิจกรรม</div> : (
            <div className="da-users">
              {summary.users.map((u) => (
                <button key={`${u.user_id}-${u.shop_id}`} type="button" className="da-user" onClick={() => set({ user: u.username })}>
                  <strong>{u.username}</strong>
                  <span className="da-muted">{ROLE_LABEL[u.role] || u.role} · {u.shop_name || '-'}</span>
                  <span>เพิ่ม {u.creates} · แก้ {u.updates} · <span className={u.deletes ? 'da-red' : ''}>ลบ {u.deletes}</span>{u.failures ? <span className="da-red"> · ผิดพลาด {u.failures}</span> : null}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="da-filters">
        <input type="text" placeholder="ผู้ใช้" value={filters.user} onChange={(e) => set({ user: e.target.value })} />
        <select value={filters.kind} onChange={(e) => set({ kind: e.target.value })}>
          <option value="">ทุกประเภท</option>
          {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filters.entity} onChange={(e) => set({ entity: e.target.value, entity_id: '' })}>
          <option value="">ทุกหมวด</option>
          {ENTITIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="text" placeholder="ค้นหาข้อความ/ชื่อ/เลขที่" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
        <input type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} aria-label="ตั้งแต่วันที่" />
        <input type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} aria-label="ถึงวันที่" />
        <label className="da-check"><input type="checkbox" checked={filters.failed} onChange={(e) => set({ failed: e.target.checked })} /> เฉพาะที่ไม่สำเร็จ</label>
        <button type="button" className="btn btn-secondary" onClick={() => set(EMPTY_FILTERS)}>ล้างตัวกรอง</button>
      </div>
      {filters.entity_id && <p className="da-hint">กำลังดูประวัติของ {filters.entity} #{filters.entity_id}</p>}
      {error && <div className="error-message">{error}</div>}

      <div className="da-list">
        {rows.map((r) => (
          <div key={r.id} className={`da-row ${r.status >= 400 ? 'da-row-fail' : ''}`}>
            <button type="button" className="da-row-head" onClick={() => setOpen(open === r.id ? null : r.id)}>
              <span className="da-time">{r.created_at}</span>
              <span className={`da-kind da-kind-${r.kind}`}>{KIND_LABEL[r.kind] || r.kind}</span>
              <span className="da-summary">{r.summary}</span>
              <span className="da-who">{r.username || '-'}{r.role ? ` (${ROLE_LABEL[r.role] || r.role})` : ''} · {r.shop_name || '-'}</span>
            </button>
            {open === r.id && (
              <>
                <div className="da-actions">
                  {r.username && <button type="button" className="btn btn-secondary" onClick={() => set({ user: r.username })}>ดูทั้งหมดของ {r.username}</button>}
                  {r.entity_id && <button type="button" className="btn btn-secondary" onClick={() => set({ entity: r.entity, entity_id: r.entity_id, user: '', kind: '' })}>ดูประวัติของรายการนี้</button>}
                </div>
                <Detail id={r.id} />
              </>
            )}
          </div>
        ))}
        {!loading && rows.length === 0 && <div className="empty-message">ไม่พบกิจกรรม</div>}
      </div>
      {loading && <div className="loading">กำลังโหลด...</div>}
      {hasMore && !loading && <button type="button" className="btn btn-secondary" onClick={() => load(true, rows[rows.length - 1].id)}>โหลดเพิ่ม</button>}
    </div>
  );
}
