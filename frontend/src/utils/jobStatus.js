// สำเนาฝั่งหน้าเว็บของ backend/src/utils/jobStatusFlow.js — ต้องแก้ให้ตรงกันทั้งคู่
// ทุกครั้งที่เพิ่ม/แก้สถานะ (backend เป็นต้นทางความจริง ไฟล์นี้แค่ใช้แสดงผล/ปุ่ม)
export const JOB_STATUSES = [
  { key: 'received',   label: 'รับรถ',      badge: 'status-badge-neutral' },
  { key: 'inspecting', label: 'ตรวจเช็ค',    badge: 'status-badge-warning' },
  { key: 'quoted',      label: 'เสนอราคา',   badge: 'status-badge-warning' },
  { key: 'approved',   label: 'อนุมัติ',     badge: 'status-badge-success' },
  { key: 'scheduled',  label: 'นัดวันมาทำ',  badge: 'status-badge-warning' },
  { key: 'rejected',   label: 'ไม่อนุมัติ',  badge: 'status-badge-danger' },
  { key: 'repairing',  label: 'กำลังซ่อม',   badge: 'status-badge-today' },
  { key: 'aligning',   label: 'รอตั้งศูนย์', badge: 'status-badge-today' },
  { key: 'ready',      label: 'พร้อมส่ง',    badge: 'status-badge-success' },
  { key: 'delivered',  label: 'ส่งแล้ว',     badge: 'status-badge-paid' },
  { key: 'carout',     label: 'เอารถลง',     badge: 'status-badge-neutral' },
];

export const MAIN_PATH = [
  'received', 'inspecting', 'quoted', 'approved',
  'repairing', 'aligning', 'ready', 'delivered',
];

export const DECISION_KEYS = ['approved', 'scheduled', 'rejected'];
export const CLOSED_STATUSES = ['delivered', 'carout'];

export function jobStatusDef(status) {
  return JOB_STATUSES.find((s) => s.key === status) || JOB_STATUSES[0];
}

export function jobStatusLabel(status) {
  return jobStatusDef(status).label;
}

// "ขั้นถัดไป" บนเส้นทางหลัก — ใช้ทำปุ่มเดียว "ไปขั้นต่อไป" ระหว่างสถานะที่ไม่ใช่
// ทางแยกตัดสินใจ (received→inspecting, repairing→aligning→ready→delivered ฯลฯ)
export function nextMainStatus(status) {
  const idx = MAIN_PATH.indexOf(status);
  if (idx === -1 || idx === MAIN_PATH.length - 1) return null;
  return MAIN_PATH[idx + 1];
}

// ปุ่ม "ย้อนกลับ" บนการ์ด (หน้ารายการงานวันนี้) — เผื่อกดขั้นถัดไปผิด ใช้ไล่ตาม
// MAIN_PATH ย้อนกลับตรง ๆ (ไม่ได้ดูประวัติจริงเหมือน JobDetailPage เดิม เพราะ
// รายการงานวันนี้ไม่ได้โหลดประวัติทีละงานมาด้วย) ใช้ได้เฉพาะงานที่ยังอยู่บนเส้น
// ทางหลัก — งานที่แยกไปทาง scheduled/rejected/carout ไม่มีปุ่มนี้ (ไม่อยู่บน
// MAIN_PATH ตั้งแต่แรก)
export function prevMainStatus(status) {
  const idx = MAIN_PATH.indexOf(status);
  if (idx <= 0) return null;
  return MAIN_PATH[idx - 1];
}
