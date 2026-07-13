import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import client from "../api/client";
import ReceiptFormModal from "../components/ReceiptFormModal";
import ReceiptPrintModal from "../components/ReceiptPrintModal";
import SignatureModal from "../components/SignatureModal";

export default function ReceiptListPage() {
  const navigate = useNavigate();
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingReceiptId, setEditingReceiptId] = useState(null);
  const [selectedReceiptForPrint, setSelectedReceiptForPrint] = useState(null);
  const [signingReceiptId, setSigningReceiptId] = useState(null);

  const fetchReceipts = async () => {
    try {
      setLoading(true);
      const response = await client.get('/receipts');
      setReceipts(response.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || 'โหลดบิลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReceipts();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return receipts.filter((r) =>
      r.receipt_no.toLowerCase().includes(q) ||
      r.customer_code?.toLowerCase().includes(q) ||
      r.customer_name?.toLowerCase().includes(q) ||
      `${r.brand || ''} ${r.model || ''} ${r.license_plate || ''}`.toLowerCase().includes(q)
    );
  }, [receipts, search]);

  // Group by receipt_date so moving a bill to another day (from the daily
  // summary page's "ย้ายไปวันถัดไป"/"ย้ายไปวันก่อนหน้า") visibly relocates
  // it here too — the backend already sorts by receipt_date, this just
  // adds the visual date header between groups.
  const groups = useMemo(() => {
    const out = [];
    let current = null;
    for (const r of filtered) {
      const dateKey = r.receipt_date;
      if (!current || current.dateKey !== dateKey) {
        current = { dateKey, rows: [] };
        out.push(current);
      }
      current.rows.push(r);
    }
    return out;
  }, [filtered]);

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

  const handleSaveSignature = async (dataUrl) => {
    await client.patch(`/receipts/${signingReceiptId}/signature`, { signature: dataUrl });
    setReceipts((prev) =>
      prev.map((r) => (r.id === signingReceiptId ? { ...r, has_signature: true } : r))
    );
  };

  const handlePrinted = (receiptId, receiptDate) => {
    setReceipts((prev) =>
      prev.map((r) => (r.id === receiptId ? { ...r, printed_at: new Date().toISOString() } : r))
    );
    setSelectedReceiptForPrint(null);
    if (receiptDate) {
      navigate('/daily-summary', { state: { openDate: receiptDate } });
    }
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
          <button className="btn btn-primary" onClick={() => setShowFormModal(true)}>
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
                <th>วันที่</th>
                <th>รหัสลูกค้า</th>
                <th>ชื่อลูกค้า</th>
                <th>รถ</th>
                <th>จำนวนเงิน</th>
                <th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                let rowNo = 0;
                return groups.map((group) => (
                  <React.Fragment key={group.dateKey}>
                    <tr className="date-group-header-row">
                      <td colSpan={8}>
                        {new Date(group.dateKey).toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                        <span className="date-group-count"> ({group.rows.length} บิล)</span>
                      </td>
                    </tr>
                    {group.rows.map((receipt) => {
                      rowNo += 1;
                      return (
                        <tr key={receipt.id}>
                          <td className="col-no" data-label="ลำดับ">{rowNo}</td>
                          <td data-label="เลขที่บิล"><strong>{receipt.receipt_no}</strong></td>
                          <td data-label="วันที่">{new Date(receipt.receipt_date).toLocaleDateString('th-TH')}</td>
                          <td data-label="รหัสลูกค้า">{receipt.customer_code || '-'}</td>
                          <td className="col-customer-name" data-label="ชื่อลูกค้า">{receipt.customer_name}</td>
                          <td className="car-info" data-label="รถ">{receipt.brand} {receipt.model} / {receipt.license_plate}</td>
                          <td className="amount" data-label="จำนวนเงิน">฿{Number(receipt.total_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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
                              className={`btn-icon-small ${receipt.has_signature ? 'btn-printed' : ''}`}
                              onClick={() => setSigningReceiptId(receipt.id)}
                            >
                              {receipt.has_signature ? '✓ เซ็นแล้ว' : 'เซ็นเอกสาร'}
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
                ));
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

      {signingReceiptId && (
        <SignatureModal
          title="เซ็นชื่อลูกค้า"
          subtitle="ให้ลูกค้าเซ็นชื่อยืนยันในกรอบด้านล่าง"
          onSave={handleSaveSignature}
          onClose={() => setSigningReceiptId(null)}
        />
      )}
    </div>
  );
}
