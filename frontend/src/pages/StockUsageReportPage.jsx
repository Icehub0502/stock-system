import React, { useEffect, useMemo, useState } from 'react';
import client from '../api/client';
import { todayStr } from '../utils/format';

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

// สรุปว่าอะไหล่ตัวไหนถูกตัดสต๊อกไปใช้กับรถรุ่นไหนบ่อยสุด — vehicle_model มาจากชื่อ
// รายการอะไหล่เอง ดึงอัตโนมัติตอนตัดสต๊อก (ดู vehicleModelFromName.js ฝั่ง backend,
// StockDeductionPage.jsx ฝั่งหน้าตัดสต๊อก) ไม่ใช่ข้อความที่พนักงานพิมพ์เอง
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
        const res = await client.get('/transactions/usage-report', { params });
        setRows(res.data.data || []);
      } catch (err) {
        setError(err.response?.data?.error || 'โหลดรายงานไม่สำเร็จ');
      } finally {
        setLoading(false);
      }
    })();
  }, [from, to]);

  // สรุปยอดรวมแยกตามรุ่นรถ (ไม่แยกอะไหล่) ไว้ดูภาพรวมด้านบนตาราง — รุ่นไหนมาบ่อย
  // ที่สุดจะได้เห็นทันทีโดยไม่ต้องไล่บวกเองจากตารางแยกอะไหล่ด้านล่าง
  const byModel = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const key = r.vehicle_model || '';
      const entry = map.get(key) || { vehicle_model: r.vehicle_model, total_qty: 0 };
      entry.total_qty += Number(r.total_qty);
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.total_qty - a.total_qty);
  }, [rows]);

  return (
    <div className="office-dashboard container">
      <div className="dashboard-header">
        <h2>รายงานอะไหล่ตามรุ่นรถ <span className="dashboard-header-sub">— ดูว่าควรสต๊อกอะไหล่ของรถรุ่นไหนเป็นพิเศษ</span></h2>
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
      ) : rows.length === 0 ? (
        <div className="empty-message">ยังไม่มีข้อมูลการตัดสต๊อกในช่วงนี้</div>
      ) : (
        <>
          <div className="dash-panel">
            <div className="dash-panel-title">สรุปยอดรวมตามรุ่นรถ</div>
            <div className="quotation-table-wrap">
              <table className="quotation-table">
                <thead>
                  <tr>
                    <th>รุ่นรถ</th>
                    <th>จำนวนอะไหล่ที่ตัดออกรวม</th>
                  </tr>
                </thead>
                <tbody>
                  {byModel.map((m) => (
                    <tr key={m.vehicle_model}>
                      <td data-label="รุ่นรถ">{m.vehicle_model || '-'}</td>
                      <td data-label="จำนวนอะไหล่ที่ตัดออกรวม">{m.total_qty.toLocaleString('en-US')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="dash-panel">
            <div className="dash-panel-title">รายละเอียดแยกตามอะไหล่</div>
            <div className="quotation-table-wrap">
              <table className="quotation-table">
                <thead>
                  <tr>
                    <th>รุ่นรถ</th>
                    <th>ประเภท</th>
                    <th>รหัสอะไหล่</th>
                    <th>ชื่ออะไหล่</th>
                    <th>จำนวนที่ตัดออก</th>
                    <th>จำนวนครั้ง</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={idx}>
                      <td data-label="รุ่นรถ">{r.vehicle_model || '-'}</td>
                      <td data-label="ประเภท">{r.item_type === 'rack' ? 'แร็ค' : 'ปีกนก'}</td>
                      <td data-label="รหัสอะไหล่">{r.part_code}</td>
                      <td data-label="ชื่ออะไหล่">{r.part_name}</td>
                      <td data-label="จำนวนที่ตัดออก">{Number(r.total_qty).toLocaleString('en-US')}</td>
                      <td data-label="จำนวนครั้ง">{r.movement_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
