import React from 'react';

// ไอคอนรถทั่วไป (silhouette) — ระบบยังไม่มีฟีเจอร์อัปโหลดรูปรถจริงต่อคัน ใช้ตัวนี้
// เป็นรูปแทนบนการ์ดคิวรับรถแทน (ดู JobBoardPage.jsx) inherit currentColor
export default function CarIcon({ className }) {
  return (
    <svg viewBox="0 0 64 40" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8 26 L12 14 Q14 10 19 10 H45 Q50 10 52 14 L56 26"
        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      />
      <path
        d="M4 26 H60 V32 Q60 34 58 34 H6 Q4 34 4 32 Z"
        stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"
      />
      <path d="M17 14 L15 21 H49 L47 14" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="16" cy="34" r="4.5" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="48" cy="34" r="4.5" stroke="currentColor" strokeWidth="2.5" />
    </svg>
  );
}
