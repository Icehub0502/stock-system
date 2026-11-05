import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import client from '../api/client';
import { formatMoney } from '../utils/format';
import { formatDateTh } from '../utils/dateGroups';
import { CASE_STATUS, CASE_TYPE_LABEL, OUTCOME_LABEL, REPORT_RESULT_LABEL } from '../utils/claimCases';

// "ประวัติรถ": find a car, then see what was done to it, how often it came back and what was claimed, the warranty each
// item carries and whether it still runs.
// Data comes from GET /vehicle-history (backend/src/routes/vehicleHistory.routes.js); the page only reads.
// The photo timeline of the same car stays on /vehicles/:id/history (linked from here).

const QUOTATION_STATUS = {
  pending: 'รอตัดสินใจ', scheduled: 'นัดแล้ว', no_date: 'ยังไม่นัด', parts_ready: 'อะไหล่พร้อม',
};

const todayIso = () => new Date().toISOString().slice(0, 10);

function daysLeft(expiresOn) {
  const ms = new Date(`${expiresOn}T00:00:00Z`).getTime() - new Date(`${todayIso()}T00:00:00Z`).getTime();
  return Math.round(ms / 86400000);
}

// "หมด 12 มี.ค. 2569 (เหลือ 40 วัน)" / "หมดประกันแล้ว 12 มี.ค. 2569"
function expiryText(warranty) {
  if (!warranty.expires_on) return 'นับตามระยะทาง';
  const left = daysLeft(warranty.expires_on);
  if (left < 0) return `หมดประกันแล้ว ${formatDateTh(warranty.expires_on)}`;
  return `หมด ${formatDateTh(warranty.expires_on)} (เหลือ ${left} วัน)`;
}

function WarrantyChip({ warranty }) {
  if (!warranty) return <span className="vh-chip vh-chip-none">ไม่มีประกัน</span>;
  return (
    <span className={`vh-chip ${warranty.active ? 'vh-chip-active' : 'vh-chip-expired'}`}>
      {warranty.label}{warranty.active ? '' : ' · หมดแล้ว'}
    </span>
  );
}

export default function VehicleServiceHistoryPage() {
  const { id } = useParams();
  return id ? <VehicleDetail vehicleId={id} /> : <VehicleSearch />;
}

function VehicleSearch() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      client.get('/vehicle-history/search', { params: { search } })
        .then((res) => { if (!cancelled) { setRows(res.data.data); setError(''); } })
        .catch((err) => { if (!cancelled) setError(err.response?.data?.error || 'ค้นหาไม่สำเร็จ'); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search]);

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>ประวัติรถ</h1>
          <p className="subtitle">ดูว่ารถแต่ละคันเคยทำอะไรไปบ้าง และรายการไหนยังอยู่ในประกัน</p>
        </div>
      </div>
      <input
        type="text"
        className="search-input vh-search"
        placeholder="ค้นหาด้วยทะเบียน ชื่อลูกค้า เบอร์โทร ยี่ห้อ หรือรุ่น"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />
      {error && <div className="error-message">{error}</div>}
      {loading && rows.length === 0 ? <div className="loading">กำลังโหลด...</div> : rows.length === 0 ? (
        <div className="empty-message">ไม่พบรถ ลองค้นด้วยทะเบียนหรือเบอร์โทรของลูกค้า</div>
      ) : (
        <div className="vh-list">
          {rows.map((r) => (
            <button key={r.vehicle_id} type="button" className="vh-list-item" onClick={() => navigate(`/vehicle-history/${r.vehicle_id}`)}>
              <span className="vh-plate">{r.license_plate || 'ไม่มีทะเบียน'}{r.province ? ` ${r.province}` : ''}</span>
              <span>{r.brand} {r.model}{r.color ? ` · ${r.color}` : ''}</span>
              <span className="vh-muted">{r.customer_name}{r.phone ? ` · ${r.phone}` : ''}</span>
              <span className="vh-muted">{r.last_receipt_date ? `ใบเสร็จล่าสุด ${formatDateTh(r.last_receipt_date)}` : 'ยังไม่มีใบเสร็จ'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function VehicleDetail({ vehicleId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    client.get(`/vehicle-history/${vehicleId}`)
      .then((res) => setData(res.data.data))
      .catch((err) => setError(err.response?.data?.error || 'โหลดประวัติไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, [vehicleId]);

  if (loading) return <div className="quotation-page"><div className="loading">กำลังโหลด...</div></div>;
  if (error || !data) {
    return (
      <div className="quotation-page">
        <Link to="/vehicle-history" className="btn btn-secondary">← กลับ</Link>
        <div className="error-message">{error || 'ไม่พบข้อมูล'}</div>
      </div>
    );
  }

  const {
    vehicle, active_warranties: warranties, changed_items: changed, visits, open_quotations: openQuotations, claims,
    visits_without_bill: visitsWithoutBill, summary,
  } = data;

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <Link to="/vehicle-history" className="vh-back">← ค้นหารถคันอื่น</Link>
          <h1>{vehicle.license_plate || 'ไม่มีทะเบียน'}{vehicle.province ? ` ${vehicle.province}` : ''}</h1>
          <p className="subtitle">
            {vehicle.brand} {vehicle.model}{vehicle.color ? ` · ${vehicle.color}` : ''} · {vehicle.customer_name}{vehicle.phone ? ` · ${vehicle.phone}` : ''}
          </p>
        </div>
        {(visits.some((v) => v.job_id) || openQuotations.length > 0) && (
          <Link to={`/vehicles/${vehicle.id}/history`} className="btn btn-secondary">ไทม์ไลน์งานพร้อมรูป</Link>
        )}
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">สรุปรถคันนี้</div>
        <div className="fu-stats">
          <div><strong>{summary.visit_count}</strong><span>บิลและคิวงาน</span></div>
          <div><strong>{summary.rework_count}</strong><span>มาแก้งาน</span></div>
          <div><strong>{summary.parts_claim_count}</strong><span>เคลมอะไหล่</span></div>
          <div><strong>{summary.open_case_count}</strong><span>เคสที่ยังไม่ปิด</span></div>
        </div>
        {summary.claimed_parts.length > 0 && (
          <div className="fu-claimed">
            <strong>อะไหล่ที่เคยเคลม:</strong>{' '}
            {summary.claimed_parts.map((p) => `${p.name} (${p.times} ครั้ง, ล่าสุด ${formatDateTh(p.last_date)})`).join(', ')}
          </div>
        )}
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">เคสแก้งาน / เคลม ({claims.length} ครั้ง)</div>
        {claims.length === 0 ? <p className="vh-muted">ยังไม่มีเคสของรถคันนี้</p> : claims.map((c) => (
          <div key={c.id} className="visit-card vh-card">
            <div className="visit-card-header">
              <span className="visit-card-date">{formatDateTh(c.claim_date)}</span>
              <span className={`status-badge ${CASE_STATUS[c.status]?.badge || 'status-badge-neutral'}`}>{CASE_STATUS[c.status]?.label || c.status}</span>
            </div>
            <div className="visit-card-meta">
              <span>{CASE_TYPE_LABEL[c.case_type] || 'เคส'}</span>
              <span>{c.claim_no}</span>
              {c.outcome && <span>{OUTCOME_LABEL[c.outcome]}</span>}
            </div>
            {c.symptom && <p className="visit-card-symptom">อาการ: {c.symptom}</p>}
            {c.finding && <p className="visit-card-symptom">ตรวจพบ: {c.finding}</p>}
            {c.resolution && <p className="visit-card-symptom">วิธีแก้: {c.resolution}</p>}
            {c.earlier_rounds && <p className="visit-card-symptom case-earlier">{c.earlier_rounds}</p>}
            {c.lesson && <p className="visit-card-symptom">แนวทางครั้งหน้า: {c.lesson}</p>}
            {c.items.length > 0 && (
              <ul className="visit-item-list">
                {c.items.map((it, i) => <li key={i}><span>{it.name}{it.qty > 1 ? ` x${it.qty}` : ''}</span></li>)}
              </ul>
            )}
            {c.follow_ups.length > 0 && (
              <ul className="fu-reports">
                {c.follow_ups.map((f, i) => (
                  <li key={i}>
                    {f.done_at ? (
                      <>
                        <strong>{REPORT_RESULT_LABEL[f.result] || f.result}</strong>
                        <span className="vh-muted"> · {formatDateTh(String(f.done_at).slice(0, 10))}{f.done_by ? ` · ${f.done_by}` : ''}</span>
                        {f.note && <div>{f.note}</div>}
                      </>
                    ) : (
                      <span className="vh-muted">นัดโทรติดตาม {formatDateTh(f.scheduled_date)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">การรับประกันที่ยังอยู่</div>
        {warranties.length === 0 ? (
          <p className="vh-muted">ตอนนี้ไม่มีรายการที่อยู่ในประกัน</p>
        ) : warranties.map((g) => (
          <div key={g.label} className="vh-warranty-group">
            <div className="vh-warranty-headline">รถคันนี้มีประกัน {g.label}</div>
            <ul className="vh-warranty-items">
              {g.items.map((it, i) => (
                <li key={`${it.name}-${i}`}>
                  <strong>{it.name}</strong>
                  <span className="vh-muted">
                    <span className="vh-nowrap">ซื้อ {formatDateTh(it.sold_on)}</span>{' · '}
                    <span className="vh-nowrap">{expiryText(it)}</span>
                    {it.km_limit ? <>{' · '}<span className="vh-nowrap">หรือเลขไมล์ถึง {Number(it.km_limit).toLocaleString('th-TH')} กม.</span></> : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {warranties.some((g) => g.km > 0) && <p className="vh-muted">ระยะทางคิดจากเลขไมล์ในวันที่ทำ ถ้าเลขไมล์ในใบเสร็จไม่ได้กรอก จะนับเฉพาะระยะเวลา</p>}
      </div>

      <div className="dash-panel">
        <div className="dash-panel-title">รายการที่เปลี่ยนไปแล้ว</div>
        {changed.length === 0 ? <p className="vh-muted">ยังไม่มีรายการ</p> : (
          <div className="quotation-table-wrap">
            <table className="quotation-table">
              <thead><tr><th>รายการ</th><th>หมวด</th><th>ครั้ง</th><th>ล่าสุด</th><th>ประกัน</th></tr></thead>
              <tbody>
                {changed.map((c) => (
                  <tr key={c.name}>
                    <td data-label="รายการ"><strong>{c.name}</strong></td>
                    {c.category && <td data-label="หมวด">{c.category}</td>}
                    <td data-label="ครั้ง">{c.times}</td>
                    <td data-label="ล่าสุด">{formatDateTh(c.last_date)}</td>
                    <td data-label="ประกัน"><WarrantyChip warranty={c.warranty} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openQuotations.length > 0 && (
        <div className="dash-panel">
          <div className="dash-panel-title">ใบเสนอราคาที่ยังไม่ปิด</div>
          {openQuotations.map((q) => (
            <div key={q.id} className="visit-card vh-card">
              <div className="visit-card-header">
                <span className="visit-card-date">{formatDateTh(q.date)}</span>
                <span className="status-badge status-badge-neutral">{QUOTATION_STATUS[q.status] || q.status}</span>
              </div>
              <div className="visit-card-meta">
                <span>ใบเสนอราคา {q.quotation_no}</span>
                {q.job_no && <span>เลขงาน {q.job_no}</span>}
              </div>
              {q.symptom && <p className="visit-card-symptom">อาการ: {q.symptom}</p>}
              <ul className="visit-item-list">
                {q.items.map((it, i) => (
                  <li key={i}><span>{it.name}{it.qty > 1 ? ` x${it.qty}` : ''}</span><span className="visit-item-price">฿{formatMoney(it.price * it.qty)}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div className="dash-panel">
        <div className="dash-panel-title">ประวัติการทำรถ ({visits.length} ครั้ง)</div>
        {visits.length === 0 ? <p className="vh-muted">ยังไม่มีใบเสร็จของรถคันนี้</p> : visits.map((v) => (
          <div key={v.receipt_id} className="visit-card vh-card">
            <div className="visit-card-header">
              <span className="visit-card-date">{formatDateTh(v.date)}</span>
              <span className="vh-total">฿{formatMoney(v.total_amount)}</span>
            </div>
            <div className="visit-card-meta">
              <span>ใบเสร็จ {v.receipt_no}</span>
              {v.quotation_no && <span>ใบเสนอราคา {v.quotation_no}</span>}
              {v.job_no && <span>เลขงาน {v.job_no}</span>}
              {v.technician_name && <span>ช่าง {v.technician_name}</span>}
            </div>
            {v.symptom && <p className="visit-card-symptom">อาการ: {v.symptom}</p>}
            {v.mileage > 0 && <p className="visit-card-mileage">เลขไมล์: {Number(v.mileage).toLocaleString('th-TH')}</p>}
            <ul className="visit-item-list">
              {v.items.map((it, i) => (
                <li key={i}>
                  <span>{it.name}{it.qty > 1 ? ` x${it.qty}` : ''} {it.warranty && <WarrantyChip warranty={it.warranty} />}</span>
                  <span className="visit-item-price">฿{formatMoney(it.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {visitsWithoutBill.length > 0 && (
        <div className="dash-panel">
          <div className="dash-panel-title">เข้าร้านโดยไม่มีใบเสร็จ ({visitsWithoutBill.length} ครั้ง)</div>
          {visitsWithoutBill.map((v) => (
            <div key={v.job_id} className="visit-card vh-card">
              <div className="visit-card-header">
                <span className="visit-card-date">{formatDateTh(v.date)}</span>
              </div>
              <div className="visit-card-meta"><span>เลขงาน {v.job_no}</span></div>
              {v.symptom && <p className="visit-card-symptom">อาการ: {v.symptom}</p>}
              {v.mileage > 0 && <p className="visit-card-mileage">เลขไมล์: {Number(v.mileage).toLocaleString('th-TH')}</p>}
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
