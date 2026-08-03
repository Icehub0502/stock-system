import React, { useState, useEffect, useMemo } from "react";
import client from "../api/client";
import { DECLINE_REASONS, declineReasonLabel } from "../utils/declineReasons";
import { todayStr } from "../utils/format";

function daysAgoStr(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// สรุปเหตุผลที่ลูกค้ากด "ลูกค้าไม่ได้ทำ" ในแต่ละช่วงวันที่ — ใช้ข้อมูลจาก endpoint
// /quotations เดียวกับ QuotationListPage/AppointmentsPage (ดึงทั้งชุดแล้วกรอง/สรุปฝั่ง
// client เอง ตามธรรมเนียมเดิมของโปรเจกต์นี้ ไม่มี endpoint สรุปแยกต่างหาก) กราฟเป็น
// CSS bar chart มือทำเอง (mirror ของ .dash-trend-chart ใน DashboardPage.jsx) โปรเจกต์
// นี้ไม่มี chart library อยู่แล้ว จึงไม่เพิ่ม dependency ใหม่แค่เพื่อหน้านี้หน้าเดียว
export default function DeclinedSummaryPage() {
  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [from, setFrom] = useState(daysAgoStr(29));
  const [to, setTo] = useState(todayStr());

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const response = await client.get('/quotations');
        setQuotations(response.data.data || []);
      } catch (err) {
        setError(err.response?.data?.error || "เกิดข้อผิดพลาด");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const declined = useMemo(
    () =>
      quotations
        .filter((q) => q.status === 'declined')
        .filter((q) => q.quotation_date >= from && q.quotation_date <= to)
        .sort((a, b) => new Date(b.quotation_date) - new Date(a.quotation_date)),
    [quotations, from, to]
  );

  // นับตามลำดับที่กำหนดไว้ใน DECLINE_REASONS เสมอ (ไม่ใช่เรียงตามจำนวนที่เจอ) ให้
  // กราฟ/ตารางเรียงลำดับเดิมทุกครั้งไม่ว่าช่วงวันที่จะมีข้อมูลอะไรบ้าง
  const reasonCounts = useMemo(() => {
    const counts = Object.fromEntries(DECLINE_REASONS.map((r) => [r.value, 0]));
    for (const q of declined) {
      const key = counts.hasOwnProperty(q.decline_reason) ? q.decline_reason : 'other';
      counts[key] += 1;
    }
    return DECLINE_REASONS.map((r) => ({ ...r, count: counts[r.value] }));
  }, [declined]);

  const maxCount = Math.max(...reasonCounts.map((r) => r.count), 1);

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <h1>สรุปลูกค้าไม่ได้ทำ</h1>
      </div>

      <div className="decline-summary-filters">
        <div className="form-group">
          <label>ตั้งแต่วันที่</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} max={to} />
        </div>
        <div className="form-group">
          <label>ถึงวันที่</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} min={from} />
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : declined.length === 0 ? (
        <div className="empty-message">ไม่มีลูกค้าที่ไม่ได้ทำในช่วงวันที่นี้</div>
      ) : (
        <>
          <div className="dash-panel">
            <div className="dash-panel-title">กราฟสรุปตามเหตุผล ({declined.length} รายการ)</div>
            <div className="decline-summary-chart">
              {reasonCounts.map((r) => (
                <div key={r.value} className="decline-summary-bar-row">
                  <span className="decline-summary-bar-label">{r.label}</span>
                  <div className="decline-summary-bar-track">
                    <div
                      className="decline-summary-bar-fill"
                      style={{ width: `${(r.count / maxCount) * 100}%` }}
                    />
                  </div>
                  <span className="decline-summary-bar-count">{r.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="dash-panel">
            <div className="dash-panel-title">ตารางสรุปตามเหตุผล</div>
            <div className="quotation-table-wrap">
              <table className="quotation-table">
                <thead>
                  <tr>
                    <th>เหตุผล</th>
                    <th>จำนวน</th>
                    <th>สัดส่วน</th>
                  </tr>
                </thead>
                <tbody>
                  {reasonCounts.map((r) => (
                    <tr key={r.value}>
                      <td data-label="เหตุผล">{r.label}</td>
                      <td data-label="จำนวน">{r.count}</td>
                      <td data-label="สัดส่วน">{declined.length > 0 ? `${Math.round((r.count / declined.length) * 100)}%` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="dash-panel">
            <div className="dash-panel-title">รายการทั้งหมด</div>
            <div className="quotation-table-wrap">
              <table className="quotation-table">
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th>เลขที่</th>
                    <th>ชื่อลูกค้า</th>
                    <th>รุ่น/ทะเบียน</th>
                    <th>เหตุผล</th>
                  </tr>
                </thead>
                <tbody>
                  {declined.map((q) => (
                    <tr key={q.id}>
                      <td data-label="วันที่">{new Date(q.quotation_date).toLocaleDateString('th-TH')}</td>
                      <td data-label="เลขที่"><strong>{q.quotation_no}</strong></td>
                      <td className="col-customer-name" data-label="ชื่อลูกค้า">{q.customer_name}</td>
                      <td className="car-info" data-label="รุ่น/ทะเบียน">
                        {q.brand || q.car_brand} {q.model || q.car_model} / {q.license_plate}
                      </td>
                      <td data-label="เหตุผล">
                        {declineReasonLabel(q.decline_reason)}
                        {q.decline_reason === 'other' && q.decline_note ? ` — ${q.decline_note}` : ''}
                      </td>
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
