// เหตุผลที่ลูกค้าไม่ได้ทำ — มาจาก GET /settings/decline-reasons (แก้ไขได้จากหน้า
// ตั้งค่า) เก็บไว้แค่ตัวช่วยแปลง id -> label ที่นี่ 'other' เป็นค่าคงที่พิเศษเสมอ
// (ไม่ใช่แถวใน DB) เพราะต้องมี decline_note คู่กันด้วยทุกครั้ง
export function declineReasonLabel(value, reasons = []) {
  if (value === 'other') return 'อื่นๆ ระบุ';
  return reasons.find((r) => String(r.id) === String(value))?.label || value || '-';
}
