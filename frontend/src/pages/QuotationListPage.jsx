import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import client from "../api/client";
import QuotationFormModal from "../components/QuotationFormModal";
import QuotationPrintModal from "../components/QuotationPrintModal";
import ScheduleDateDialog from "../components/ScheduleDateDialog";

function StatusBadge({ status, scheduledDate }) {
  if (status === 'approved') {
    return <span className="status-badge status-badge-success">✅ อนุมัติแล้ว</span>;
  }
  if (status === 'scheduled') {
    const dateText = scheduledDate ? new Date(scheduledDate).toLocaleDateString('th-TH') : '-';
    return <span className="status-badge status-badge-warning">📅 รอทำ {dateText}</span>;
  }
  return <span className="status-badge status-badge-neutral">⏳ รอดำเนินการ</span>;
}

export default function QuotationListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
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
      // Flash the row green so the office can see it flip to "approved"
      // before we jump them to the receipt list to finish the paperwork.
      setQuotations((prev) => prev.map((row) => (row.id === q.id ? { ...row, status: 'approved' } : row)));
      setJustApprovedId(q.id);
      setTimeout(() => navigate('/receipt-list'), 700);
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

  const handleFormSuccess = () => {
    setShowFormModal(false);
    setEditingQuotation(null);
    fetchQuotations();
  };

  return (
    <div className="quotation-page quotation-page--blue">
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
              {filtered.map((q) => (
                <tr key={q.id} className={justApprovedId === q.id ? 'row-just-approved' : ''}>
                  <td data-label="เลขที่">
                    <strong>{q.quotation_no}</strong>
                  </td>
                  <td data-label="วันที่">{new Date(q.quotation_date).toLocaleDateString('th-TH')}</td>
                  <td data-label="ชื่อลูกค้า">{q.customer_name}</td>
                  <td className="car-info" data-label="รุ่น/สี/ทะเบียน">
                    {q.brand || q.car_brand} {q.model || q.car_model} / {q.color || q.car_color} /{" "}
                    {q.license_plate}
                  </td>
                  <td className="amount" data-label="จำนวนรวม">
                    ฿{parseFloat(q.total_amount).toFixed(2)}
                  </td>
                  <td data-label="สถานะ">
                    <StatusBadge status={q.status} scheduledDate={q.scheduled_date} />
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
                      className="btn-icon-small"
                      onClick={() => {
                        setSelectedQuotation(q);
                        setShowPrintModal(true);
                      }}
                    >
                      พิมพ์
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
        />
      )}

      {schedulingQuotation && (
        <ScheduleDateDialog
          initialDate={schedulingQuotation.scheduled_date}
          loading={actioningId === schedulingQuotation.id}
          onConfirm={handleScheduleConfirm}
          onCancel={() => setSchedulingQuotation(null)}
        />
      )}

    </div>
  );
}
