import React, { useCallback, useEffect, useRef, useState } from "react";
import client from "../api/client";
import TechnicianMultiSelect from "./TechnicianMultiSelect";
import PaymentBreakdown from "./PaymentBreakdown";
import PaymentSplitEditor, { initialSelection, selectionToPayload, formatMoney } from "./PaymentSplitEditor";
import { PAYMENT_METHOD_CLASS, summarizeByMethod } from "../utils/paymentMethods";

function formatDateTh(dateStr) {
  const d = new Date(dateStr);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear() + 543;
  return `${dd}/${mm}/${yyyy}`;
}

function addDays(dateStr, amount) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + amount);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ช่องทางชำระของบิลหนึ่งใบ → รายการป้ายสี (แบ่งหลายช่องทางแสดงยอดแต่ละช่อง)
function paymentChips(r) {
  if (Array.isArray(r.payments) && r.payments.length > 0) {
    return r.payments.map((p) => ({ key: p.method, label: p.method, amount: p.amount }));
  }
  if (r.payment_method) return [{ key: r.payment_method, label: r.payment_method, amount: null }];
  return [];
}

export default function DailySummaryDetailModal({ date, onClose, onReceiptsMoved }) {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [exportingImage, setExportingImage] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [moving, setMoving] = useState(false);
  // บิลที่กำลังแก้ช่องทางชำระ + ค่าที่เลือกในหน้าต่างแก้ไข
  const [payEditing, setPayEditing] = useState(null);
  const [paySelection, setPaySelection] = useState({});
  const [payError, setPayError] = useState("");
  const captureRef = useRef(null);

  const fetchDetail = useCallback(async () => {
    try {
      setLoading(true);
      const response = await client.get('/receipts/by-date', { params: { date } });
      setReceipts(response.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || 'โหลดรายละเอียดไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    if (date) fetchDetail();
  }, [date, fetchDetail]);

  if (!date) return null;

  const updateLocal = (receiptId, changes) => {
    setReceipts((prev) => prev.map((r) => (r.id === receiptId ? { ...r, ...changes } : r)));
  };

  // คืน true ถ้าบันทึกสำเร็จ — ถ้าเซิร์ฟเวอร์ปฏิเสธ (เช่น ยอดไม่ตรงการแบ่งช่องทาง) โหลดค่าจริงกลับมาแสดง
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
      return true;
    } catch (err) {
      alert('บันทึกไม่สำเร็จ: ' + (err.response?.data?.error || err.message));
      fetchDetail();
      return false;
    } finally {
      setSavingId(null);
    }
  };

  const openPaymentEditor = (r) => {
    setPayEditing(r);
    setPaySelection(initialSelection(r.payments, r.payment_method));
    setPayError("");
  };

  const handlePaymentSave = async () => {
    const payload = selectionToPayload(paySelection, payEditing.total_amount);
    if (payload.error) {
      setPayError(payload.error);
      return;
    }
    const receiptId = payEditing.id;
    // payment_method ที่ส่งไปเป็นชื่อช่องทางเดียว (หรือว่าง) — กรณีแบ่งหลายช่อง backend สร้างข้อความสรุปให้เอง
    const ok = await persistMeta(receiptId, payload);
    if (ok) {
      const splits = payload.payment_splits;
      updateLocal(receiptId, {
        payment_method: splits.length >= 2
          ? splits.map((s) => `${s.method} ${s.amount}`).join(' + ')
          : payload.payment_method,
        payments: splits,
      });
      setPayEditing(null);
      if (onReceiptsMoved) onReceiptsMoved();
    }
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

  const handleAmountBlur = async (receiptId, value) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
      alert('จำนวนเงินไม่ถูกต้อง');
      return;
    }
    const ok = await persistMeta(receiptId, { total_amount: num });
    if (ok && onReceiptsMoved) onReceiptsMoved();
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
      { wch: 12 }, { wch: 40 }, { wch: 28 }, { wch: 14 }, { wch: 16 }, { wch: 24 },
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
      // live element BEFORE onclone swaps the input controls for plain text,
      // and the resulting layout height can differ slightly, clipping the
      // bottom of the render. Letting html2canvas measure the (already-
      // modified) cloned node's own scrollHeight itself keeps the two in sync.
      // windowWidth IS forced wide on purpose: it's the viewport size
      // html2canvas uses to evaluate the page's own CSS media queries while
      // rendering the clone, and the table has a narrow-screen breakpoint
      // that reflows it into stacked cards. Without this, exporting from a
      // phone produces that stacked layout instead of the table everyone
      // expects the saved image to look like.
      const canvas = await html2canvas(captureRef.current, {
        backgroundColor: '#ffffff',
        scale: 2,
        windowWidth: 1500,
        onclone: (clonedDoc) => {
          // html2canvas can't faithfully render native <input>/<textarea>
          // controls (their text ends up garbled/clipped) — swap them for
          // plain text in the cloned copy it actually rasterizes, so the
          // real interactive fields on screen are left untouched.
          clonedDoc.querySelectorAll('.daily-summary-capture-area .daily-summary-amount-input').forEach((inp) => {
            const span = clonedDoc.createElement('span');
            span.textContent = `฿${formatMoney(inp.value)}`;
            span.style.cssText = 'display:block;padding:2px 0;color:#1f2937;font-size:0.95rem;font-weight:700;text-align:right;';
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
          clonedDoc.querySelectorAll('.daily-summary-capture-area textarea').forEach((ta) => {
            const span = clonedDoc.createElement('span');
            span.textContent = ta.value ? ta.value : '-';
            span.style.cssText = 'display:block;padding:2px 0;color:#1f2937;font-size:0.9rem;white-space:pre-wrap;';
            ta.replaceWith(span);
          });
          // The selection checkboxes, edit hints and delete button are UI-only
          // affordances — leave them out of the exported record entirely.
          clonedDoc.querySelectorAll('.daily-summary-capture-area .daily-summary-checkbox-cell, .daily-summary-capture-area .daily-summary-actions-cell, .daily-summary-capture-area .ds-edit-hint').forEach((cell) => {
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
  const customerCount = new Set(receipts.map((r) => r.customer_code || r.customer_name)).size;
  const allSelected = receipts.length > 0 && selectedIds.size === receipts.length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card xlarge ds-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ds-header">
          <div>
            <h2>สรุปยอดขายประจำวันที่ {formatDateTh(date)}</h2>
            <p className="ds-sub">แตะช่องทางชำระเพื่อเปลี่ยน/แบ่งจ่ายหลายช่องทาง · แก้ยอด ช่าง หมายเหตุ ได้ตรงในตาราง</p>
          </div>
          <button className="btn-close" onClick={onClose} aria-label="ปิด">✕</button>
        </div>

        {error && <div className="error-message">{error}</div>}

        {loading ? (
          <div className="loading">กำลังโหลด...</div>
        ) : receipts.length === 0 ? (
          <div className="empty-message">ไม่พบบิลในวันนี้</div>
        ) : (
          <>
            <div className="ds-toolbar">
              <div className="ds-toolbar-group">
                <label className="daily-summary-select-all-toggle">
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
                  เลือกทั้งหมด
                </label>
                {selectedIds.size > 0 && (
                  <>
                    <span className="ds-selected-count">เลือกแล้ว {selectedIds.size} รายการ</span>
                    <button className="btn btn-secondary" onClick={() => handleMoveByDays(-1)} disabled={moving}>
                      ⬅️ ย้ายไปวันก่อนหน้า
                    </button>
                    <button className="btn btn-primary" onClick={() => handleMoveByDays(1)} disabled={moving}>
                      {moving ? 'กำลังย้าย...' : 'ย้ายไปวันถัดไป ➡️'}
                    </button>
                  </>
                )}
              </div>
              <div className="ds-toolbar-group">
                <button className="btn btn-secondary" onClick={handleExportImage} disabled={exportingImage}>
                  🖼️ {exportingImage ? 'กำลังบันทึก...' : 'บันทึกเป็นรูปภาพ'}
                </button>
                <button className="btn btn-secondary" onClick={handleExportExcel}>
                  📊 Excel
                </button>
              </div>
            </div>

            <div ref={captureRef} className="daily-summary-capture-area ds-capture">
              <div className="daily-summary-capture-title">สรุปยอดขายประจำวันที่ {formatDateTh(date)}</div>

              <div className="ds-stats">
                <div className="ds-stat">
                  <span>จำนวนบิล</span>
                  <strong>{receipts.length.toLocaleString('en-US')}</strong>
                </div>
                <div className="ds-stat">
                  <span>ลูกค้า</span>
                  <strong>{customerCount.toLocaleString('en-US')}</strong>
                </div>
                <div className="ds-stat ds-stat-total">
                  <span>ยอดรวมทั้งหมด</span>
                  <strong>฿{formatMoney(grandTotal)}</strong>
                </div>
              </div>

              <PaymentBreakdown title="ยอดแยกตามช่องทางชำระ" items={summarizeByMethod(receipts)} />

              <div className="ds-table-wrap">
                <table className="ds-table">
                  <thead>
                    <tr>
                      <th className="daily-summary-checkbox-cell ds-col-check">
                        <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} title="เลือกทั้งหมด" />
                      </th>
                      <th className="ds-col-no">#</th>
                      <th>บิล</th>
                      <th>ลูกค้า</th>
                      <th>รถ</th>
                      <th className="ds-col-detail">รายละเอียด</th>
                      <th className="ds-col-pay">ช่องทางชำระ</th>
                      <th className="ds-col-amount">จำนวนเงิน</th>
                      <th className="ds-col-tech">ช่างซ่อม</th>
                      <th className="ds-col-remark">หมายเหตุ</th>
                      <th className="daily-summary-actions-cell ds-col-actions"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.map((r, idx) => {
                      const chips = paymentChips(r);
                      return (
                        <tr key={r.id} className={selectedIds.has(r.id) ? 'is-selected-row' : ''}>
                          <td className="daily-summary-checkbox-cell ds-col-check">
                            <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelected(r.id)} />
                          </td>
                          <td className="ds-col-no" data-label="ลำดับ">{idx + 1}</td>
                          <td data-label="บิล">
                            <div className="ds-main">{r.receipt_no}</div>
                            <div className="ds-subtext">คันที่ {r.car_sequence_no ?? '-'}</div>
                          </td>
                          <td data-label="ลูกค้า">
                            <div className="ds-main">{r.customer_name}</div>
                            <div className="ds-subtext">{r.customer_code || '-'}</div>
                          </td>
                          <td data-label="รถ">
                            <div className="ds-main">{[r.brand, r.model].filter(Boolean).join(' ') || '-'}</div>
                            <div className="ds-subtext">{r.license_plate || '-'}</div>
                          </td>
                          <td className="ds-col-detail" data-label="รายละเอียด">
                            <div className="ds-detail-text">{r.item_summary || '-'}</div>
                          </td>
                          <td className="ds-col-pay" data-label="ช่องทางชำระ">
                            <button
                              type="button"
                              className="ds-pay-btn"
                              onClick={() => openPaymentEditor(r)}
                              disabled={savingId === r.id}
                              title="แก้ไขช่องทางชำระ"
                            >
                              {chips.length === 0 ? (
                                <span className="ds-pay-empty">+ เลือกช่องทาง</span>
                              ) : (
                                chips.map((c) => (
                                  <span key={c.key} className={`ds-pay-chip ${PAYMENT_METHOD_CLASS[c.label] || 'pay-chip-other'}`}>
                                    {c.label}
                                    {c.amount != null && <em>฿{formatMoney(c.amount)}</em>}
                                  </span>
                                ))
                              )}
                              <span className="ds-edit-hint" aria-hidden="true">✎</span>
                            </button>
                          </td>
                          <td className="ds-col-amount" data-label="จำนวนเงิน">
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
                          <td className="ds-col-tech" data-label="ช่างซ่อม">
                            <TechnicianMultiSelect
                              value={r.technician_name}
                              disabled={savingId === r.id}
                              onChange={(value) => handleTechnicianChange(r.id, value)}
                            />
                          </td>
                          <td className="ds-col-remark" data-label="หมายเหตุ">
                            <textarea
                              className="daily-summary-remark-input"
                              placeholder="หมายเหตุ"
                              rows={2}
                              value={r.remark || ''}
                              disabled={savingId === r.id}
                              onChange={(e) => handleRemarkChange(r.id, e.target.value)}
                              onBlur={(e) => handleRemarkBlur(r.id, e.target.value)}
                            />
                          </td>
                          <td className="daily-summary-actions-cell ds-col-actions" data-label="">
                            <button
                              type="button"
                              className="ds-delete-btn"
                              onClick={() => handleDelete(r.id, r.receipt_no)}
                              title="ลบบิล"
                            >
                              ลบ
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="daily-summary-total-banner">
                <span>ยอดรวมทั้งหมด</span>
                <strong>฿{formatMoney(grandTotal)}</strong>
              </div>
            </div>
          </>
        )}
      </div>

      {payEditing && (
        <div
          className="modal-backdrop ds-pay-backdrop"
          onClick={(e) => { e.stopPropagation(); setPayEditing(null); }}
        >
          <div className="modal-card ds-pay-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ds-header">
              <div>
                <h3>ช่องทางชำระ — {payEditing.receipt_no}</h3>
                <p className="ds-sub">{payEditing.customer_name} · ยอดบิล ฿{formatMoney(payEditing.total_amount)}</p>
              </div>
              <button className="btn-close" onClick={() => setPayEditing(null)} aria-label="ปิด">✕</button>
            </div>
            <PaymentSplitEditor
              selection={paySelection}
              onChange={(next) => { setPaySelection(next); setPayError(""); }}
              total={Number(payEditing.total_amount) || 0}
            />
            {payError && <p className="error-text">{payError}</p>}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setPayEditing(null)}>ยกเลิก</button>
              <button type="button" className="btn btn-primary" onClick={handlePaymentSave} disabled={savingId === payEditing.id}>
                บันทึก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
