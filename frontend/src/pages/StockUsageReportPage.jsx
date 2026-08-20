import React, { useEffect, useMemo, useState } from 'react';
import client from '../api/client';
import { todayStr } from '../utils/format';
import { formatDateTh } from '../utils/dateGroups';

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

// ประวัติการตัดสต๊อก แยกตามวันที่ — แต่ละวันแสดงยอดรวมที่ตัดออก + รายการอะไหล่
// แต่ละชิ้นที่ตัดในวันนั้น (เดิมเป็นรายงาน "อะไหล่ตามรุ่นรถ" กลุ่มตามรุ่นรถ
// เจ้าของร้านสั่งเปลี่ยนมากลุ่มตามวันที่แทน — ดูย้อนหลังง่ายกว่าว่าวันไหนตัดอะไรไป
// เท่าไหร่) tx_date มาจาก created_at จริง ตรงกับวันที่ที่เลือกตอนตัด แม้เป็นการ
// ตัดย้อนหลังผ่านช่อง "วันที่ตัดสต๊อก" ในหน้าตัดสต๊อกก็ตาม
export default function StockUsageReportPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [periodType, setPeriodType] = useState('all'); // 'all' | 'day' | 'month' | 'year'
  const [dayValue, setDayValue] = useState(todayStr());
  const [monthValue, setMonthValue] = useState(todayStr().slice(0, 7));
  const [yearValue, setYearValue] = useState(CURRENT_YEAR);

  const { from, to } = useMemo(
    () => computePeriod(periodType, dayValue, monthValue, yearValue),
    [periodType, dayValue, monthValue, yearValue]
  );

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const params = {};
        if (from) params.from = from;
        if (to) params.to = to;
        const res = await client.get('/transactions/deduction-history', { params });
        setRows(res.data.data || []);
      } catch (err) {
        setError(err.response?.data?.error || 'โหลดประวัติการตัดสต๊อกไม่สำเร็จ');
      } finally {
        setLoading(false);
      }
    })();
  }, [from, to]);

  // กลุ่มแถวแบนจาก backend (วันที่ + อะไหล่ + รุ่นรถ) ให้เป็นก้อนต่อวัน — เรียงจาก
  // วันล่าสุดไปเก่าสุด (backend ORDER BY tx_date DESC มาแล้ว ใช้ insertion order ต่อ)
  const byDate = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const key = r.tx_date;
      if (!map.has(key)) map.set(key, { tx_date: key, total_qty: 0, items: [] });
      const entry = map.get(key);
      entry.total_qty += Number(r.total_qty);
      entry.items.push(r);
    }
    return Array.from(map.values());
  }, [rows]);

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
                    <th>จำนวนครั้ง</th>
                  </tr>
                </thead>
                <tbody>
                  {day.items.map((r, idx) => (
                    <tr key={idx}>
                      <td data-label="ประเภท">{r.item_type === 'rack' ? 'แร็ค' : 'ปีกนก'}</td>
                      <td data-label="รหัสอะไหล่">{r.part_code}</td>
                      <td data-label="ชื่ออะไหล่">{r.part_name}</td>
                      <td data-label="รุ่นรถ">{r.vehicle_model || '-'}</td>
                      <td data-label="จำนวนที่ตัดออก">{Number(r.total_qty).toLocaleString('en-US')}</td>
                      <td data-label="จำนวนครั้ง">{r.movement_count}</td>
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
