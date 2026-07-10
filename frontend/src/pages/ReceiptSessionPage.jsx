import React, { useEffect, useState, useMemo } from 'react';
import client from '../api/client';

function toLocalDateStr(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── Icons ──
const IconDoc = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="20" height="20">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <path d="M14 2v6h6M8 13h8M8 17h5"/>
  </svg>
);
const IconCalendar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
    <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
  </svg>
);
const IconUser = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14">
    <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
  </svg>
);
const IconBox = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14">
    <path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M12 3v18M3 8l9 5 9-5"/>
  </svg>
);
const IconClose = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
    <path d="M18 6L6 18M6 6l12 12"/>
  </svg>
);
const IconBarChart = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
    <rect x="3" y="12" width="4" height="9"/><rect x="10" y="7" width="4" height="14"/>
    <rect x="17" y="3" width="4" height="18"/>
  </svg>
);
const IconReceipt = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14">
    <path d="M4 2h16v20l-2.5-1.5L15 22l-2.5-1.5L10 22l-2.5-1.5L5 22V2H4z"/>
    <path d="M8 8h8M8 12h8M8 16h5"/>
  </svg>
);

export default function ReceiptSessionPage() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [filterDate, setFilterDate] = useState(todayStr());
  const [filterMonth, setFilterMonth] = useState('');

  useEffect(() => {
    client.get('/transactions/receipt-sessions')
      .then((res) => setSessions(res.data))
      .finally(() => setLoading(false));
  }, []);

  const handleViewDetail = async (id) => {
    setDetailLoading(true);
    try {
      const res = await client.get(`/transactions/receipt-sessions/${id}`);
      setSelectedSession(res.data);
    } catch {
      alert('โหลดรายละเอียดไม่สำเร็จ');
    } finally {
      setDetailLoading(false);
    }
  };

  const monthlySummary = useMemo(() => {
    const map = {};
    sessions.forEach((s) => {
      const month = toLocalDateStr(s.created_at)?.slice(0, 7) || 'unknown';
      if (!map[month]) map[month] = { month, billCount: 0, itemCount: 0, totalQty: 0 };
      map[month].billCount += 1;
      map[month].itemCount += Number(s.item_count ?? 0);
      map[month].totalQty  += Number(s.total_qty  ?? 0);
    });
    return Object.values(map).sort((a, b) => b.month.localeCompare(a.month));
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    if (filterDate)  return sessions.filter((s) => toLocalDateStr(s.created_at) === filterDate);
    if (filterMonth) return sessions.filter((s) => toLocalDateStr(s.created_at)?.startsWith(filterMonth));
    return sessions;
  }, [sessions, filterDate, filterMonth]);

  const grouped = useMemo(() => {
    return filteredSessions.reduce((acc, s) => {
      const d = toLocalDateStr(s.created_at) || 'ไม่ทราบ';
      if (!acc[d]) acc[d] = [];
      acc[d].push(s);
      return acc;
    }, {});
  }, [filteredSessions]);

  const fmtDate = (ds) => {
    if (!ds) return '';
    const [y, m, d] = ds.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  };
  const fmtTime = (ds) => ds ? new Date(ds).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
  const fmtMonth = (ms) => {
    if (!ms || ms === 'unknown') return ms;
    const [y, m] = ms.split('-');
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('th-TH', { year: 'numeric', month: 'long' });
  };

  const isToday = filterDate === todayStr();
  const showClear = !isToday || !!filterMonth;

  return (
    <div className="quotation-page intake-page">
      <div className="quotation-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#111111' }}>
            <IconDoc />
            <h1 style={{ margin: 0 }}>บิลรับเข้า</h1>
          </div>
          <p className="subtitle">{fmtDate(filterDate || todayStr())}</p>
        </div>

        <div className="quotation-actions">
          <button
            className={`intake-filter-btn ${isToday && !filterMonth ? 'active' : ''}`}
            onClick={() => { setFilterDate(todayStr()); setFilterMonth(''); }}
          >
            วันนี้
          </button>
          <div className="intake-date-input-wrap">
            <span className="intake-icon"><IconCalendar /></span>
            <input
              type="date"
              value={filterDate}
              onChange={(e) => { setFilterDate(e.target.value); setFilterMonth(''); }}
            />
          </div>
          {showClear && (
            <button
              className="intake-clear-btn"
              onClick={() => { setFilterDate(todayStr()); setFilterMonth(''); }}
              aria-label="ล้างตัวกรอง"
            >
              <IconClose />
            </button>
          )}
        </div>
      </div>

      {/* ── Monthly Summary ── */}
      {!loading && monthlySummary.length > 0 && (
        <>
          <div className="intake-section-label">
            <IconBarChart />
            <span>สรุปรายเดือน</span>
          </div>
          <div className="intake-month-grid">
            {monthlySummary.map((m) => {
              const active = filterMonth === m.month;
              return (
                <button
                  key={m.month}
                  className={`intake-month-card ${active ? 'active' : ''}`}
                  onClick={() => { setFilterMonth(active ? '' : m.month); setFilterDate(''); }}
                >
                  <div className="intake-month-label">{fmtMonth(m.month)}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.25rem' }}>
                    <span className="intake-month-count">{m.billCount}</span>
                    <span className="intake-month-unit">บิล</span>
                  </div>
                  <div className="intake-month-sub">
                    {m.itemCount.toLocaleString()} รายการ · {m.totalQty.toLocaleString()} ชิ้น
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {loading && <div className="loading">กำลังโหลด...</div>}

      {!loading && filteredSessions.length === 0 && (
        <div className="empty-message">
          <div style={{ color: '#d1d5db', marginBottom: '0.75rem' }}><IconDoc /></div>
          {filterDate ? `ไม่พบบิลในวันที่ ${fmtDate(filterDate)}`
            : filterMonth ? `ไม่พบบิลในเดือน ${fmtMonth(filterMonth)}`
            : 'ยังไม่มีบิล'}
        </div>
      )}

      {/* ── Bill list grouped by date ── */}
      {Object.entries(grouped)
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([date, list]) => (
          <div key={date} style={{ marginBottom: '1.5rem' }}>
            <div className="intake-date-divider">
              <div className="line" />
              <div className="label"><IconCalendar />{fmtDate(date)}</div>
              <div className="line" />
            </div>

            {list.map((s) => {
              const itemCount = Number(s.item_count ?? 0);
              const totalQty  = Number(s.total_qty  ?? 0);
              return (
                <div key={s.id} className="intake-session-card">
                  <div style={{ minWidth: 0 }}>
                    <div className="intake-invoice-row">
                      <span className="intake-invoice-no"><IconReceipt />{s.invoice_no}</span>
                      <span className="intake-time-chip">{fmtTime(s.created_at)}</span>
                    </div>
                    <div className="intake-meta-row">
                      <span className="intake-meta-item"><IconUser />{s.full_name || '—'}</span>
                      <span style={{ color: '#e5e7eb' }}>|</span>
                      <span className="intake-meta-item">
                        <IconBox />
                        <strong style={{ color: '#111111' }}>{itemCount.toLocaleString()}</strong>
                        <span>รายการ</span>
                        <span className="intake-qty-badge">{totalQty.toLocaleString()}</span>
                        <span>ชิ้น</span>
                      </span>
                    </div>
                  </div>

                  <button
                    className="btn-primary"
                    onClick={() => handleViewDetail(s.id)}
                    disabled={detailLoading}
                  >
                    รายละเอียด
                  </button>
                </div>
              );
            })}
          </div>
        ))}

      {/* ── Modal ── */}
      {selectedSession && (
        <div className="modal-backdrop" onClick={() => setSelectedSession(null)}>
          <div className="modal-card medium" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>รายละเอียดบิล</h2>
              <button className="btn-close" onClick={() => setSelectedSession(null)}>
                <IconClose />
              </button>
            </div>

            <div style={{ marginBottom: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
              <span className="intake-invoice-no" style={{ background: '#f3f4f6', padding: '0.3rem 0.75rem', borderRadius: '999px' }}>
                <IconReceipt />{selectedSession.session.invoice_no}
              </span>
              <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>
                {new Date(selectedSession.session.created_at).toLocaleString('th-TH')}
              </span>
            </div>
            <div className="intake-meta-item" style={{ marginBottom: '0.75rem', fontSize: '0.8rem', color: '#6b7280' }}>
              <IconUser />{selectedSession.session.full_name}
            </div>

            {selectedSession.items.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#9ca3af', padding: '2rem 0' }}>
                ยังไม่มีรายการในบิลนี้
              </p>
            ) : (
              <div className="quotation-table-wrap">
                <table className="quotation-table">
                  <thead>
                    <tr>
                      <th className="col-no">#</th>
                      <th>รหัสรุ่น</th>
                      <th>รายการ</th>
                      <th className="col-amount">จำนวน</th>
                      <th>เวลา</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSession.items.map((item, i) => (
                      <tr key={item.id}>
                        <td className="col-no" data-label="#">{i + 1}</td>
                        <td data-label="รหัสรุ่น" style={{ fontFamily: 'Consolas, monospace', fontWeight: 700 }}>{item.model_code}</td>
                        <td data-label="รายการ">{item.rack_name}</td>
                        <td className="col-amount" data-label="จำนวน">
                          <span className="intake-detail-total" style={{ fontWeight: 700 }}>
                            +{Number(item.qty ?? 0).toLocaleString()}
                          </span>
                        </td>
                        <td data-label="เวลา">{new Date(item.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} style={{ fontWeight: 700 }}>รวมทั้งหมด</td>
                      <td className="col-amount">
                        <span className="intake-detail-total" style={{ fontWeight: 800, fontSize: '1rem' }}>
                          +{selectedSession.items.reduce((s, it) => s + Number(it.qty ?? 0), 0).toLocaleString()}
                        </span>
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: '1rem' }}>
              <button className="btn-secondary" onClick={() => setSelectedSession(null)}>ปิด</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
