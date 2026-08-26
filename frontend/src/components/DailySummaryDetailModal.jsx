import React, { useEffect, useRef, useState } from "react";
import client from "../api/client";
import TechnicianMultiSelect from "./TechnicianMultiSelect";

const PAYMENT_METHODS = ['โอน', 'บัตรเครดิต', 'เงินสด', 'QRCode'];
const PAYMENT_METHOD_CLASS = {
  'โอน': 'pay-chip-transfer',
  'บัตรเครดิต': 'pay-chip-credit',
  'เงินสด': 'pay-chip-cash',
  'QRCode': 'pay-chip-qr',
};

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

function addDays(dateStr, amount) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + amount);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function DailySummaryDetailModal({ date, onClose, onReceiptsMoved }) {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [exportingImage, setExportingImage] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [moving, setMoving] = useState(false);
  const captureRef = useRef(null);

  useEffect(() => {
    if (!date) return;
    const fetchDetail = async () => {
      try {
        setLoading(true);
        const response = await client.get('/receipts/by-date', { params: { date } });
        setReceipts(response.data.data || []);
      } catch (err) {
        setError(err.response?.data?.error || 'โหลดรายละเอียดไม่สำเร็จ');
      } finally {
        setLoading(false);
      }
    };
    fetchDetail();
  }, [date]);

  if (!date) return null;

  const updateLocal = (receiptId, changes) => {
    setReceipts((prev) => prev.map((r) => (r.id === receiptId ? { ...r, ...changes } : r)));
  };

  const persistMeta = async (receiptId, changes) => {
    const current = receipts.find((r) => r.id === receiptId) || {};
    setSavingId(receiptId);
    try {
      await client.patch(`/receipts/${receiptId}/meta`, {
        payment_method: current.payment_method || '',
        technician_name: current.technician_name || '',
        remark: current.remark || '',
        total_amount: current.total_amount,
        ...changes,
      });
    } catch (err) {
      alert('บันทึกไม่สำเร็จ: ' + (err.response?.data?.error || err.message));
    } finally {
      setSavingId(null);
    }
  };

  const handlePaymentMethodChange = (receiptId, value) => {
    updateLocal(receiptId, { payment_method: value });
    persistMeta(receiptId, { payment_method: value });
  };

  const handleTechnicianChange = (receiptId, value) => {
    updateLocal(receiptId, { technician_name: value });
    persistMeta(receiptId, { technician_name: value });
  };

  const handleRemarkChange = (receiptId, value) => {
    updateLocal(receiptId, { remark: value });
  };

  const handleRemarkBlur = (receiptId, value) => {
    persistMeta(receiptId, { remark: value });
  };

  const handleAmountChange = (receiptId, value) => {
    updateLocal(receiptId, { total_amount: value });
  };

  const handleAmountBlur = (receiptId, value) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
      alert('จำนวนเงินไม่ถูกต้อง');
      return;
    }
    persistMeta(receiptId, { total_amount: num });
  };

  const toggleSelected = (receiptId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(receiptId)) next.delete(receiptId);
      else next.add(receiptId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => (prev.size === receipts.length ? new Set() : new Set(receipts.map((r) => r.id))));
  };

  const handleDelete = async (receiptId, receiptNo) => {
    if (!window.confirm(`ยืนยันการลบบิล ${receiptNo}? การกระทำนี้ไม่สามารถย้อนกลับได้`)) return;
    try {
      await client.delete(`/receipts/${receiptId}`);
      setReceipts((prev) => prev.filter((r) => r.id !== receiptId));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(receiptId);
        return next;
      });
      if (onReceiptsMoved) onReceiptsMoved();
    } catch (err) {
      alert('ลบบิลไม่สำเร็จ: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleMoveByDays = async (amount) => {
    if (selectedIds.size === 0) return;
    const targetDate = addDays(date, amount);
    if (!window.confirm(`ย้าย ${selectedIds.size} รายการที่เลือกไปวันที่ ${formatDateTh(targetDate)} ใช่หรือไม่?`)) return;

    setMoving(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) => client.patch(`/receipts/${id}/date`, { receipt_date: targetDate }))
      );
      setReceipts((prev) => prev.filter((r) => !selectedIds.has(r.id)));
      setSelectedIds(new Set());
      if (onReceiptsMoved) onReceiptsMoved();
    } catch (err) {
      alert('ย้ายรายการไม่สำเร็จ: ' + (err.response?.data?.error || err.message));
    } finally {
      setMoving(false);
    }
  };

  const handleExportExcel = async () => {
    const XLSX = await import('xlsx');
    const header = ['ลำดับ', 'เลขที่บิล', 'รหัสลูกค้า', 'ชื่อลูกค้า', 'ยี่ห้อ/รุ่นรถ', 'ทะเบียน', 'รายละเอียด', 'ช่องทางการชำระ', 'จำนวนเงิน', 'ช่างซ่อม', 'หมายเหตุ'];
    const rows = receipts.map((r, idx) => [
      idx + 1,
      r.receipt_no,
      r.customer_code || '-',
      r.customer_name,
      [r.brand, r.model].filter(Boolean).join(' ') || '-',
      r.license_plate || '-',
      r.item_summary || '-',
      r.payment_method || '-',
      Number(r.total_amount || 0),
      r.technician_name || '-',
      r.remark || '-',
    ]);
    const totalRow = ['', '', '', '', '', '', '', 'รวม', receipts.reduce((sum, r) => sum + Number(r.total_amount || 0), 0), '', ''];
    const sheet = XLSX.utils.aoa_to_sheet([header, ...rows, totalRow]);
    sheet['!cols'] = [
      { wch: 6 }, { wch: 14 }, { wch: 12 }, { wch: 20 }, { wch: 18 },
      { wch: 12 }, { wch: 40 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 24 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'สรุปยอดรายวัน');
    XLSX.writeFile(workbook, `สรุปยอดขาย-${date}.xlsx`);
  };

  const handleExportImage = async () => {
    if (!captureRef.current) return;
    setExportingImage(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      // Deliberately NOT passing width/height — those were measured on the
      // live element BEFORE onclone swaps the select/input controls for
      // plain text, and the resulting layout height can differ slightly,
      // clipping the bottom of the render. Letting html2canvas measure the
      // (already-modified) cloned node's own scrollHeight itself keeps the
      // two in sync.
      // windowWidth IS forced wide on purpose: it's the viewport size
      // html2canvas uses to evaluate the page's own CSS media queries while
      // rendering the clone, and the table has a max-width:640px breakpoint
      // that reflows it into stacked mobile cards. Without this, exporting
      // from a phone produces that stacked layout instead of the compact
      // desktop-style table everyone expects the saved image to look like.
      const canvas = await html2canvas(captureRef.current, {
        backgroundColor: '#ffffff',
        scale: 2,
        windowWidth: 1400,
        onclone: (clonedDoc) => {
          // html2canvas can't faithfully render native <select>/<input>
          // controls (their text ends up garbled/clipped) — swap them for
          // plain text in the cloned copy it actually rasterizes, so the
          // real interactive fields on screen are left untouched.
          clonedDoc.querySelectorAll('.daily-summary-capture-area select').forEach((sel) => {
            const span = clonedDoc.createElement('span');
            const selectedText = sel.options[sel.selectedIndex]?.text || '';
            span.textContent = selectedText && selectedText !== '-- เลือก --' ? selectedText : '-';
            span.className = sel.className;
            span.style.cssText = 'display:inline-block;padding:2px 8px;font-size:0.9rem;border-radius:4px;';
            sel.replaceWith(span);
          });
          clonedDoc.querySelectorAll('.daily-summary-capture-area .daily-summary-amount-input').forEach((inp) => {
            const span = clonedDoc.createElement('span');
            span.textContent = `฿${formatBaht(inp.value)}`;
            span.style.cssText = 'display:block;padding:2px 0;color:#1f2937;font-size:0.9rem;font-weight:700;';
            // NOT `wrapper?.replaceWith(span) ?? inp.replaceWith(span)` — replaceWith()
            // always returns undefined, so `??` treated that as "missing" and ran
            // BOTH branches every time: span landed in the TD correctly, then got
            // immediately ripped back out and stuffed into the now-detached wrapper
            // div by the second call, leaving it outside the document html2canvas
            // actually rasterizes. That's why the amount column rendered blank.
            const wrapper = inp.closest('.daily-summary-amount-edit');
            if (wrapper) {
              wrapper.replaceWith(span);
            } else {
              inp.replaceWith(span);
            }
          });
          clonedDoc.querySelectorAll('.daily-summary-capture-area .tech-multiselect-trigger').forEach((btn) => {
            const span = clonedDoc.createElement('span');
            span.textContent = btn.textContent && btn.textContent !== 'เลือกช่าง' ? btn.textContent : '-';
            span.style.cssText = 'display:block;padding:2px 0;color:#1f2937;font-size:0.9rem;';
            const wrapper = btn.closest('.tech-multiselect');
            if (wrapper) {
              wrapper.replaceWith(span);
            } else {
              btn.replaceWith(span);
            }
          });
          clonedDoc.querySelectorAll('.daily-summary-capture-area input[type="text"]').forEach((inp) => {
            const span = clonedDoc.createElement('span');
            span.textContent = inp.value ? inp.value : '-';
            span.style.cssText = 'display:block;padding:2px 0;color:#1f2937;font-size:0.9rem;';
            inp.replaceWith(span);
          });
          clonedDoc.querySelectorAll('.daily-summary-capture-area textarea').forEach((ta) => {
            const span = clonedDoc.createElement('span');
            span.textContent = ta.value ? ta.value : '-';
            span.style.cssText = 'display:block;padding:2px 0;color:#1f2937;font-size:0.9rem;white-space:pre-wrap;';
            ta.replaceWith(span);
          });
          // The selection checkboxes and the delete button are UI-only
          // affordances — leave them out of the exported record entirely.
          clonedDoc.querySelectorAll('.daily-summary-capture-area .daily-summary-checkbox-cell, .daily-summary-capture-area .daily-summary-actions-cell').forEach((cell) => {
            cell.remove();
          });
        },
      });
      const link = document.createElement('a');
      link.download = `สรุปยอดขาย-${date}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Error exporting image:', err);
      alert('บันทึกรูปภาพไม่สำเร็จ');
    } finally {
      setExportingImage(false);
    }
  };

  const grandTotal = receipts.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card xlarge" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>รายละเอียดวันที่ {formatDateTh(date)}</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="error-message">{error}</div>}

        {loading ? (
          <div className="loading">กำลังโหลด...</div>
        ) : receipts.length === 0 ? (
          <div className="empty-message">ไม่พบบิลในวันนี้</div>
        ) : (
          <>
            <div className="quotation-actions" style={{ justifyContent: 'space-between', marginBottom: 12, gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label className="daily-summary-select-all-toggle">
                  <input
                    type="checkbox"
                    checked={receipts.length > 0 && selectedIds.size === receipts.length}
                    onChange={toggleSelectAll}
                  />
                  เลือกทั้งหมด
                </label>
                <button
                  className="btn btn-secondary"
                  onClick={() => handleMoveByDays(-1)}
                  disabled={selectedIds.size === 0 || moving}
                >
                  ⬅️ {moving ? 'กำลังย้าย...' : `ย้ายไปวันก่อนหน้า (${selectedIds.size})`}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => handleMoveByDays(1)}
                  disabled={selectedIds.size === 0 || moving}
                >
                  ➡️ {moving ? 'กำลังย้าย...' : `ย้ายไปวันถัดไป (${selectedIds.size})`}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" onClick={handleExportImage} disabled={exportingImage}>
                  🖼️ {exportingImage ? 'กำลังบันทึก...' : 'บันทึกเป็นรูปภาพ'}
                </button>
                <button className="btn btn-secondary" onClick={handleExportExcel}>
                  📊 บันทึกเป็น Excel
                </button>
              </div>
            </div>

            <div ref={captureRef} className="daily-summary-capture-area">
            <div className="daily-summary-capture-title">สรุปยอดขายประจำวันที่ {formatDateTh(date)}</div>
            <div className="quotation-table-wrap">
              <table className="quotation-table">
                <thead>
                  <tr>
                    <th className="col-no daily-summary-checkbox-cell">
                      <input
                        type="checkbox"
                        checked={receipts.length > 0 && selectedIds.size === receipts.length}
                        onChange={toggleSelectAll}
                        title="เลือกทั้งหมด"
                      />
                    </th>
                    <th className="col-no">ลำดับ</th>
                    <th>เลขที่บิล</th>
                    <th>รหัสลูกค้า</th>
                    <th>ชื่อลูกค้า</th>
                    <th>ยี่ห้อ/รุ่นรถ</th>
                    <th>ทะเบียน</th>
                    <th className="daily-summary-detail-col">รายละเอียด</th>
                    <th className="daily-summary-payment-col">ช่องทางการชำระ</th>
                    <th className="col-amount">จำนวนเงิน</th>
                    <th>ช่างซ่อม</th>
                    <th>หมายเหตุ</th>
                    <th className="daily-summary-actions-cell">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((r, idx) => (
                    <tr key={r.id} className={selectedIds.has(r.id) ? 'is-selected-row' : ''}>
                      <td className="col-no daily-summary-checkbox-cell">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(r.id)}
                          onChange={() => toggleSelected(r.id)}
                        />
                      </td>
                      <td className="col-no" data-label="ลำดับ">{idx + 1}</td>
                      <td data-label="เลขที่บิล"><strong>{r.receipt_no}</strong></td>
                      <td data-label="รหัสลูกค้า">{r.customer_code || '-'}</td>
                      <td data-label="ชื่อลูกค้า">{r.customer_name}</td>
                      <td data-label="ยี่ห้อ/รุ่นรถ">{[r.brand, r.model].filter(Boolean).join(' ') || '-'}</td>
                      <td data-label="ทะเบียน">{r.license_plate || '-'}</td>
                      <td className="daily-summary-detail-col" data-label="รายละเอียด">{r.item_summary || '-'}</td>
                      <td className="daily-summary-payment-col" data-label="ช่องทางการชำระ">
                        <select
                          className={`pay-method-select ${PAYMENT_METHOD_CLASS[r.payment_method] || ''}`}
                          value={r.payment_method || ''}
                          disabled={savingId === r.id}
                          onChange={(e) => handlePaymentMethodChange(r.id, e.target.value)}
                        >
                          <option value="">-- เลือก --</option>
                          {PAYMENT_METHODS.map((method) => (
                            <option key={method} value={method}>{method}</option>
                          ))}
                        </select>
                      </td>
                      <td className="amount col-amount" data-label="จำนวนเงิน">
                        <div className="daily-summary-amount-edit">
                          <span>฿</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="daily-summary-amount-input"
                            value={r.total_amount}
                            disabled={savingId === r.id}
                            onChange={(e) => handleAmountChange(r.id, e.target.value)}
                            onBlur={(e) => handleAmountBlur(r.id, e.target.value)}
                          />
                        </div>
                      </td>
                      <td data-label="ช่างซ่อม">
                        <TechnicianMultiSelect
                          value={r.technician_name}
                          disabled={savingId === r.id}
                          onChange={(value) => handleTechnicianChange(r.id, value)}
                        />
                      </td>
                      <td data-label="หมายเหตุ">
                        <textarea
                          className="daily-summary-remark-input"
                          placeholder="เช่น โอน 300 + เงินสด 200"
                          rows={1}
                          value={r.remark || ''}
                          disabled={savingId === r.id}
                          onChange={(e) => handleRemarkChange(r.id, e.target.value)}
                          onBlur={(e) => handleRemarkBlur(r.id, e.target.value)}
                        />
                      </td>
                      <td className="daily-summary-actions-cell" data-label="จัดการ">
                        <button
                          type="button"
                          className="btn-icon-small btn-danger"
                          onClick={() => handleDelete(r.id, r.receipt_no)}
                        >
                          ลบ
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="daily-summary-total-banner">
              <span>ยอดรวมทั้งหมด</span>
              <strong>฿{formatBaht(grandTotal)}</strong>
            </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
