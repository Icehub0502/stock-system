import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import client from "../api/client";
import DailySummaryDetailModal from "../components/DailySummaryDetailModal";

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

function formatDateTh(dateStr) {
  const d = new Date(dateStr);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear() + 543;
  return `${dd}/${mm}/${yyyy}`;
}

// "2026-08-01" → "สิงหาคม 2569" — ใช้เป็นหัวข้อ "แฟ้ม" ของแต่ละเดือน
function formatMonthTh(monthStr) {
  const d = new Date(monthStr);
  return `${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}

function monthKey(dateStr) {
  return String(dateStr).slice(0, 7); // "YYYY-MM"
}

function formatBaht(value) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function DailySalesSummaryPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [dayRows, setDayRows] = useState([]);
  const [monthRows, setMonthRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState(null);
  // เดือนที่ "เปิดแฟ้ม" อยู่ — ค่าเริ่มต้นคือเดือนปัจจุบันเดือนเดียว เดือนเก่ากว่านั้น
  // พับเก็บไว้เหมือนแฟ้มเอกสาร กดหัวเดือนเพื่อเปิดดูรายวันข้างในทีหลังได้
  const [expandedMonths, setExpandedMonths] = useState(null);

  const fetchSummary = async () => {
    try {
      setLoading(true);
      const [dailyRes, monthlyRes] = await Promise.all([
        client.get('/receipts/daily-summary'),
        client.get('/receipts/monthly-summary'),
      ]);
      setDayRows(dailyRes.data.data || []);
      setMonthRows(monthlyRes.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || 'โหลดสรุปยอดไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  // Arriving here right after printing a receipt (see ReceiptListPage) —
  // jump straight into that date's detail so office can fill in the
  // payment method for the bill they just printed. Clear the nav state
  // afterward so a later back/refresh doesn't reopen it. Also make sure
  // that date's month "แฟ้ม" is open, not collapsed away in the archive.
  useEffect(() => {
    if (location.state?.openDate) {
      setSelectedDate(location.state.openDate);
      setExpandedMonths((prev) => new Set(prev).add(monthKey(location.state.openDate)));
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  // ค่าเริ่มต้นของแฟ้มที่เปิดอยู่ — ต้องรอ monthRows โหลดมาก่อนถึงจะรู้ว่า "เดือน
  // ปัจจุบัน" ในข้อมูลจริงคือเดือนไหน (กันเปิดแฟ้มว่างถ้าเดือนนี้ยังไม่มีบิลเลย)
  useEffect(() => {
    if (expandedMonths === null && monthRows.length > 0) {
      setExpandedMonths(new Set([monthRows[0].month.slice(0, 7)]));
    }
  }, [monthRows, expandedMonths]);

  const dayRowsByMonth = useMemo(() => {
    const map = new Map();
    for (const row of dayRows) {
      const key = monthKey(row.date);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return map;
  }, [dayRows]);

  const toggleMonth = (key) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalBills = monthRows.reduce((sum, r) => sum + Number(r.bill_count || 0), 0);
  const totalCustomers = monthRows.reduce((sum, r) => sum + Number(r.customer_count || 0), 0);
  const totalRevenue = monthRows.reduce((sum, r) => sum + Number(r.total_revenue || 0), 0);

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>สรุปยอดขาย</h1>
          <p className="subtitle">แยกเป็นแฟ้มรายเดือน — เดือนเก่าพับเก็บไว้ กดเปิดดูรายวันข้างในได้</p>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : monthRows.length === 0 ? (
        <div className="empty-message">ยังไม่มีข้อมูลบิล</div>
      ) : (
        <>
          <div className="receipt-side-card" style={{ maxWidth: 320, marginBottom: 18 }}>
            <div className="receipt-summary-title">รวมทั้งหมด</div>
            <div className="receipt-summary-row"><span>จำนวนบิล</span><span>{totalBills.toLocaleString('en-US')}</span></div>
            <div className="receipt-summary-row"><span>จำนวนลูกค้า</span><span>{totalCustomers.toLocaleString('en-US')}</span></div>
            <div className="receipt-summary-total">฿{formatBaht(totalRevenue)}</div>
          </div>

          <div className="quotation-table-wrap">
            <table className="quotation-table">
              <thead>
                <tr>
                  <th>วันที่</th>
                  <th>จำนวนบิล</th>
                  <th>จำนวนลูกค้า</th>
                  <th>ยอดขายรวม</th>
                </tr>
              </thead>
              <tbody>
                {monthRows.map((month) => {
                  const key = month.month.slice(0, 7);
                  const isOpen = expandedMonths?.has(key);
                  const days = dayRowsByMonth.get(key) || [];
                  return (
                    <React.Fragment key={key}>
                      <tr
                        className="month-group-header-row clickable-row"
                        onClick={() => toggleMonth(key)}
                      >
                        <td colSpan={2}>
                          <span className="month-group-toggle">{isOpen ? '▾' : '▸'}</span>
                          {formatMonthTh(month.month)}
                          <span className="date-group-count"> ({Number(month.bill_count).toLocaleString('en-US')} บิล · {Number(month.customer_count).toLocaleString('en-US')} ลูกค้า)</span>
                        </td>
                        <td colSpan={2} className="amount">฿{formatBaht(month.total_revenue)}</td>
                      </tr>
                      {isOpen && days.map((row) => (
                        <tr
                          key={row.date}
                          className="clickable-row"
                          onClick={() => setSelectedDate(row.date)}
                        >
                          <td data-label="วันที่"><strong>{formatDateTh(row.date)}</strong></td>
                          <td data-label="จำนวนบิล">{Number(row.bill_count).toLocaleString('en-US')}</td>
                          <td data-label="จำนวนลูกค้า">{Number(row.customer_count).toLocaleString('en-US')}</td>
                          <td className="amount" data-label="ยอดขายรวม">฿{formatBaht(row.total_revenue)}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selectedDate && (
        <DailySummaryDetailModal
          date={selectedDate}
          onClose={() => setSelectedDate(null)}
          onReceiptsMoved={fetchSummary}
        />
      )}
    </div>
  );
}
