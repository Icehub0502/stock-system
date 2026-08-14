import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';
import { formatDbTime, formatDbDateTime, todayStr } from '../utils/format';

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
const IconClose = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
    <path d="M18 6L6 18M6 6l12 12"/>
  </svg>
);
const IconChevron = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="18" height="18">
    <path d="M9 18l6-6-6-6"/>
  </svg>
);
const IconTrash = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="15" height="15">
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
  </svg>
);
const IconQR = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM19 19h2M14 21h1"/>
  </svg>
);

// "2026-08-13" → "พฤหัสบดี 13 สิงหาคม 2569" — รับเฉพาะสตริง DATE ล้วน ไม่ใช่ DATETIME
function fmtDateKey(key) {
  if (!key) return '';
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString('th-TH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

// bill_date เป็นคอลัมน์ DATE ("YYYY-MM-DD") อยู่แล้ว — แถวเก่าก่อนมีคอลัมน์นี้ถูก
// backfill จาก created_at ไว้ตอน migrate (ดู db/init.js) จึงไม่ควรเป็น null แล้ว
// แต่กันไว้เผื่อ: ตกกลับไปใช้วันจาก created_at
function billDateKey(session) {
  if (session.bill_date) return String(session.bill_date).slice(0, 10);
  return String(session.created_at || '').slice(0, 10);
}

export default function ReceiptSessionPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  // 'today' | 'all' | 'date' — ค่าเริ่มต้นเปิดที่วันนี้ เหมือนพฤติกรรมเดิม
  const [range, setRange] = useState('today');
  const [pickedDate, setPickedDate] = useState(todayStr());

  const loadSessions = useCallback(async () => {
    try {
      setLoading(true);
      const res = await client.get('/transactions/receipt-sessions');
      setSessions(res.data || []);
    } catch (err) {
      setError(err?.response?.data?.error || 'โหลดบิลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const openDetail = async (id) => {
    setDetailLoading(true);
    try {
      const res = await client.get(`/transactions/receipt-sessions/${id}`);
      setSelected(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || 'โหลดรายละเอียดบิลไม่สำเร็จ');
    } finally {
      setDetailLoading(false);
    }
  };

  // ลบรายการในบิล — backend คืนสต็อกให้เองในทรานแซกชันเดียว (DELETE /transactions/:id)
  const handleDeleteItem = async (item) => {
    if (!window.confirm(`ลบ "${item.rack_name}" ออกจากบิลนี้? ระบบจะคืนสต็อกให้อัตโนมัติ`)) return;
    setDeletingId(item.id);
    try {
      await client.delete(`/transactions/${item.id}`);
      setSelected((prev) => prev && ({ ...prev, items: prev.items.filter((it) => it.id !== item.id) }));
      loadSessions(); // ยอดรวมในรายการด้านหลังต้องอัปเดตตามด้วย
    } catch (err) {
      alert(err?.response?.data?.error || 'ลบรายการไม่สำเร็จ');
    } finally {
      setDeletingId(null);
    }
  };

  // สแกนของเพิ่มเข้าบิลเดิม — ส่ง session ไปให้หน้าสแกนเปิดต่อจากบิลนี้เลย
  // ใช้ตอนต้นทางส่งของมาไม่ครบ/บิลมาทีหลัง แล้วต้องแอดเข้าบิลเดิมภายหลัง
  const handleScanIntoBill = () => {
    navigate('/scan', { state: { resumeSession: selected.session } });
  };

  const filtered = useMemo(() => {
    if (range === 'all') return sessions;
    const target = range === 'today' ? todayStr() : pickedDate;
    return sessions.filter((s) => billDateKey(s) === target);
  }, [sessions, range, pickedDate]);

  const totals = useMemo(() => filtered.reduce((acc, s) => ({
    bills: acc.bills + 1,
    items: acc.items + Number(s.item_count ?? 0),
    qty: acc.qty + Number(s.total_qty ?? 0),
  }), { bills: 0, items: 0, qty: 0 }), [filtered]);

  // จัดกลุ่มตามวันของบิล (ใหม่สุดอยู่บน)
  const groups = useMemo(() => {
    const map = new Map();
    for (const s of filtered) {
      const key = billDateKey(s);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered]);

  return (
    <div className="quotation-page intake-page">
      <div className="quotation-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#111111' }}>
            <IconDoc />
            <h1 style={{ margin: 0 }}>บิลรับเข้า</h1>
          </div>
          <p className="subtitle">ของที่รับเข้าคลังจากซัพพลายเออร์ · กดที่บิลเพื่อดูรายการข้างใน</p>
        </div>

        <div className="quotation-actions intake-toolbar">
          <div className="intake-seg">
            <button
              className={`intake-seg-btn ${range === 'today' ? 'active' : ''}`}
              onClick={() => setRange('today')}
            >
              วันนี้
            </button>
            <button
              className={`intake-seg-btn ${range === 'all' ? 'active' : ''}`}
              onClick={() => setRange('all')}
            >
              ทั้งหมด
            </button>
          </div>
          <div className="intake-date-field">
            <span className="intake-icon"><IconCalendar /></span>
            <input
              type="date"
              value={pickedDate}
              onChange={(e) => { setPickedDate(e.target.value); setRange('date'); }}
            />
          </div>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {!loading && (
        <div className="intake-summary">
          <div className="intake-summary-item">
            <div className="intake-summary-label">จำนวนบิล</div>
            <div className="intake-summary-value">
              {totals.bills.toLocaleString()}<span className="unit">บิล</span>
            </div>
          </div>
          <div className="intake-summary-item">
            <div className="intake-summary-label">รายการ</div>
            <div className="intake-summary-value">
              {totals.items.toLocaleString()}<span className="unit">รายการ</span>
            </div>
          </div>
          <div className="intake-summary-item is-good">
            <div className="intake-summary-label">รับเข้ารวม</div>
            <div className="intake-summary-value">
              +{totals.qty.toLocaleString()}<span className="unit">ชิ้น</span>
            </div>
          </div>
        </div>
      )}

      {loading && <div className="loading">กำลังโหลด...</div>}

      {!loading && filtered.length === 0 && (
        <div className="empty-message">
          {range === 'all'
            ? 'ยังไม่มีบิลรับเข้า'
            : `ไม่พบบิลในวันที่ ${fmtDateKey(range === 'today' ? todayStr() : pickedDate)}`}
        </div>
      )}

      {groups.map(([dateKey, list]) => (
        <div key={dateKey}>
          <div className="intake-day-head">
            <span className="intake-day-title">{fmtDateKey(dateKey)}</span>
            <span className="intake-day-count">{list.length} บิล</span>
          </div>

          {list.map((s) => {
            // บิลที่คีย์ย้อนหลัง: วันของบิลไม่ตรงกับวันที่กดบันทึกจริง
            const keyedDay = String(s.created_at || '').slice(0, 10);
            const backdated = keyedDay && keyedDay !== dateKey;
            return (
              <button
                key={s.id}
                className="intake-bill"
                onClick={() => openDetail(s.id)}
                disabled={detailLoading}
              >
                <div className="intake-bill-main">
                  <div className="intake-bill-no">{s.invoice_no}</div>
                  <div className="intake-bill-meta">
                    <span>{s.full_name || '—'}</span>
                    <span>· {formatDbTime(s.created_at)}</span>
                    {backdated && <span className="intake-backdate-chip">คีย์ย้อนหลัง</span>}
                  </div>
                </div>

                <div className="intake-bill-stats">
                  <div>
                    <div className="intake-stat-value">{Number(s.item_count ?? 0).toLocaleString()}</div>
                    <div className="intake-stat-label">รายการ</div>
                  </div>
                  <div>
                    <div className="intake-stat-value is-good">+{Number(s.total_qty ?? 0).toLocaleString()}</div>
                    <div className="intake-stat-label">ชิ้น</div>
                  </div>
                </div>

                <span className="intake-chevron"><IconChevron /></span>
              </button>
            );
          })}
        </div>
      ))}

      {/* ── รายละเอียดบิล ── */}
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="modal-card medium" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>รายละเอียดบิล</h2>
              <button className="btn-close" onClick={() => setSelected(null)}><IconClose /></button>
            </div>

            <div className="intake-detail-head">
              <span className="intake-detail-no">{selected.session.invoice_no}</span>
              <span className="intake-detail-sub">
                วันที่บิล {fmtDateKey(billDateKey(selected.session))}
              </span>
              <span className="intake-detail-sub">
                · บันทึกโดย {selected.session.full_name} เมื่อ {formatDbDateTime(selected.session.created_at)}
              </span>
            </div>

            {selected.items.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#9ca3af', padding: '1.5rem 0' }}>
                ยังไม่มีรายการในบิลนี้ — กดปุ่มสแกนด้านล่างเพื่อเพิ่มของเข้าบิล
              </p>
            ) : (
              <div className="quotation-table-wrap">
                <table className="quotation-table">
                  <thead>
                    <tr>
                      <th className="col-no">ลำดับ</th>
                      <th>รหัส</th>
                      <th>รายการ</th>
                      <th className="col-amount">จำนวน</th>
                      <th>เวลาที่สแกน</th>
                      <th>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.items.map((item, i) => (
                      <tr key={item.id}>
                        <td className="col-no" data-label="ลำดับ">{i + 1}</td>
                        <td data-label="รหัส" style={{ fontFamily: 'Consolas, monospace', fontWeight: 700 }}>
                          {item.model_code}
                          <span className="intake-kind-chip">{item.item_type === 'rack' ? 'แร็ค' : 'ปีกนก'}</span>
                        </td>
                        <td data-label="รายการ">{item.rack_name}</td>
                        <td className="col-amount" data-label="จำนวน">
                          <span className="intake-detail-total" style={{ fontWeight: 700 }}>
                            +{Number(item.qty ?? 0).toLocaleString()}
                          </span>
                        </td>
                        <td data-label="เวลาที่สแกน">{formatDbTime(item.created_at)}</td>
                        <td data-label="จัดการ">
                          <button
                            className="intake-del-btn"
                            onClick={() => handleDeleteItem(item)}
                            disabled={deletingId === item.id}
                            aria-label={`ลบ ${item.rack_name}`}
                          >
                            <IconTrash />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} style={{ fontWeight: 700 }}>รวมทั้งหมด</td>
                      <td className="col-amount">
                        <span className="intake-detail-total" style={{ fontWeight: 800, fontSize: '1rem' }}>
                          +{selected.items.reduce((s, it) => s + Number(it.qty ?? 0), 0).toLocaleString()}
                        </span>
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: '1rem' }}>
              <button className="btn-primary" onClick={handleScanIntoBill}>
                <IconQR /> สแกนของเข้าบิลนี้
              </button>
              <button className="btn-secondary" onClick={() => setSelected(null)}>ปิด</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
