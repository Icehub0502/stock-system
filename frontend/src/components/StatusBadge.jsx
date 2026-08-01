import React from 'react';
import { todayStr } from '../utils/format';

// Quotation status pill — shared between QuotationListPage and
// AppointmentsPage so the two pages always agree on what each status
// looks like.
export default function StatusBadge({ status, scheduledDate, closedAt }) {
  // บิลที่ลูกค้าชำระเงินครบผ่านเทมเพลตไลน์แล้ว (closed_at ถูกตั้ง) ให้เห็นชัดกว่า
  // สถานะอื่นเสมอ ไม่ว่า status จะเป็นอะไรอยู่ก็ตาม เพราะนี่คือคำตอบของ "จ่ายหรือยัง"
  // ที่หน้างานอยากรู้จริง ๆ ไม่ใช่แค่ "อนุมัติหรือยัง"
  if (closedAt) {
    return <span className="status-badge status-badge-paid">💰 ชำระแล้ว</span>;
  }
  if (status === 'approved') {
    return <span className="status-badge status-badge-success">✅ อนุมัติแล้ว</span>;
  }
  if (status === 'scheduled') {
    const dateText = scheduledDate ? new Date(scheduledDate).toLocaleDateString('th-TH') : '-';
    // Today's due appointment needs to look distinctly more urgent than a
    // future-dated one, not just show the same "รอทำ" badge.
    if (scheduledDate === todayStr()) {
      return <span className="status-badge status-badge-today">🔔 นัดวันนี้ {dateText}</span>;
    }
    return <span className="status-badge status-badge-warning">📅 รอทำ {dateText}</span>;
  }
  if (status === 'no_date') {
    return <span className="status-badge status-badge-danger">⚠️ ไม่ระบุวันนัดหมาย</span>;
  }
  if (status === 'declined') {
    return <span className="status-badge status-badge-neutral">🚫 ลูกค้าไม่ได้ทำ</span>;
  }
  return <span className="status-badge status-badge-neutral">⏳ รอดำเนินการ</span>;
}
