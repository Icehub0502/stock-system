import React from 'react';
import { formatDateTh } from '../utils/dateGroups';

// ใช้ร่วมกันทั้ง CustomerHistoryPage.jsx และ VehicleHistoryPage.jsx — โครงสร้าง
// visits มาจาก buildVisitHistory ฝั่ง backend (backend/src/utils/visitHistory.js)
// เหมือนกันทั้งคู่ ต่างกันแค่ filter (customer_id / vehicle_id)
export default function VisitTimeline({ visits }) {
  if (!visits || visits.length === 0) {
    return <div className="empty-message">ยังไม่มีประวัติการเข้ารับบริการ</div>;
  }

  return (
    <div className="visit-timeline">
      {visits.map((v, idx) => (
        <div className="visit-card" key={idx}>
          <div className="visit-card-header">
            <span className="visit-card-date">{formatDateTh(v.date)}</span>
            {v.status_label ? (
              <span className={`status-badge ${statusBadgeCls(v.status)}`}>{v.status_label}</span>
            ) : (
              <span className="status-badge status-badge-neutral">ใบเสนอราคา</span>
            )}
          </div>

          <div className="visit-card-meta">
            {v.job_no && <span>เลขงาน {v.job_no}{v.queue_no ? ` · คิว ${v.queue_no}` : ''}</span>}
            {v.quotation_no && <span>ใบเสนอราคา {v.quotation_no}</span>}
            {v.receipt_no && <span>ใบเสร็จ {v.receipt_no}</span>}
          </div>

          {v.symptom && <p className="visit-card-symptom">อาการ: {v.symptom}</p>}
          {v.mileage != null && <p className="visit-card-mileage">เลขไมล์: {Number(v.mileage).toLocaleString('th-TH')}</p>}

          {v.items.length > 0 && (
            <ul className="visit-item-list">
              {v.items.map((it, i) => (
                <li key={i}>
                  <span>{it.product_name} {it.quantity > 1 && `x${it.quantity}`}</span>
                  <span className="visit-item-price">฿{(it.quantity * Number(it.unit_price)).toLocaleString('th-TH')}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="visit-card-footer">
            {v.deposit_amount > 0 && <span>มัดจำ ฿{Number(v.deposit_amount).toLocaleString('th-TH')}</span>}
            {v.total_amount != null && <span className="visit-card-total">รวม ฿{Number(v.total_amount).toLocaleString('th-TH')}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// mirror ตรรกะสีเดียวกับ BoardPage.jsx statusBadgeCls — รวมสถานะใบเสนอราคา
// (parts_ready/no_date/declined ฯลฯ) เพิ่มเข้ามาเพราะไทม์ไลน์นี้ปนทั้งสถานะงานและ
// สถานะใบเสนอราคาไว้ด้วยกัน
function statusBadgeCls(status) {
  if (status === 'approved' || status === 'ready') return 'status-badge-success';
  if (status === 'rejected' || status === 'declined') return 'status-badge-danger';
  if (status === 'repairing' || status === 'aligning') return 'status-badge-today';
  if (['scheduled', 'quoted', 'inspecting', 'parts_ready', 'no_date', 'pending'].includes(status)) return 'status-badge-warning';
  return 'status-badge-neutral';
}
