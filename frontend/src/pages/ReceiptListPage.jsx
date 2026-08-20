import React, { useEffect, useMemo, useRef, useState } from "react";
import client from "../api/client";
import ReceiptFormModal from "../components/ReceiptFormModal";
import ReceiptPrintModal from "../components/ReceiptPrintModal";
import { buildArchiveGroups, formatDateTh, formatMonthTh, formatYearTh } from "../utils/dateGroups";
import useRealtimeEvent from "../hooks/useRealtimeEvent";

export default function ReceiptListPage() {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingReceiptId, setEditingReceiptId] = useState(null);
  const [selectedReceiptForPrint, setSelectedReceiptForPrint] = useState(null);

  const fetchReceipts = async ({ silent } = {}) => {
    try {
      if (!silent) setLoading(true);
      const response = await client.get('/receipts');
      setReceipts(response.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || 'โหลดบิลไม่สำเร็จ');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchReceipts();
  }, []);

  // Realtime: quotation-side actions (approve/close) also emit receipt:*
  // events server-side, so this page only needs the receipt channel. Guarded
  // only on the create/edit form modal — the print modal fetches its own
  // single receipt by id independently, so it's unaffected by a background
  // list refetch and doesn't need a guard.
  const pendingRefreshRef = useRef(false);
  useRealtimeEvent(
    ['receipt:created', 'receipt:updated', 'receipt:deleted'],
    () => {
      if (showFormModal) {
        pendingRefreshRef.current = true;
        return;
      }
      fetchReceipts({ silent: true });
    }
  );

  useEffect(() => {
    if (!showFormModal && pendingRefreshRef.current) {
      pendingRefreshRef.current = false;
      fetchReceipts({ silent: true });
    }
  }, [showFormModal]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return receipts.filter((r) =>
      r.receipt_no.toLowerCase().includes(q) ||
      r.customer_code?.toLowerCase().includes(q) ||
      r.customer_name?.toLowerCase().includes(q) ||
      `${r.brand || ''} ${r.model || ''} ${r.license_plate || ''}`.toLowerCase().includes(q)
    );
  }, [receipts, search]);

  // จัดเป็นแฟ้ม ปี → เดือน → วัน (ใหม่สุดอยู่บนสุด) เหมือนหน้าสรุปยอด — การย้ายบิล
  // ไปวันอื่น (จากหน้าสรุปยอด "ย้ายไปวันถัดไป"/"ย้ายไปวันก่อนหน้า") ยังคงย้ายที่
  // แสดงผลตรงนี้ตามจริง เพราะจัดกลุ่มจาก receipt_date ที่ backend ส่งมาเสมอ
  const archive = useMemo(
    () => buildArchiveGroups(filtered, (r) => r.receipt_date),
    [filtered]
  );

  const [expandedYears, setExpandedYears] = useState(null);
  const [expandedMonths, setExpandedMonths] = useState(null);

  useEffect(() => {
    if (expandedYears === null && archive.length > 0) {
      setExpandedYears(new Set([archive[0].key]));
      setExpandedMonths(new Set([archive[0].months[0].key]));
    }
  }, [archive, expandedYears]);

  const toggleYear = (key) => {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleMonth = (key) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleDelete = async (id) => {
    if (window.confirm('ยืนยันการลบใบเสร็จนี้? การกระทำนี้ไม่สามารถย้อนกลับได้')) {
      try {
        await client.delete(`/receipts/${id}`);
        setReceipts((prev) => prev.filter((r) => r.id !== id));
      } catch (err) {
        alert('ลบใบเสร็จไม่สำเร็จ: ' + (err.response?.data?.error || err.message));
      }
    }
  };

  const handlePrinted = (receiptId) => {
    setReceipts((prev) =>
      prev.map((r) => (r.id === receiptId ? { ...r, printed_at: new Date().toISOString() } : r))
    );
    setSelectedReceiptForPrint(null);
  };

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>ใบเสร็จรับเงิน / ใบรับประกันสินค้า</h1>
          <p className="subtitle">สร้างบิลใหม่, ดูรายละเอียด, พิมพ์หรือบันทึกเป็น PDF จากหน้าเดียว</p>
        </div>

        <div className="quotation-actions">
          <input
            type="text"
            className="search-input"
            placeholder="ค้นหาเลขที่บิล, ลูกค้า, หรือทะเบียนรถ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn btn-primary btn-fab-mobile" onClick={() => setShowFormModal(true)}>
            + สร้างบิลใหม่
          </button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-message">ไม่พบบิล</div>
      ) : (
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead>
              <tr>
                <th className="col-no">ลำดับ</th>
                <th>เลขที่บิล</th>
                <th>รหัสลูกค้า</th>
                <th>ชื่อลูกค้า</th>
                <th>รถ</th>
                <th>จำนวนเงิน</th>
                <th>สถานะ</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                let rowNo = 0;
                return archive.map((year) => {
                  const yearOpen = expandedYears?.has(year.key);
                  return (
                    <React.Fragment key={year.key}>
                      <tr className="year-group-header-row clickable-row" onClick={() => toggleYear(year.key)}>
                        <td colSpan={8}>
                          <span className="month-group-toggle">{yearOpen ? '▾' : '▸'}</span>
                          {formatYearTh(year.key)}
                          <span className="date-group-count"> ({year.count} บิล)</span>
                        </td>
                      </tr>
                      {yearOpen && year.months.map((month) => {
                        const monthOpen = expandedMonths?.has(month.key);
                        return (
                          <React.Fragment key={month.key}>
                            <tr className="month-group-header-row clickable-row" onClick={() => toggleMonth(month.key)}>
                              <td colSpan={8} style={{ paddingLeft: 28 }}>
                                <span className="month-group-toggle">{monthOpen ? '▾' : '▸'}</span>
                                {formatMonthTh(month.key)}
                                <span className="date-group-count"> ({month.count} บิล)</span>
                              </td>
                            </tr>
                            {monthOpen && month.days.map((day) => (
                              <React.Fragment key={day.key}>
                                <tr className="date-group-header-row">
                                  <td colSpan={8}>
                                    {formatDateTh(day.key)}
                                    <span className="date-group-count"> ({day.rows.length} บิล)</span>
                                  </td>
                                </tr>
                                {day.rows.map((receipt) => {
                                  rowNo += 1;
                                  return (
                        <tr key={receipt.id}>
                          <td className="col-no" data-label="ลำดับ">{rowNo}</td>
                          <td data-label="เลขที่บิล"><strong>{receipt.receipt_no}</strong></td>
                          <td data-label="รหัสลูกค้า">{receipt.customer_code || '-'}</td>
                          <td className="col-customer-name" data-label="ชื่อลูกค้า">{receipt.customer_name}</td>
                          <td className="car-info" data-label="รถ">{receipt.brand} {receipt.model} / {receipt.license_plate}</td>
                          <td className="amount" data-label="จำนวนเงิน">฿{Number(receipt.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td data-label="สถานะ">
                            {receipt.is_paid ? (
                              <span className="status-badge status-badge-paid">💰 ชำระแล้ว</span>
                            ) : (
                              <span className="status-badge status-badge-warning">⏳ รอชำระ</span>
                            )}
                          </td>
                          <td className="actions" data-label="จัดการ">
                            <button
                              className="btn-icon-small"
                              onClick={() => { setEditingReceiptId(receipt.id); setShowFormModal(true); }}
                            >
                              แก้ไข
                            </button>
                            <button
                              className={`btn-icon-small ${receipt.printed_at ? 'btn-printed' : ''}`}
                              onClick={() => setSelectedReceiptForPrint(receipt.id)}
                              title={receipt.printed_at ? `พิมพ์แล้วเมื่อ ${new Date(receipt.printed_at).toLocaleString('th-TH')}` : 'ยังไม่ได้พิมพ์'}
                            >
                              {receipt.printed_at ? 'พิมพ์แล้ว' : 'พิมพ์'}
                            </button>
                            <button
                              className="btn-icon-small btn-danger"
                              onClick={() => handleDelete(receipt.id)}
                            >
                              ลบ
                            </button>
                          </td>
                        </tr>
                                  );
                                })}
                              </React.Fragment>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </React.Fragment>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      )}

      {showFormModal && (
        <ReceiptFormModal
          receiptId={editingReceiptId}
          onClose={() => {
            setShowFormModal(false);
            setEditingReceiptId(null);
          }}
          onSuccess={() => {
            setShowFormModal(false);
            setEditingReceiptId(null);
            fetchReceipts();
          }}
        />
      )}

      {selectedReceiptForPrint && (
        <ReceiptPrintModal
          receiptId={selectedReceiptForPrint}
          onClose={() => setSelectedReceiptForPrint(null)}
          onPrinted={handlePrinted}
        />
      )}
    </div>
  );
}
