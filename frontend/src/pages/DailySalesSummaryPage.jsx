import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import client from "../api/client";
import DailySummaryDetailModal from "../components/DailySummaryDetailModal";

function formatDateTh(dateStr) {
  const d = new Date(dateStr);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear() + 543;
  return `${dd}/${mm}/${yyyy}`;
}

function formatBaht(value) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function DailySalesSummaryPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState(null);

  const fetchSummary = async () => {
    try {
      setLoading(true);
      const response = await client.get('/receipts/daily-summary');
      setRows(response.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || 'โหลดสรุปยอดรายวันไม่สำเร็จ');
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
  // afterward so a later back/refresh doesn't reopen it.
  useEffect(() => {
    if (location.state?.openDate) {
      setSelectedDate(location.state.openDate);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  const totalBills = rows.reduce((sum, r) => sum + Number(r.bill_count || 0), 0);
  const totalCustomers = rows.reduce((sum, r) => sum + Number(r.customer_count || 0), 0);
  const totalRevenue = rows.reduce((sum, r) => sum + Number(r.total_revenue || 0), 0);

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>สรุปยอดขายรายวัน</h1>
          <p className="subtitle">จำนวนบิล จำนวนลูกค้า และยอดขายรวมในแต่ละวัน</p>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : rows.length === 0 ? (
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
                {rows.map((row) => (
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
