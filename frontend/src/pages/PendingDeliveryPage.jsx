import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { jobStatusDef } from '../utils/jobStatus';
import { formatMoney, todayStr } from '../utils/format';
import { buildArchiveGroups, formatDateTh, formatMonthTh, formatYearTh } from '../utils/dateGroups';
import useRealtimeEvent from '../hooks/useRealtimeEvent';

function formatDateShort(dateStr) {
  if (!dateStr) return '-';
  // job_date/expected_pickup_date เป็นคอลัมน์ DATE ล้วน ๆ ("YYYY-MM-DD") ไม่มีเวลา
  // ติดมา — แปลงตรง ๆ ไม่ต้องผ่าน parseDbDateTime (นั่นมีไว้กัน timezone เพี้ยนสำหรับ
  // DATETIME/TIMESTAMP เท่านั้น ใช้กับ DATE ล้วนจะกลายเป็นเที่ยงคืน UTC เลื่อนวันผิด)
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

// วันนี้ผ่านไปแล้วยังไม่ส่ง = เตือนสีแดง (เกินกำหนดที่ตั้งไว้เอง) — ช่วยให้พนักงานเห็น
// ปุ๊บรู้ปั๊บว่าคันไหนต้องรีบตามลูกค้า ไม่ต้องนั่งไล่เทียบวันที่เอง
function isOverdue(expectedPickupDate) {
  if (!expectedPickupDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = expectedPickupDate.split('-').map(Number);
  return new Date(y, m - 1, d) < today;
}

/**
 * รถที่ยังไม่ได้ส่งรถ — อ้างอิงเฉพาะงานที่ผ่านขั้น "อนุมัติ" แล้วเท่านั้น (เจ้าของร้าน
 * สั่งแก้ — เดิมรวมรถที่ยังไม่ได้ตัดสินใจ/เสนอราคาด้วย ไม่ตรงตามที่ต้องการ) มองข้าม
 * วัน ต่างจากหน้ารายการงานวันนี้ (JobBoardPage) ที่กรองแค่วันเดียว — จัดกลุ่มเป็นแฟ้ม
 * ปี → เดือน → วัน เหมือนหน้าใบเสร็จ/ใบเสนอราคา (ดู dateGroups.js) แยกให้เห็นชัดว่า
 * วันไหนมีรถค้างกี่คัน แทนที่จะเป็นตารางยาวก้อนเดียวปนกันหมด
 */
export default function PendingDeliveryPage() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [exportingImage, setExportingImage] = useState(false);
  const captureRef = useRef(null);

  const load = useCallback(async ({ silent } = {}) => {
    try {
      if (!silent) setLoading(true);
      const res = await client.get('/jobs/pending-delivery');
      setJobs(res.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || 'โหลดรายการไม่สำเร็จ');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useRealtimeEvent(
    ['job:created', 'job:updated', 'job:status-changed', 'job:quotation-linked', 'job:deleted'],
    () => load({ silent: true })
  );

  const archive = useMemo(() => buildArchiveGroups(jobs, (j) => j.job_date), [jobs]);

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
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleMonth = (key) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const updateLocal = (jobId, changes) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, ...changes } : j)));
  };

  const persistField = async (jobId, changes) => {
    setSavingId(jobId);
    try {
      await client.patch(`/jobs/${jobId}`, changes);
    } catch (err) {
      alert(err.response?.data?.error || 'บันทึกไม่สำเร็จ');
      await load({ silent: true });
    } finally {
      setSavingId(null);
    }
  };

  // มิเรอร์ handleExportImage ของ DailySummaryDetailModal.jsx (หน้าสรุปยอดขายรายวัน)
  // ทุกประการ — html2canvas วาด <input>/<select> เพี้ยน ต้องสลับเป็น <span> ข้อความ
  // ล้วนในสำเนาที่ครอปก่อนเสมอ ของจริงบนหน้าจอไม่โดนแตะ — จะได้ภาพเฉพาะปี/เดือนที่เปิด
  // ดูอยู่ตอนนั้น (พับ/กางเองก่อนกดบันทึกได้)
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
          clonedDoc.querySelectorAll('.pending-delivery-capture-area input[type="date"]').forEach((inp) => {
            const span = clonedDoc.createElement('span');
            span.textContent = inp.value ? formatDateShort(inp.value) : '-';
            const overdue = inp.classList.contains('pending-delivery-date-overdue');
            span.style.cssText = `display:block;padding:2px 0;font-size:0.9rem;${overdue ? 'color:#991b1b;font-weight:700;' : 'color:#1f2937;'}`;
            inp.replaceWith(span);
          });
          clonedDoc.querySelectorAll('.pending-delivery-capture-area input[type="text"]').forEach((inp) => {
            const span = clonedDoc.createElement('span');
            span.textContent = inp.value ? inp.value : '-';
            span.style.cssText = 'display:block;padding:2px 0;color:#1f2937;font-size:0.9rem;';
            inp.replaceWith(span);
          });
        },
      });
      const link = document.createElement('a');
      link.download = `รถค้างส่ง-${todayStr()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Error exporting image:', err);
      alert('บันทึกรูปภาพไม่สำเร็จ');
    } finally {
      setExportingImage(false);
    }
  };

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <h1>รถที่ยังไม่ได้ส่งรถ</h1>
        {jobs.length > 0 && (
          <button className="btn btn-secondary" onClick={handleExportImage} disabled={exportingImage}>
            🖼️ {exportingImage ? 'กำลังบันทึก...' : 'บันทึกเป็นรูปภาพ'}
          </button>
        )}
      </div>
      <p className="sec-intro" style={{ color: '#6b7280', marginTop: -8, marginBottom: 16 }}>
        รวมเฉพาะรถที่อนุมัติใบเสนอราคาแล้ว จัดเป็นแฟ้มรายวัน — วันไหนที่ทุกคันส่งครบแล้วจะไม่ขึ้นในนี้อีก
      </p>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : jobs.length === 0 ? (
        <div className="empty-message">ไม่มีรถค้างส่งตอนนี้</div>
      ) : (
        <div className="quotation-table-wrap pending-delivery-capture-area" ref={captureRef}>
          <table className="quotation-table">
            <thead>
              <tr>
                <th>ลำดับ</th>
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
              {(() => {
                let rowNo = 0;
                return archive.map((year) => {
                  const yearOpen = expandedYears?.has(year.key);
                  return (
                    <React.Fragment key={year.key}>
                      <tr className="year-group-header-row clickable-row" onClick={() => toggleYear(year.key)}>
                        <td colSpan={10}>
                          <span className="month-group-toggle">{yearOpen ? '▾' : '▸'}</span>
                          {formatYearTh(year.key)}
                          <span className="date-group-count"> ({year.count} คัน)</span>
                        </td>
                      </tr>
                      {yearOpen && year.months.map((month) => {
                        const monthOpen = expandedMonths?.has(month.key);
                        return (
                          <React.Fragment key={month.key}>
                            <tr className="month-group-header-row clickable-row" onClick={() => toggleMonth(month.key)}>
                              <td colSpan={10} style={{ paddingLeft: 28 }}>
                                <span className="month-group-toggle">{monthOpen ? '▾' : '▸'}</span>
                                {formatMonthTh(month.key)}
                                <span className="date-group-count"> ({month.count} คัน)</span>
                              </td>
                            </tr>
                            {monthOpen && month.days.map((day) => (
                              <React.Fragment key={day.key}>
                                <tr className="date-group-header-row">
                                  <td colSpan={10}>
                                    {formatDateTh(day.key)}
                                    <span className="date-group-count"> ({day.rows.length} คัน)</span>
                                  </td>
                                </tr>
                                {day.rows.map((j) => {
                                  rowNo += 1;
                                  const st = jobStatusDef(j.status);
                                  const overdue = isOverdue(j.expected_pickup_date);
                                  return (
                                    <tr key={j.id}>
                                      <td data-label="ลำดับ">{rowNo}</td>
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
                                            updateLocal(j.id, { expected_pickup_date: value || null });
                                            persistField(j.id, { expected_pickup_date: value || null });
                                          }}
                                        />
                                      </td>
                                      <td data-label="ยอดชำระ">{j.total_amount != null ? `฿${formatMoney(j.total_amount)}` : '-'}</td>
                                      <td data-label="สถานะ">
                                        <span className={`status-badge ${st.badge}`}>{st.label}</span>
                                      </td>
                                      <td data-label="หมายเหตุ">
                                        <input
                                          type="text"
                                          value={j.note || ''}
                                          placeholder="เพิ่มหมายเหตุ..."
                                          disabled={savingId === j.id}
                                          onChange={(e) => updateLocal(j.id, { note: e.target.value })}
                                          onBlur={(e) => persistField(j.id, { note: e.target.value })}
                                        />
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
    </div>
  );
}
