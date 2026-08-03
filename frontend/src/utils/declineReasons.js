// ชุดเหตุผลคงที่ที่เลือกได้ตอนกด "ลูกค้าไม่ได้ทำ" — ต้องตรงกับ DECLINE_REASON_VALUES
// ใน backend/src/routes/quotations.routes.js เป๊ะ ๆ (แก้ที่นี่ต้องแก้ที่นั่นด้วยเสมอ)
// ใช้ค่าคงที่แทนข้อความอิสระ เพื่อให้หน้าสรุปสถิติ (DeclinedSummaryPage.jsx) จัดกลุ่ม
// ได้ถูกต้องแม่นยำ ไม่กระจัดกระจายเป็นข้อความคนละแบบความหมายเดียวกัน
export const DECLINE_REASONS = [
  { value: 'price_high', label: 'ราคาสูงไป' },
  { value: 'budget', label: 'งบไม่พอ' },
  { value: 'quote_only', label: 'ขอใบเสนอราคา' },
  { value: 'other_day', label: 'นำรถมาทำวันอื่น' },
  { value: 'other', label: 'อื่นๆ ระบุ' },
];

export function declineReasonLabel(value) {
  return DECLINE_REASONS.find((r) => r.value === value)?.label || value || '-';
}
