import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { jobStatusDef } from '../utils/jobStatus';
import { formatMoney } from '../utils/format';
import useRealtimeEvent from '../hooks/useRealtimeEvent';

function formatDateTh(dateStr) {
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
 * รถที่ยังไม่ได้ส่งรถ — มองข้ามวัน ต่างจากหน้ารายการงานวันนี้ (JobBoardPage) ที่กรอง
 * แค่วันเดียว รถที่ค้างซ่อมมาหลายวันจะยังโผล่ที่นี่ต่อเนื่องจนกว่าจะกด "ส่งแล้ว"
 * จริง ๆ — เจ้าของร้านขอไว้เป็นหน้าสรุปแบบตาราง (เหมือนหน้าสรุปยอด) ไม่ใช่การ์ด
 */
export default function PendingDeliveryPage() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState(null);

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

  return (
    <div className="quotation-page">
      <div className="quotation-header">
        <h1>รถที่ยังไม่ได้ส่งรถ</h1>
      </div>
      <p className="sec-intro" style={{ color: '#6b7280', marginTop: -8, marginBottom: 16 }}>
        รวมรถทุกคันที่ยังอยู่ในขั้นตอนซ่อม ไม่ว่าจะรับเข้ามาวันไหน จนกว่าจะกดสถานะ "ส่งแล้ว" ที่หน้ารายการงาน
      </p>

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
              {jobs.map((j, idx) => {
                const st = jobStatusDef(j.status);
                const overdue = isOverdue(j.expected_pickup_date);
                return (
                  <tr key={j.id}>
                    <td data-label="ลำดับ">{idx + 1}</td>
                    <td className="col-customer-name" data-label="ชื่อลูกค้า">
                      <Link to={`/jobs/${j.id}`}>{j.customer_name || '-'}</Link>
                    </td>
                    <td data-label="รุ่นรถ">{j.brand} {j.model} {j.color && `· ${j.color}`}</td>
                    <td data-label="ทะเบียนรถ">{j.license_plate || '-'}</td>
                    <td data-label="รายการ">{j.product_summary || j.symptom || '-'}</td>
                    <td data-label="วันที่รับเข้า">{formatDateTh(j.job_date)}</td>
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
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
