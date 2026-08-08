import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import client from "../api/client";
import QuotationFormModal from "../components/QuotationFormModal";
import QuotationPrintModal from "../components/QuotationPrintModal";
import ScheduleDateDialog from "../components/ScheduleDateDialog";
import ClosePaymentDialog from "../components/ClosePaymentDialog";
import DeclineReasonModal from "../components/DeclineReasonModal";
import StatusBadge from "../components/StatusBadge";
import { todayStr } from "../utils/format";
import { buildArchiveGroups, formatDateTh, formatMonthTh, formatYearTh } from "../utils/dateGroups";

export default function QuotationListPage() {
  const { user } = useAuth();
  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [actioningId, setActioningId] = useState(null);
  const [justApprovedId, setJustApprovedId] = useState(null);
  // 'active' = รายการหลัก (ซ่อนใบที่ลูกค้าไม่ได้ทำ), 'declined' = เฉพาะใบที่กด
  // "ลูกค้าไม่ได้ทำ" ไว้ — สองมุมมองของ endpoint /quotations เดียวกัน ไม่ใช่หน้าแยก
  const [viewMode, setViewMode] = useState('active');

  // Modals
  const [showFormModal, setShowFormModal] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [selectedQuotation, setSelectedQuotation] = useState(null);
  const [editingQuotation, setEditingQuotation] = useState(null);
  const [schedulingQuotation, setSchedulingQuotation] = useState(null);
  const [closingQuotation, setClosingQuotation] = useState(null);
  const [decliningQuotation, setDecliningQuotation] = useState(null);

  // Fetch quotations
  const fetchQuotations = async () => {
    try {
      setLoading(true);
      const response = await client.get('/quotations');
      setQuotations(response.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || "เกิดข้อผิดพลาด");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuotations();
  }, []);

  // ใบที่ถูก decline ("ลูกค้าไม่ได้ทำ") ไม่โผล่ในรายการหลักอีกต่อไป — แยกไปดูใน
  // มุมมอง viewMode === 'declined' แทน กันปนกับงานที่ยังทำอยู่จริง
  const declinedCount = useMemo(
    () => quotations.filter((q) => q.status === 'declined').length,
    [quotations]
  );

  // Filter quotations
  const filtered = quotations
    .filter((q) => (viewMode === 'declined' ? q.status === 'declined' : q.status !== 'declined'))
    .filter(q =>
      q.quotation_no.toLowerCase().includes(search.toLowerCase()) ||
      q.customer_name?.toLowerCase().includes(search.toLowerCase())
    );

  // จัดเป็นแฟ้ม ปี → เดือน → วัน (ใหม่สุดอยู่บนสุด) เหมือนหน้าสรุปยอด — ปี/เดือน
  // เก่ากว่าปัจจุบันพับเก็บไว้เป็นค่าเริ่มต้น กันตารางยาวขึ้นเรื่อย ๆ ตามอายุระบบ
  const archive = useMemo(
    () => buildArchiveGroups(
      [...filtered].sort((a, b) => new Date(b.quotation_date) - new Date(a.quotation_date)),
      (q) => q.quotation_date
    ),
    [filtered]
  );

  // แฟ้มที่ "เปิด" อยู่ — ค่าเริ่มต้นคือปี/เดือนล่าสุดที่มีข้อมูลเท่านั้น (รอ archive
  // โหลดมาก่อนถึงจะรู้ว่าปี/เดือนล่าสุดในข้อมูลจริงคือช่วงไหน)
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

  // Quotations scheduled for today, regardless of which day-group they fall
  // under above (a quotation could've been created days ago but scheduled
  // for today) — surfaced as a banner so they can't be missed even if their
  // row is buried further down the list.
  const todayAppointments = useMemo(
    () => quotations.filter((q) => q.status === 'scheduled' && q.scheduled_date === todayStr()),
    [quotations]
  );

  // Handle delete — also callable from inside QuotationFormModal's own
  // "ลบใบเสนอราคา" button (ย้ายมารวมกับปุ่มแก้ไข แทนปุ่มแยกในตาราง), จึงต้องปิด
  // modal แก้ไขให้ด้วยถ้ากำลังเปิดอยู่
  const handleDelete = async (id) => {
    if (window.confirm("คุณต้องการลบใบเสนอราคานี้หรือไม่?")) {
      try {
        await client.delete(`/quotations/${id}`);
        setQuotations((prev) => prev.filter(q => q.id !== id));
        setShowFormModal(false);
        setEditingQuotation(null);
        alert("ลบสำเร็จ");
      } catch (err) {
        alert(err.response?.data?.error || "เกิดข้อผิดพลาด");
      }
    }
  };

  const handleApprove = async (q) => {
    if (!window.confirm(`อนุมัติใบเสนอราคา ${q.quotation_no} และสร้างใบเสร็จอัตโนมัติหรือไม่?`)) return;
    setActioningId(q.id);
    try {
      await client.patch(`/quotations/${q.id}/approve`);
      // Flash the row green so the office can see it flip to "approved" —
      // office stays right here on the quotation list; nobody gets
      // redirected away.
      setQuotations((prev) => prev.map((row) => (row.id === q.id ? { ...row, status: 'approved' } : row)));
      setJustApprovedId(q.id);

      // NOTE: the repair notice is no longer created here — it's created up
      // front the moment the quotation itself is created (see the POST
      // /quotations transaction in the backend), so every quotation already
      // has one waiting to be filled in regardless of approval status.

      setActioningId(null);
    } catch (err) {
      alert(err.response?.data?.error || "อนุมัติไม่สำเร็จ");
      setActioningId(null);
    }
  };

  const handleScheduleConfirm = async (date) => {
    if (!schedulingQuotation) return;
    setActioningId(schedulingQuotation.id);
    try {
      await client.patch(`/quotations/${schedulingQuotation.id}/schedule`, { scheduled_date: date });
      setSchedulingQuotation(null);
      fetchQuotations();
    } catch (err) {
      alert(err.response?.data?.error || "บันทึกวันนัดหมายไม่สำเร็จ");
    } finally {
      setActioningId(null);
    }
  };

  const handleNoDate = async () => {
    if (!schedulingQuotation) return;
    setActioningId(schedulingQuotation.id);
    try {
      await client.patch(`/quotations/${schedulingQuotation.id}/no-date`);
      setSchedulingQuotation(null);
      fetchQuotations();
    } catch (err) {
      alert(err.response?.data?.error || "บันทึกไม่สำเร็จ");
    } finally {
      setActioningId(null);
    }
  };

  const handleDeclineConfirm = async ({ reason, note }) => {
    if (!decliningQuotation) return;
    const q = decliningQuotation;
    setActioningId(q.id);
    try {
      await client.patch(`/quotations/${q.id}/decline`, { reason, note });
      setQuotations((prev) =>
        prev.map((row) =>
          row.id === q.id
            ? { ...row, status: 'declined', scheduled_date: null, decline_reason: reason, decline_note: note || null }
            : row
        )
      );
      setDecliningQuotation(null);
    } catch (err) {
      alert(err.response?.data?.error || "บันทึกไม่สำเร็จ");
    } finally {
      setActioningId(null);
    }
  };

  const handleCloseConfirm = async ({ payment_method, paid_amount }) => {
    if (!closingQuotation) return;
    setActioningId(closingQuotation.id);
    try {
      await client.patch(`/quotations/${closingQuotation.id}/close`, { payment_method, paid_amount });
      setClosingQuotation(null);
      fetchQuotations();
    } catch (err) {
      alert(err.response?.data?.error || "ปิดบิลไม่สำเร็จ");
    } finally {
      setActioningId(null);
    }
  };

  const handleFormSuccess = () => {
    setShowFormModal(false);
    setEditingQuotation(null);
    fetchQuotations();
  };

  const handlePrinted = (quotationId) => {
    setQuotations((prev) =>
      prev.map((q) => (q.id === quotationId ? { ...q, printed_at: new Date().toISOString() } : q))
    );
  };

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <h1>ใบเสนอราคา</h1>
        <div className="quotation-actions">
          <input
            type="text"
            className="search-input"
            placeholder="ค้นหาเลขที่หรือชื่อลูกค้า..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            className="btn btn-primary btn-fab-mobile"
            onClick={() => {
              setEditingQuotation(null);
              setShowFormModal(true);
            }}
          >
            + สร้างใบเสนอราคา
          </button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="quotation-view-tabs">
        <button
          className={`btn-tab ${viewMode === 'active' ? 'btn-tab-active' : ''}`}
          onClick={() => setViewMode('active')}
        >
          รายการหลัก
        </button>
        <button
          className={`btn-tab ${viewMode === 'declined' ? 'btn-tab-active' : ''}`}
          onClick={() => setViewMode('declined')}
        >
          ลูกค้าที่ไม่ได้ทำ{declinedCount > 0 ? ` (${declinedCount})` : ''}
        </button>
      </div>

      {!loading && viewMode === 'active' && todayAppointments.length > 0 && (
        <div className="today-appointment-banner">
          🔔 นัดหมายวันนี้ {todayAppointments.length} รายการ:{' '}
          {todayAppointments.map((q) => `${q.customer_name} (${q.quotation_no})`).join(', ')}
        </div>
      )}

      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-message">ไม่มีข้อมูลใบเสนอราคา</div>
      ) : (
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead>
              <tr>
                <th>เลขที่</th>
                <th>ชื่อลูกค้า</th>
                <th>รุ่น/สี/ทะเบียน</th>
                <th>จำนวนรวม</th>
                <th>สถานะ</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {archive.map((year) => {
                const yearOpen = expandedYears?.has(year.key);
                return (
                  <React.Fragment key={year.key}>
                    <tr className="year-group-header-row clickable-row" onClick={() => toggleYear(year.key)}>
                      <td colSpan={6}>
                        <span className="month-group-toggle">{yearOpen ? '▾' : '▸'}</span>
                        {formatYearTh(year.key)}
                        <span className="date-group-count"> ({year.count} ใบ)</span>
                      </td>
                    </tr>
                    {yearOpen && year.months.map((month) => {
                      const monthOpen = expandedMonths?.has(month.key);
                      return (
                        <React.Fragment key={month.key}>
                          <tr className="month-group-header-row clickable-row" onClick={() => toggleMonth(month.key)}>
                            <td colSpan={6} style={{ paddingLeft: 28 }}>
                              <span className="month-group-toggle">{monthOpen ? '▾' : '▸'}</span>
                              {formatMonthTh(month.key)}
                              <span className="date-group-count"> ({month.count} ใบ)</span>
                            </td>
                          </tr>
                          {monthOpen && month.days.map((day) => (
                            <React.Fragment key={day.key}>
                              <tr className="date-group-header-row">
                                <td colSpan={6}>
                                  {formatDateTh(day.key)}
                                  <span className="date-group-count"> ({day.rows.length} ใบ)</span>
                                </td>
                              </tr>
                              {day.rows.map((q) => (
                    <tr
                      key={q.id}
                      className={
                        justApprovedId === q.id
                          ? 'row-just-approved'
                          : q.status === 'scheduled' && q.scheduled_date === todayStr()
                            ? 'row-scheduled-today'
                            : ''
                      }
                    >
                      <td data-label="เลขที่">
                        <strong>{q.quotation_no}</strong>
                      </td>
                      <td className="col-customer-name" data-label="ชื่อลูกค้า">{q.customer_name}</td>
                      <td className="car-info" data-label="รุ่น/สี/ทะเบียน">
                        {q.brand || q.car_brand} {q.model || q.car_model} / {q.color || q.car_color} /{" "}
                        {q.license_plate}
                      </td>
                      <td className="amount" data-label="จำนวนรวม">
                        ฿{parseFloat(q.total_amount).toFixed(2)}
                      </td>
                      <td data-label="สถานะ">
                        <StatusBadge status={q.status} scheduledDate={q.scheduled_date} closedAt={q.closed_at} />
                        {Number(q.repair_notice_filled) === 1 ? (
                          <span className="status-badge status-badge-success" style={{ marginTop: 4, display: 'inline-block' }}>🔧 แจ้งซ่อมแล้ว</span>
                        ) : (
                          <span className="status-badge status-badge-neutral" style={{ marginTop: 4, display: 'inline-block' }}>🔧 ยังไม่กรอกแจ้งซ่อม</span>
                        )}
                        {q.customer_signature ? (
                          <span className="status-badge status-badge-success" style={{ marginTop: 4, display: 'inline-block' }}>✍️ เซ็นแล้ว</span>
                        ) : (
                          <span className="status-badge status-badge-neutral" style={{ marginTop: 4, display: 'inline-block' }}>✍️ ยังไม่เซ็น</span>
                        )}
                      </td>
                      <td className="actions" data-label="จัดการ">
                        <button
                          className="btn-icon-small"
                          onClick={() => {
                            setEditingQuotation(q);
                            setShowFormModal(true);
                          }}
                        >
                          แก้ไข
                        </button>
                        <button
                          className={`btn-icon-small ${q.printed_at ? 'btn-printed' : ''}`}
                          onClick={() => {
                            setSelectedQuotation(q);
                            setShowPrintModal(true);
                          }}
                          title={q.printed_at ? `พิมพ์แล้วเมื่อ ${new Date(q.printed_at).toLocaleString('th-TH')}` : 'ยังไม่ได้พิมพ์'}
                        >
                          {q.printed_at ? 'พิมพ์แล้ว' : 'พิมพ์'}
                        </button>
                        {q.status !== 'approved' && (
                          <>
                            <button
                              className="btn-icon-small"
                              onClick={() => handleApprove(q)}
                              disabled={actioningId === q.id}
                            >
                              อนุมัติ
                            </button>
                            <button
                              className="btn-icon-small"
                              onClick={() => setSchedulingQuotation(q)}
                              disabled={actioningId === q.id}
                            >
                              วันที่
                            </button>
                            {q.status !== 'declined' && (
                              <button
                                className="btn-icon-small btn-danger"
                                onClick={() => setDecliningQuotation(q)}
                                disabled={actioningId === q.id}
                              >
                                ลูกค้าไม่ได้ทำ
                              </button>
                            )}
                          </>
                        )}
                        {q.status === 'approved' && !q.closed_at && (
                          <button
                            className="btn-icon-small"
                            onClick={() => setClosingQuotation(q)}
                            disabled={actioningId === q.id}
                          >
                            รับชำระ/ปิดบิล
                          </button>
                        )}
                      </td>
                    </tr>
                              ))}
                            </React.Fragment>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {showFormModal && (
        <QuotationFormModal
          quotation={editingQuotation}
          onClose={() => {
            setShowFormModal(false);
            setEditingQuotation(null);
          }}
          onSuccess={handleFormSuccess}
          onDelete={handleDelete}
        />
      )}

      {showPrintModal && selectedQuotation && (
        <QuotationPrintModal
          quotation={selectedQuotation}
          onClose={() => setShowPrintModal(false)}
          onPrinted={handlePrinted}
        />
      )}

      {schedulingQuotation && (
        <ScheduleDateDialog
          initialDate={schedulingQuotation.scheduled_date}
          loading={actioningId === schedulingQuotation.id}
          onConfirm={handleScheduleConfirm}
          onNoDate={handleNoDate}
          onCancel={() => setSchedulingQuotation(null)}
        />
      )}

      {closingQuotation && (
        <ClosePaymentDialog
          quotation={closingQuotation}
          loading={actioningId === closingQuotation.id}
          onConfirm={handleCloseConfirm}
          onCancel={() => setClosingQuotation(null)}
        />
      )}

      {decliningQuotation && (
        <DeclineReasonModal
          quotation={decliningQuotation}
          loading={actioningId === decliningQuotation.id}
          onConfirm={handleDeclineConfirm}
          onCancel={() => setDecliningQuotation(null)}
        />
      )}

    </div>
  );
}
