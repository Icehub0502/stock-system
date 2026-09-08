import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { jobStatusDef } from '../utils/jobStatus';
import { formatMoney, todayStr } from '../utils/format';
import { formatDateTh } from '../utils/dateGroups';

function formatDateShort(dateStr) {
  if (!dateStr) return '-';
  // job_date/expected_pickup_date เป็นคอลัมน์ DATE ล้วน ๆ ("YYYY-MM-DD") ไม่มีเวลา
  // ติดมา — แปลงตรง ๆ ไม่ต้องผ่าน parseDbDateTime (นั่นมีไว้กัน timezone เพี้ยนสำหรับ
  // DATETIME/TIMESTAMP เท่านั้น ใช้กับ DATE ล้วนจะกลายเป็นเที่ยงคืน UTC เลื่อนวันผิด)
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

// วันนี้ผ่านไปแล้วยังไม่ส่ง = เตือนสีแดง (เกินกำหนดที่ตั้งไว้เอง)
function isOverdue(expectedPickupDate) {
  if (!expectedPickupDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = expectedPickupDate.split('-').map(Number);
  return new Date(y, m - 1, d) < today;
}

/**
 * รายละเอียดรถค้างส่งของวันเดียว — เปิดจากแฟ้มวันในหน้า PendingDeliveryPage.jsx
 * มิเรอร์ pattern เดียวกับ DailySummaryDetailModal.jsx (หน้าสรุปยอดขายรายวัน) ทั้ง
 * โครง modal, ปุ่ม export รูปภาพ/Excel และแถบยอดรวมท้ายตาราง — ต่างกันแค่ข้อมูลที่
 * แสดง (jobs ที่ยังไม่ได้ส่งรถ แทนที่จะเป็น receipts) รับ jobs ของวันนั้นมาจาก parent
 * โดยตรง (parent โหลดรถค้างส่งทั้งหมดมาสร้างแฟ้มอยู่แล้ว ไม่ต้องยิง API ซ้ำ) ส่วนการ
 * แก้ไข/บันทึกฟิลด์ยังคงยกให้ parent เป็นเจ้าของ state เดิม (savingId/onLocalChange/
 * onPersist) กันไม่ให้ state ซ้อนกัน 2 ที่
 */
export default function PendingDeliveryDetailModal({ date, jobs, savingId, onLocalChange, onPersist, onClose }) {
  const [exportingImage, setExportingImage] = useState(false);
  const captureRef = useRef(null);

  const handleExportImage = async () => {
    if (!captureRef.current) return;
    setExportingImage(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(captureRef.current, {
        backgroundColor: '#ffffff',
        scale: 2,
        windowWidth: 1400,
        onclone: (clonedDoc) => {
          clonedDoc.querySelectorAll('.pending-delivery-detail-capture-area input[type="date"]').forEach((inp) => {
            const span = clonedDoc.createElement('span');
            span.textContent = inp.value ? formatDateShort(inp.value) : '-';
            const overdue = inp.classList.contains('pending-delivery-date-overdue');
            span.style.cssText = `display:block;padding:2px 0;font-size:0.9rem;${overdue ? 'color:#991b1b;font-weight:700;' : 'color:#1f2937;'}`;
            inp.replaceWith(span);
          });
          clonedDoc.querySelectorAll('.pending-delivery-detail-capture-area input[type="text"]').forEach((inp) => {
            const span = clonedDoc.createElement('span');
            span.textContent = inp.value ? inp.value : '-';
            span.style.cssText = 'display:block;padding:2px 0;color:#1f2937;font-size:0.9rem;';
            inp.replaceWith(span);
          });
        },
      });
      const link = document.createElement('a');
      link.download = `รถค้างส่ง-${date}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Error exporting image:', err);
      alert('บันทึกรูปภาพไม่สำเร็จ');
    } finally {
      setExportingImage(false);
    }
  };

  const handleExportExcel = async () => {
    const XLSX = await import('xlsx');
    const header = ['ลำดับ', 'ชื่อลูกค้า', 'รุ่นรถ', 'ทะเบียนรถ', 'รายการ', 'วันที่รับเข้า', 'กำหนดรับรถ', 'ยอดชำระ', 'สถานะ', 'หมายเหตุ'];
    const rows = jobs.map((j, idx) => [
      idx + 1,
      j.customer_name || '-',
      [j.brand, j.model, j.color].filter(Boolean).join(' ') || '-',
      j.license_plate || '-',
      j.product_summary || j.symptom || '-',
      formatDateShort(j.job_date),
      j.expected_pickup_date ? formatDateShort(j.expected_pickup_date) : '-',
      Number(j.total_amount || 0),
      jobStatusDef(j.status).label,
      j.note || '-',
    ]);
    const totalRow = ['', '', '', '', '', '', 'รวม', jobs.reduce((sum, j) => sum + Number(j.total_amount || 0), 0), '', ''];
    const sheet = XLSX.utils.aoa_to_sheet([header, ...rows, totalRow]);
    sheet['!cols'] = [
      { wch: 6 }, { wch: 20 }, { wch: 18 }, { wch: 12 }, { wch: 40 },
      { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 24 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'รถค้างส่ง');
    XLSX.writeFile(workbook, `รถค้างส่ง-${date}.xlsx`);
  };

  const grandTotal = jobs.reduce((sum, j) => sum + Number(j.total_amount || 0), 0);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card xlarge" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>รถค้างส่งวันที่ {formatDateTh(date)}</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        {jobs.length === 0 ? (
          <div className="empty-message">ไม่มีรถค้างส่งในวันนี้</div>
        ) : (
          <>
            <div className="quotation-actions" style={{ justifyContent: 'flex-end', marginBottom: 12, gap: 8 }}>
              <button className="btn btn-secondary" onClick={handleExportImage} disabled={exportingImage}>
                🖼️ {exportingImage ? 'กำลังบันทึก...' : 'บันทึกเป็นรูปภาพ'}
              </button>
              <button className="btn btn-secondary" onClick={handleExportExcel}>
                📊 บันทึกเป็น Excel
              </button>
            </div>

            <div ref={captureRef} className="pending-delivery-detail-capture-area">
              <div className="daily-summary-capture-title">รถค้างส่งวันที่ {formatDateTh(date)}</div>
              <div className="quotation-table-wrap">
                <table className="quotation-table">
                  <thead>
                    <tr>
                      <th className="col-no">ลำดับ</th>
                      <th>ชื่อลูกค้า</th>
                      <th>รุ่นรถ</th>
                      <th>ทะเบียนรถ</th>
                      <th>รายการ</th>
                      <th>วันที่รับเข้า</th>
                      <th>กำหนดรับรถ</th>
                      <th>ยอดชำระ</th>
                      <th>สถานะ</th>
                      <th>หมายเหตุ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((j, idx) => {
                      const st = jobStatusDef(j.status);
                      const overdue = isOverdue(j.expected_pickup_date);
                      return (
                        <tr key={j.id}>
                          <td className="col-no" data-label="ลำดับ">{idx + 1}</td>
                          <td className="col-customer-name" data-label="ชื่อลูกค้า">
                            <Link to={`/jobs/${j.id}`}>{j.customer_name || '-'}</Link>
                          </td>
                          <td data-label="รุ่นรถ">{j.brand} {j.model} {j.color && `· ${j.color}`}</td>
                          <td data-label="ทะเบียนรถ">{j.license_plate || '-'}</td>
                          <td data-label="รายการ">{j.product_summary || j.symptom || '-'}</td>
                          <td data-label="วันที่รับเข้า">{formatDateShort(j.job_date)}</td>
                          <td data-label="กำหนดรับรถ">
                            <input
                              type="date"
                              value={j.expected_pickup_date || ''}
                              disabled={savingId === j.id}
                              className={overdue ? 'pending-delivery-date-overdue' : ''}
                              onChange={(e) => {
                                const value = e.target.value;
                                onLocalChange(j.id, { expected_pickup_date: value || null });
                                onPersist(j.id, { expected_pickup_date: value || null });
                              }}
                            />
                          </td>
                          <td className="amount" data-label="ยอดชำระ">{j.total_amount != null ? `฿${formatMoney(j.total_amount)}` : '-'}</td>
                          <td data-label="สถานะ">
                            <span className={`status-badge ${st.badge}`}>{st.label}</span>
                          </td>
                          <td data-label="หมายเหตุ">
                            <input
                              type="text"
                              value={j.note || ''}
                              placeholder="เพิ่มหมายเหตุ..."
                              disabled={savingId === j.id}
                              onChange={(e) => onLocalChange(j.id, { note: e.target.value })}
                              onBlur={(e) => onPersist(j.id, { note: e.target.value })}
                            />
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
    </div>
  );
}
