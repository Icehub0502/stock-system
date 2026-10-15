import React from 'react';
import { PAYMENT_METHODS, PAYMENT_METHOD_CLASS } from '../utils/paymentMethods';

function formatBaht(value) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// การ์ดสรุปยอดแยกตามช่องทางชำระ — แสดงครบ 5 ช่องทางมาตรฐานเสมอ (ไม่มียอด = ฿0.00)
// ช่องทางอื่นที่มีในข้อมูล (บิลเก่า "โอน"/"QRCode" และ "ไม่ระบุ") ต่อท้ายเมื่อมียอดเท่านั้น
// items: [{ method, bill_count, total }]
export default function PaymentBreakdown({ items, title, compact = false }) {
  const byMethod = new Map(items.map((i) => [i.method, i]));
  const extras = items.filter((i) => !PAYMENT_METHODS.includes(i.method));
  const cards = [
    ...PAYMENT_METHODS.map((m) => byMethod.get(m) || { method: m, bill_count: 0, total: 0 }),
    ...extras,
  ];
  return (
    <div className={`pay-breakdown${compact ? " pay-breakdown-compact" : ""}`}>
      {title && <div className="pay-breakdown-title">{title}</div>}
      <div className="pay-breakdown-grid">
        {cards.map((c) => (
          <div key={c.method} className={`pay-breakdown-card ${PAYMENT_METHOD_CLASS[c.method] || 'pay-chip-other'}`}>
            <div className="pay-breakdown-label">{c.method}</div>
            <div className="pay-breakdown-value">฿{formatBaht(c.total)}</div>
            <div className="pay-breakdown-count">{c.bill_count.toLocaleString('en-US')} บิล</div>
          </div>
        ))}
      </div>
    </div>
  );
}
