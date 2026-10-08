// ป้ายและสีประจำตำแหน่งของสต๊อกรวม (ซ้าย/ขวา/หน้า/หลัง) — ใช้ร่วมกันทั้งหน้าสต๊อกรวมและหน้าสแกน
// ให้ตำแหน่งเดียวกันเป็นสีเดียวกันทุกหน้า ซ้าย=น้ำเงิน ขวา=แดง หน้า=ม่วง หลัง=ส้ม
// (โช๊ค 4 ตำแหน่งใช้ 4 สีไม่ซ้ำกัน) ต้องตรงกับ POSITION_LABEL ใน
// backend/src/routes/stockReceive.routes.js
export const POSITION_LABEL = {
  left: 'ซ้าย', right: 'ขวา', front: 'หน้า', rear: 'หลัง',
  front_left: 'หน้าซ้าย', front_right: 'หน้าขวา', rear_left: 'หลังซ้าย', rear_right: 'หลังขวา',
};

export const POSITION_COLOR = {
  left: { fg: '#1d4ed8', bg: '#dbeafe' },
  right: { fg: '#b91c1c', bg: '#fee2e2' },
  front: { fg: '#6d28d9', bg: '#ede9fe' },
  rear: { fg: '#c2410c', bg: '#ffedd5' },
  front_left: { fg: '#1d4ed8', bg: '#dbeafe' },
  front_right: { fg: '#b91c1c', bg: '#fee2e2' },
  rear_left: { fg: '#047857', bg: '#d1fae5' },
  rear_right: { fg: '#c2410c', bg: '#ffedd5' },
};

export const NEUTRAL_POSITION_COLOR = { fg: '#374151', bg: '#e5e7eb' };
