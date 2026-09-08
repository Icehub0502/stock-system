import React, { useCallback, useEffect, useMemo, useState } from 'react';
import client from '../api/client';
import { formatMoney } from '../utils/format';
import { buildArchiveGroups, formatDateTh, formatMonthTh, formatYearTh } from '../utils/dateGroups';
import useRealtimeEvent from '../hooks/useRealtimeEvent';
import PendingDeliveryDetailModal from '../components/PendingDeliveryDetailModal';

// วันนี้ผ่านไปแล้วยังไม่ส่ง = นับเป็น "เกินกำหนด" — ใช้ทำตัวเลขเตือนที่หัวแฟ้มวัน
// เพราะพับเก็บรถของวันนั้นไว้ในแฟ้มแล้ว มองจากข้างนอกไม่เห็นแต่ละคันอีกต่อไป (ต้อง
// กดเข้าไปดูรายละเอียดถึงจะเห็นวันที่จริง) — ดูคอมเมนต์เดียวกันใน
// PendingDeliveryDetailModal.jsx
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
 * วัน ต่างจากหน้ารายการงานวันนี้ (JobBoardPage) ที่กรองแค่วันเดียว
 *
 * รูปแบบหน้า/การใช้งานมิเรอร์ DailySalesSummaryPage.jsx (หน้าสรุปยอดขายรายวัน) ทุก
 * ประการ ตามที่เจ้าของร้านสั่ง — หน้านอกแสดงแค่ "แฟ้ม" ปี→เดือน→วัน พร้อมสรุปจำนวน
 * คัน/ยอดชำระต่อวัน กดแถววันเพื่อเปิดรายละเอียด (รายการรถ + แก้ไขได้ + export) ใน
 * modal แยกต่างหาก (PendingDeliveryDetailModal.jsx) แทนที่จะกางตารางละเอียดทุกแถวไว้
 * ในหน้าเดียวเหมือนเวอร์ชันก่อน
 */
export default function PendingDeliveryPage() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);

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

  const selectedDayJobs = useMemo(() => {
    if (!selectedDate) return [];
    return jobs.filter((j) => j.job_date === selectedDate);
  }, [jobs, selectedDate]);

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <div>
          <h1>รถที่ยังไม่ได้ส่งรถ</h1>
          <p className="subtitle">แยกเป็นแฟ้มรายวัน — วันไหนที่ทุกคันส่งครบแล้วจะไม่ขึ้นในนี้อีก กดวันที่เพื่อดูรายละเอียด</p>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading">กำลังโหลด...</div>
      ) : jobs.length === 0 ? (
        <div className="empty-message">ไม่มีรถค้างส่งตอนนี้</div>
      ) : (
        <div className="quotation-table-wrap">
          <table className="quotation-table">
            <thead>
              <tr>
                <th>วันที่</th>
                <th>จำนวนคัน</th>
                <th>ยอดชำระรวม</th>
              </tr>
            </thead>
            <tbody>
              {archive.map((year) => {
                const yearOpen = expandedYears?.has(year.key);
                return (
                  <React.Fragment key={year.key}>
                    <tr className="year-group-header-row clickable-row" onClick={() => toggleYear(year.key)}>
                      <td colSpan={3}>
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
                            <td colSpan={3} style={{ paddingLeft: 28 }}>
                              <span className="month-group-toggle">{monthOpen ? '▾' : '▸'}</span>
                              {formatMonthTh(month.key)}
                              <span className="date-group-count"> ({month.count} คัน)</span>
                            </td>
                          </tr>
                          {monthOpen && month.days.map((day) => {
                            const totalAmount = day.rows.reduce((sum, j) => sum + Number(j.total_amount || 0), 0);
                            const overdueCount = day.rows.filter((j) => isOverdue(j.expected_pickup_date)).length;
                            return (
                              <tr
                                key={day.key}
                                className="clickable-row"
                                onClick={() => setSelectedDate(day.key)}
                              >
                                <td data-label="วันที่">
                                  <strong>{formatDateTh(day.key)}</strong>
                                  {overdueCount > 0 && (
                                    <span className="pending-delivery-overdue-badge"> เกินกำหนด {overdueCount} คัน</span>
                                  )}
                                </td>
                                <td data-label="จำนวนคัน">{day.rows.length}</td>
                                <td className="amount" data-label="ยอดชำระรวม">฿{formatMoney(totalAmount)}</td>
                              </tr>
                            );
                          })}
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

      {selectedDate && (
        <PendingDeliveryDetailModal
          date={selectedDate}
          jobs={selectedDayJobs}
          savingId={savingId}
          onLocalChange={updateLocal}
          onPersist={persistField}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  );
}
