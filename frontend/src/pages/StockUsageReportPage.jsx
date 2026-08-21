import React, { useEffect, useMemo, useRef, useState } from 'react';
import client from '../api/client';
import { todayStr, formatDbTime } from '../utils/format';
import { formatDateTh } from '../utils/dateGroups';
import useRealtimeEvent from '../hooks/useRealtimeEvent';

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i);

// ช่วงวันที่เดียวกับ DeclinedSummaryPage.jsx (มุมมองวัน/เดือน/ปี) บวกตัวเลือก "ทั้งหมด"
// เพิ่มเข้ามา เพราะฟีเจอร์นี้เพิ่งเปิดใช้ — ถ้าเริ่มที่ "วันนี้" เป็นค่าเริ่มต้นเหมือน
// หน้าอื่นจะเจอตารางว่างเปล่าจนกว่าจะมีคนตัดสต๊อกแล้วจริง
function computePeriod(periodType, dayValue, monthValue, yearValue) {
  if (periodType === 'month') {
    const [y, m] = monthValue.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return { from: `${monthValue}-01`, to: `${monthValue}-${String(lastDay).padStart(2, '0')}` };
  }
  if (periodType === 'year') {
    return { from: `${yearValue}-01-01`, to: `${yearValue}-12-31` };
  }
  if (periodType === 'day') {
    return { from: dayValue, to: dayValue };
  }
  return { from: null, to: null }; // 'all'
}

// ตัวกรองที่พนักงานสร้างเองได้ ("ปุ่มนี้สามารถสร้างเพิ่มได้ในหน้านี้เลย") — เก็บใน
// localStorage เท่านั้น (ไม่มี backend รองรับ เป็นแค่ shortcut กรองส่วนตัวต่อ
// เครื่อง/เบราว์เซอร์ ไม่ใช่ข้อมูลธุรกิจที่ต้องแชร์ข้ามเครื่อง) แมตช์แบบ substring
// กับชื่ออะไหล่ ไม่สนตัวพิมพ์เล็กใหญ่
const CUSTOM_FILTERS_KEY = 'stockUsageReportCustomFilters';

function loadCustomFilters() {
  try {
    const raw = localStorage.getItem(CUSTOM_FILTERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// ประวัติการตัดสต๊อก แยกตามวันที่ — แต่ละวันแสดงยอดรวมที่ตัดออก + รายการอะไหล่
// แต่ละชิ้นที่ตัดในวันนั้น (เดิมเป็นรายงาน "อะไหล่ตามรุ่นรถ" กลุ่มตามรุ่นรถ
// เจ้าของร้านสั่งเปลี่ยนมากลุ่มตามวันที่แทน — ดูย้อนหลังง่ายกว่าว่าวันไหนตัดอะไรไป
// เท่าไหร่) tx_date มาจาก created_at จริง ตรงกับวันที่ที่เลือกตอนตัด แม้เป็นการ
// ตัดย้อนหลังผ่านช่อง "วันที่ตัดสต๊อก" ในหน้าตัดสต๊อกก็ตาม — แต่ละแถวคือ
// transaction จริง 1 รายการ (ไม่รวมยอดแล้วเหมือนก่อนหน้านี้) เพื่อให้มีปุ่มลบ
// รายตัวได้ (เรียก DELETE /transactions/:id เดิมที่คืนสต็อกให้ถูกต้องอยู่แล้ว)
export default function StockUsageReportPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [periodType, setPeriodType] = useState('all'); // 'all' | 'day' | 'month' | 'year'
  const [dayValue, setDayValue] = useState(todayStr());
  const [monthValue, setMonthValue] = useState(todayStr().slice(0, 7));
  const [yearValue, setYearValue] = useState(CURRENT_YEAR);
  const [deletingId, setDeletingId] = useState(null);

  const [typeFilter, setTypeFilter] = useState(''); // '' | 'rack' | 'wing_arm'
  const [customFilters, setCustomFilters] = useState(loadCustomFilters);
  const [activeCustomFilter, setActiveCustomFilter] = useState(null);
  const [showAddFilter, setShowAddFilter] = useState(false);
  const [newFilterLabel, setNewFilterLabel] = useState('');
  const [newFilterKeyword, setNewFilterKeyword] = useState('');

  const { from, to } = useMemo(
    () => computePeriod(periodType, dayValue, monthValue, yearValue),
    [periodType, dayValue, monthValue, yearValue]
  );

  const load = async ({ silent } = {}) => {
    try {
      if (!silent) setLoading(true);
      const params = {};
      if (from) params.from = from;
      if (to) params.to = to;
      const res = await client.get('/transactions/deduction-history', { params });
      setRows(res.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || 'โหลดประวัติการตัดสต๊อกไม่สำเร็จ');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => { load(); }, [from, to]);

  // Realtime: มีคนรับ-จ่ายสต๊อกจากเครื่อง/แท็บอื่น ให้รีเฟรชตารางอัตโนมัติ —
  // เลื่อนการรีเฟรชออกไปก่อนถ้ากำลังลบแถวอยู่ (deletingId) หรือกำลังเปิดฟอร์ม
  // "เพิ่มตัวกรอง" (showAddFilter) เพื่อไม่ให้ข้อมูลที่กำลังกรอกหาย/สลับกลาง
  // อากาศ — ค้างไว้ใน pendingRefreshRef แล้วรีเฟรชให้ทันทีที่เงื่อนไขปลดล็อก
  const pendingRefreshRef = useRef(false);
  useRealtimeEvent(
    ['stock:tx-created', 'stock:tx-deleted'],
    () => {
      if (deletingId !== null || showAddFilter) {
        pendingRefreshRef.current = true;
        return;
      }
      load({ silent: true });
    }
  );

  useEffect(() => {
    if (deletingId === null && !showAddFilter && pendingRefreshRef.current) {
      pendingRefreshRef.current = false;
      load({ silent: true });
    }
  }, [deletingId, showAddFilter]);

  useEffect(() => {
    localStorage.setItem(CUSTOM_FILTERS_KEY, JSON.stringify(customFilters));
  }, [customFilters]);

  function addCustomFilter() {
    const label = newFilterLabel.trim();
    const keyword = newFilterKeyword.trim();
    if (!label || !keyword) return;
    setCustomFilters((prev) => [...prev, { id: Date.now(), label, keyword }]);
    setNewFilterLabel('');
    setNewFilterKeyword('');
    setShowAddFilter(false);
  }

  function removeCustomFilter(id) {
    setCustomFilters((prev) => prev.filter((f) => f.id !== id));
    if (activeCustomFilter === id) setActiveCustomFilter(null);
  }

  async function handleDelete(id) {
    if (!window.confirm('ลบรายการนี้และคืนสต็อกกลับหรือไม่?')) return;
    setDeletingId(id);
    try {
      await client.delete(`/transactions/${id}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'ลบรายการไม่สำเร็จ');
    } finally {
      setDeletingId(null);
    }
  }

  // กรองด้วยประเภท (แร็ค/ปีกนก) และตัวกรองที่สร้างเอง — เลือกได้ทีละอย่าง (ติ๊ก
  // ปุ่มเดียว ไม่ใช่หลายปุ่มพร้อมกัน) ง่ายและคาดเดาผลได้ตรงกับที่ขอ
  const filteredRows = useMemo(() => {
    const activeFilter = customFilters.find((f) => f.id === activeCustomFilter);
    return rows.filter((r) => {
      if (typeFilter && r.item_type !== typeFilter) return false;
      if (activeFilter && !r.part_name?.toLowerCase().includes(activeFilter.keyword.toLowerCase())) return false;
      return true;
    });
  }, [rows, typeFilter, activeCustomFilter, customFilters]);

  // กลุ่มแถวแบนจาก backend (วันที่ + รายการ) ให้เป็นก้อนต่อวัน — เรียงจาก
  // วันล่าสุดไปเก่าสุด (backend ORDER BY tx_date DESC มาแล้ว ใช้ insertion order ต่อ)
  const byDate = useMemo(() => {
    const map = new Map();
    for (const r of filteredRows) {
      const key = r.tx_date;
      if (!map.has(key)) map.set(key, { tx_date: key, total_qty: 0, items: [] });
      const entry = map.get(key);
      entry.total_qty += Number(r.qty);
      entry.items.push(r);
    }
    return Array.from(map.values());
  }, [filteredRows]);

  return (
    <div className="office-dashboard container">
      <div className="dashboard-header">
        <h2>ประวัติการตัดสต๊อก <span className="dashboard-header-sub">— ดูย้อนหลังว่าวันไหนตัดอะไหล่อะไรไปบ้าง เท่าไหร่</span></h2>
      </div>

      <div className="decline-summary-filters">
        <div className="form-group">
          <label>มุมมอง</label>
          <select value={periodType} onChange={(e) => setPeriodType(e.target.value)}>
            <option value="all">ทั้งหมด</option>
            <option value="day">รายวัน</option>
            <option value="month">รายเดือน</option>
            <option value="year">รายปี</option>
          </select>
        </div>
        {periodType === 'day' && (
          <div className="form-group">
            <label>วันที่</label>
            <input type="date" value={dayValue} onChange={(e) => setDayValue(e.target.value)} />
          </div>
        )}
        {periodType === 'month' && (
          <div className="form-group">
            <label>เดือน</label>
            <input type="month" value={monthValue} onChange={(e) => setMonthValue(e.target.value)} />
          </div>
        )}
        {periodType === 'year' && (
          <div className="form-group">
            <label>ปี</label>
            <select value={yearValue} onChange={(e) => setYearValue(Number(e.target.value))}>
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>{y + 543}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* ── ตัวกรองประเภท + ตัวกรองที่สร้างเอง ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '8px 0 16px', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', color: 'var(--color-text-secondary, #666)', alignSelf: 'center' }}>กรอง:</span>
        {[{ value: 'rack', label: 'แร็ค' }, { value: 'wing_arm', label: 'ปีกนก' }].map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setTypeFilter((v) => (v === o.value ? '' : o.value))}
            style={{
              padding: '4px 12px', borderRadius: '20px', fontSize: '13px', cursor: 'pointer',
              border: '1px solid', transition: 'all .15s',
              background: typeFilter === o.value ? 'var(--color-text-primary, #222)' : 'transparent',
              color: typeFilter === o.value ? 'var(--color-background-primary, #fff)' : 'var(--color-text-secondary, #666)',
              borderColor: typeFilter === o.value ? 'var(--color-text-primary, #222)' : 'var(--color-border-secondary, #ccc)',
            }}
          >
            {o.label}
          </button>
        ))}

        {customFilters.map((f) => (
          <span key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <button
              type="button"
              onClick={() => setActiveCustomFilter((v) => (v === f.id ? null : f.id))}
              style={{
                padding: '4px 12px', borderRadius: '20px', fontSize: '13px', cursor: 'pointer',
                border: '1px solid', transition: 'all .15s',
                background: activeCustomFilter === f.id ? '#1d4ed8' : 'transparent',
                color: activeCustomFilter === f.id ? '#fff' : 'var(--color-text-secondary, #666)',
                borderColor: activeCustomFilter === f.id ? '#1d4ed8' : 'var(--color-border-secondary, #ccc)',
              }}
            >
              {f.label}
            </button>
            <button
              type="button"
              onClick={() => removeCustomFilter(f.id)}
              aria-label={`ลบตัวกรอง ${f.label}`}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '13px' }}
            >
              ✕
            </button>
          </span>
        ))}

        {(typeFilter || activeCustomFilter) && (
          <button
            type="button"
            onClick={() => { setTypeFilter(''); setActiveCustomFilter(null); }}
            style={{ fontSize: '12px', color: 'var(--color-text-secondary, #666)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
          >
            ล้างตัวกรอง
          </button>
        )}

        <button type="button" onClick={() => setShowAddFilter(true)} style={{ fontSize: '13px' }}>
          + เพิ่มตัวกรอง
        </button>
      </div>

      {showAddFilter && (
        <div className="modal-backdrop" onClick={() => setShowAddFilter(false)}>
          <div className="modal-card" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">+ เพิ่มตัวกรอง</h3>
            <div className="modal-form">
              <label>ชื่อปุ่ม</label>
              <input type="text" placeholder="เช่น ลูกหมาก" value={newFilterLabel} onChange={(e) => setNewFilterLabel(e.target.value)} />
              <label>คำค้นหาในชื่ออะไหล่</label>
              <input type="text" placeholder="เช่น ลูกหมาก" value={newFilterKeyword} onChange={(e) => setNewFilterKeyword(e.target.value)} />
              <div className="modal-actions">
                <button type="button" className="btn-primary" onClick={addCustomFilter} disabled={!newFilterLabel.trim() || !newFilterKeyword.trim()}>
                  เพิ่ม
                </button>
                <button type="button" onClick={() => setShowAddFilter(false)}>ยกเลิก</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : byDate.length === 0 ? (
        <div className="empty-message">ยังไม่มีข้อมูลการตัดสต๊อกในช่วงนี้</div>
      ) : (
        byDate.map((day) => (
          <div className="dash-panel" key={day.tx_date}>
            <div className="dash-panel-title">
              {formatDateTh(day.tx_date)} — ตัดออกรวม {day.total_qty.toLocaleString('en-US')} ชิ้น
            </div>
            <div className="quotation-table-wrap">
              <table className="quotation-table">
                <thead>
                  <tr>
                    <th>ประเภท</th>
                    <th>รหัสอะไหล่</th>
                    <th>ชื่ออะไหล่</th>
                    <th>รุ่นรถ</th>
                    <th>จำนวนที่ตัดออก</th>
                    <th>เวลา</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {day.items.map((r) => (
                    <tr key={r.id}>
                      <td data-label="ประเภท">{r.item_type === 'rack' ? 'แร็ค' : 'ปีกนก'}</td>
                      <td data-label="รหัสอะไหล่">{r.part_code}</td>
                      <td data-label="ชื่ออะไหล่">{r.part_name}</td>
                      <td data-label="รุ่นรถ">{r.vehicle_model || '-'}</td>
                      <td data-label="จำนวนที่ตัดออก">{Number(r.qty).toLocaleString('en-US')}</td>
                      <td data-label="เวลา">{formatDbTime(r.created_at)}</td>
                      <td data-label="">
                        <button
                          type="button"
                          className="btn-danger"
                          disabled={deletingId === r.id}
                          onClick={() => handleDelete(r.id)}
                        >
                          {deletingId === r.id ? '...' : '🗑️ ลบ'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
