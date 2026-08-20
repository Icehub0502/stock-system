import React, { useState, useEffect, useMemo, useRef } from "react";
import client from "../api/client";
import QuotationFormModal from "../components/QuotationFormModal";
import QuotationPrintModal from "../components/QuotationPrintModal";
import ScheduleDateDialog from "../components/ScheduleDateDialog";
import StatusBadge from "../components/StatusBadge";
import { todayStr } from "../utils/format";
import useRealtimeEvent from "../hooks/useRealtimeEvent";

// รวมใบเสนอราคาที่ยังไม่อนุมัติและอยู่ในสถานะ "นัดหมาย" ไว้หน้าเดียว แยกเป็น 2
// กลุ่มชัดเจน: มีวันนัดแล้ว (status='scheduled') กับยังไม่ได้ระบุวันนัด
// (status='no_date') — ใช้ endpoint/คอมโพเนนต์เดียวกับ QuotationListPage
// (โมดัลแก้ไข/ตั้งวันนัด) ไม่สร้างซ้ำ ต่างกันแค่ตัวกรอง+การจัดกลุ่ม
export default function AppointmentsPage() {
  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actioningId, setActioningId] = useState(null);

  const [showFormModal, setShowFormModal] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [selectedQuotation, setSelectedQuotation] = useState(null);
  const [editingQuotation, setEditingQuotation] = useState(null);
  const [schedulingQuotation, setSchedulingQuotation] = useState(null);

  const fetchQuotations = async ({ silent } = {}) => {
    try {
      if (!silent) setLoading(true);
      const response = await client.get('/quotations');
      setQuotations(response.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || "เกิดข้อผิดพลาด");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuotations();
  }, []);

  // Realtime: same pattern as QuotationListPage — refresh in the background,
  // deferring while a row-level action is in flight or the form modal is
  // open so we never clobber unsaved input, catching up once the guard clears.
  const pendingRefreshRef = useRef(false);
  useRealtimeEvent(
    ['quotation:created', 'quotation:updated', 'quotation:deleted'],
    () => {
      if (actioningId !== null || showFormModal) {
        pendingRefreshRef.current = true;
        return;
      }
      fetchQuotations({ silent: true });
    }
  );

  useEffect(() => {
    if (actioningId === null && !showFormModal && pendingRefreshRef.current) {
      pendingRefreshRef.current = false;
      fetchQuotations({ silent: true });
    }
  }, [showFormModal, actioningId]);

  // ปิดบิล/อนุมัติไปแล้วไม่ใช่ "รอนัดหมาย" อีกต่อไป — กรองเฉพาะที่ยังค้างจริง ๆ
  const openAppointments = useMemo(
    () => quotations.filter((q) => !q.closed_at && (q.status === 'scheduled' || q.status === 'no_date')),
    [quotations]
  );

  const scheduled = useMemo(
    () =>
      openAppointments
        .filter((q) => q.status === 'scheduled')
        .sort((a, b) => new Date(a.scheduled_date) - new Date(b.scheduled_date)),
    [openAppointments]
  );

  const noDate = useMemo(
    () => openAppointments.filter((q) => q.status === 'no_date'),
    [openAppointments]
  );

  const handleDelete = async (id) => {
    if (window.confirm("คุณต้องการลบใบเสนอราคานี้หรือไม่?")) {
      try {
        await client.delete(`/quotations/${id}`);
        setQuotations((prev) => prev.filter((q) => q.id !== id));
        setShowFormModal(false);
        setEditingQuotation(null);
        alert("ลบสำเร็จ");
      } catch (err) {
        alert(err.response?.data?.error || "เกิดข้อผิดพลาด");
      }
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

  const renderTable = (rows) => (
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
          {rows.map((q) => (
            <tr key={q.id} className={q.status === 'scheduled' && q.scheduled_date === todayStr() ? 'row-scheduled-today' : ''}>
              <td data-label="เลขที่"><strong>{q.quotation_no}</strong></td>
              <td className="col-customer-name" data-label="ชื่อลูกค้า">{q.customer_name}</td>
              <td className="car-info" data-label="รุ่น/สี/ทะเบียน">
                {q.brand || q.car_brand} {q.model || q.car_model} / {q.color || q.car_color} / {q.license_plate}
              </td>
              <td className="amount" data-label="จำนวนรวม">฿{parseFloat(q.total_amount).toFixed(2)}</td>
              <td data-label="สถานะ">
                <StatusBadge status={q.status} scheduledDate={q.scheduled_date} closedAt={q.closed_at} />
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
                <button
                  className="btn-icon-small"
                  onClick={() => setSchedulingQuotation(q)}
                  disabled={actioningId === q.id}
                >
                  วันที่
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <h1>ลูกค้าที่นัดหมาย</h1>
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : (
        <>
          <h2 className="appointments-section-title">📅 มีวันนัดหมาย ({scheduled.length})</h2>
          {scheduled.length === 0 ? (
            <div className="empty-message">ไม่มีลูกค้าที่นัดหมายไว้</div>
          ) : (
            renderTable(scheduled)
          )}

          <h2 className="appointments-section-title">⚠️ ยังไม่ระบุวันนัดหมาย ({noDate.length})</h2>
          {noDate.length === 0 ? (
            <div className="empty-message">ไม่มีรายการที่ยังไม่ระบุวันนัดหมาย</div>
          ) : (
            renderTable(noDate)
          )}
        </>
      )}

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
    </div>
  );
}
