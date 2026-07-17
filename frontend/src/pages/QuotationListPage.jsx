import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import client from "../api/client";
import QuotationFormModal from "../components/QuotationFormModal";
import QuotationPrintModal from "../components/QuotationPrintModal";
import ScheduleDateDialog from "../components/ScheduleDateDialog";
import SignatureModal from "../components/SignatureModal";

function StatusBadge({ status, scheduledDate }) {
  if (status === 'approved') {
    return <span className="status-badge status-badge-success">✅ อนุมัติแล้ว</span>;
  }
  if (status === 'scheduled') {
    const dateText = scheduledDate ? new Date(scheduledDate).toLocaleDateString('th-TH') : '-';
    return <span className="status-badge status-badge-warning">📅 รอทำ {dateText}</span>;
  }
  if (status === 'no_date') {
    return <span className="status-badge status-badge-danger">⚠️ ไม่ระบุวันนัดหมาย</span>;
  }
  return <span className="status-badge status-badge-neutral">⏳ รอดำเนินการ</span>;
}

export default function QuotationListPage() {
  const { user } = useAuth();
  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [actioningId, setActioningId] = useState(null);
  const [justApprovedId, setJustApprovedId] = useState(null);

  // Modals
  const [showFormModal, setShowFormModal] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [selectedQuotation, setSelectedQuotation] = useState(null);
  const [editingQuotation, setEditingQuotation] = useState(null);
  const [schedulingQuotation, setSchedulingQuotation] = useState(null);
  const [signingQuotationId, setSigningQuotationId] = useState(null);

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

  // Filter quotations
  const filtered = quotations.filter(q =>
    q.quotation_no.toLowerCase().includes(search.toLowerCase()) ||
    q.customer_name?.toLowerCase().includes(search.toLowerCase())
  );

  // Group by quotation_date (newest day first) so the list reads as one
  // set per day instead of one long scattered table — sort explicitly by
  // quotation_date rather than relying on the backend's created_at
  // ordering, since a quotation's date isn't guaranteed to match when it
  // was created.
  const groups = useMemo(() => {
    const sorted = [...filtered].sort((a, b) => new Date(b.quotation_date) - new Date(a.quotation_date));
    const out = [];
    let current = null;
    for (const q of sorted) {
      const dateKey = q.quotation_date;
      if (!current || current.dateKey !== dateKey) {
        current = { dateKey, rows: [] };
        out.push(current);
      }
      current.rows.push(q);
    }
    return out;
  }, [filtered]);

  // Handle delete
  const handleDelete = async (id) => {
    if (window.confirm("คุณต้องการลบใบเสนอราคานี้หรือไม่?")) {
      try {
        await client.delete(`/quotations/${id}`);
        setQuotations(quotations.filter(q => q.id !== id));
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

  const handleSaveSignature = async (dataUrl) => {
    await client.patch(`/quotations/${signingQuotationId}/signature`, { signature: dataUrl });
    setQuotations((prev) =>
      prev.map((q) => (q.id === signingQuotationId ? { ...q, customer_signature: dataUrl } : q))
    );
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
            className="btn btn-primary"
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
                <th>วันที่</th>
                <th>ชื่อลูกค้า</th>
                <th>รุ่น/สี/ทะเบียน</th>
                <th>จำนวนรวม</th>
                <th>สถานะ</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <React.Fragment key={group.dateKey}>
                  <tr className="date-group-header-row">
                    <td colSpan={7}>
                      {new Date(group.dateKey).toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                      <span className="date-group-count"> ({group.rows.length} ใบ)</span>
                    </td>
                  </tr>
                  {group.rows.map((q) => (
                    <tr key={q.id} className={justApprovedId === q.id ? 'row-just-approved' : ''}>
                      <td data-label="เลขที่">
                        <strong>{q.quotation_no}</strong>
                      </td>
                      <td data-label="วันที่">{new Date(q.quotation_date).toLocaleDateString('th-TH')}</td>
                      <td className="col-customer-name" data-label="ชื่อลูกค้า">{q.customer_name}</td>
                      <td className="car-info" data-label="รุ่น/สี/ทะเบียน">
                        {q.brand || q.car_brand} {q.model || q.car_model} / {q.color || q.car_color} /{" "}
                        {q.license_plate}
                      </td>
                      <td className="amount" data-label="จำนวนรวม">
                        ฿{parseFloat(q.total_amount).toFixed(2)}
                      </td>
                      <td data-label="สถานะ">
                        <StatusBadge status={q.status} scheduledDate={q.scheduled_date} />
                        {Number(q.repair_notice_filled) === 1 ? (
                          <span className="status-badge status-badge-success" style={{ marginTop: 4, display: 'inline-block' }}>🔧 แจ้งซ่อมแล้ว</span>
                        ) : (
                          <span className="status-badge status-badge-neutral" style={{ marginTop: 4, display: 'inline-block' }}>🔧 ยังไม่กรอกแจ้งซ่อม</span>
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
                        <button
                          className={`btn-icon-small ${q.customer_signature ? 'btn-printed' : ''}`}
                          onClick={() => setSigningQuotationId(q.id)}
                        >
                          {q.customer_signature ? '✓ เซ็นแล้ว' : 'เซ็นเอกสาร'}
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
                          </>
                        )}
                        <button
                          className="btn-icon-small btn-danger"
                          onClick={() => handleDelete(q.id)}
                        >
                          ลบ
                        </button>
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
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

      {signingQuotationId && (
        <SignatureModal
          title="เซ็นชื่อลูกค้า"
          subtitle="ให้ลูกค้าเซ็นชื่อยืนยันในกรอบด้านล่าง"
          onSave={handleSaveSignature}
          onClose={() => setSigningQuotationId(null)}
        />
      )}

    </div>
  );
}
