// สถานะงานรับรถ (ระบบคิว) — 11 ขั้นตามที่เจ้าของร้านเลือก อิงจากโครงของโปรเจกต์
// ChamppowerD ที่ทำไว้สำหรับร้านเดียวกัน แต่ผูกกับ quotations.status ของระบบนี้แทน
// (ดู QUOTATION_STATUS_TO_JOB ด้านล่าง) ไฟล์นี้เป็นต้นทางความจริงฝั่ง backend —
// ฝั่งหน้าเว็บมีสำเนาที่ frontend/src/utils/jobStatus.js ต้องแก้ให้ตรงกันทั้งคู่
const JOB_STATUSES = [
  { key: 'received',   label: 'รับรถ' },
  { key: 'inspecting', label: 'ตรวจเช็ค' },
  { key: 'quoted',     label: 'เสนอราคา' },
  { key: 'approved',   label: 'อนุมัติ' },
  { key: 'scheduled',  label: 'นัดวันมาทำ' },
  { key: 'rejected',   label: 'ไม่อนุมัติ' },
  { key: 'repairing',  label: 'กำลังซ่อม' },
  { key: 'aligning',   label: 'รอตั้งศูนย์' },
  { key: 'ready',      label: 'พร้อมส่ง' },
  { key: 'delivered',  label: 'ส่งแล้ว' },
  { key: 'carout',     label: 'เอารถลง' },
];

const JOB_STATUS_KEYS = JOB_STATUSES.map((s) => s.key);

// เส้นทางหลัก (ลูกค้าอนุมัติแล้วทำงานจนจบ) — ใช้หาปุ่ม "ขั้นถัดไป" และวาดแถบ
// ความคืบหน้า ส่วนสาขา scheduled/rejected แยกไปจบที่ carout (ดู BRANCH_ENDS)
const MAIN_PATH = [
  'received', 'inspecting', 'quoted', 'approved',
  'repairing', 'aligning', 'ready', 'delivered',
];

// คำตอบของลูกค้าหลังได้รับใบเสนอราคา — 3 ทางแยกตรงกลาง
const DECISION_KEYS = ['approved', 'scheduled', 'rejected'];

// สาขาที่จบด้วยการเอารถลงจากช่องยกเฉย ๆ (ยังไม่ได้ซ่อม)
const BRANCH_ENDS = { scheduled: 'carout', rejected: 'carout' };

// งานที่ถือว่า "จบแล้ว" — ไม่กินช่องยก และไม่ต้องขึ้นบนจอบอร์ดอีก
const CLOSED_STATUSES = ['delivered', 'carout'];

// ── เชื่อมสองทางกับสถานะใบเสนอราคาเดิมของระบบ ──
// quotations.status เป็น ENUM('pending','approved','scheduled','no_date','declined')
// อยู่แล้ว (ดู db/init.js) — พอฝั่งใบเสนอราคาเปลี่ยน สถานะงานเดินตามเอง ไม่ต้องกด
// ซ้ำสองที่ 'no_date' (รอนัดหมาย ยังไม่ได้วัน) กับ 'scheduled' (นัดวันแล้ว) ฝั่งงาน
// รับรถถือเป็นสถานะเดียวกันคือ "นัดวันมาทำ" เพราะบนช่องยกไม่ต่างกัน — รถลงทั้งคู่
const QUOTATION_STATUS_TO_JOB = {
  pending: 'quoted',
  approved: 'approved',
  scheduled: 'scheduled',
  no_date: 'scheduled',
  declined: 'rejected',
};

// ขากลับ: งานเปลี่ยนสถานะแล้วดันใบเสนอราคาให้ตรงกัน — เฉพาะ 3 ทางแยกที่เป็นคำตอบ
// ของลูกค้าจริง ๆ สถานะอื่น (repairing/ready/…) เป็นความคืบหน้าหน้างาน ไม่ใช่การ
// ตัดสินใจของลูกค้า จึงไม่แตะใบเสนอราคา
const JOB_STATUS_TO_QUOTATION = {
  approved: 'approved',
  scheduled: 'scheduled',
  rejected: 'declined',
};

function isValidJobStatus(status) {
  return JOB_STATUS_KEYS.includes(status);
}

function jobStatusLabel(status) {
  return (JOB_STATUSES.find((s) => s.key === status) || JOB_STATUSES[0]).label;
}

module.exports = {
  JOB_STATUSES,
  JOB_STATUS_KEYS,
  MAIN_PATH,
  DECISION_KEYS,
  BRANCH_ENDS,
  CLOSED_STATUSES,
  QUOTATION_STATUS_TO_JOB,
  JOB_STATUS_TO_QUOTATION,
  isValidJobStatus,
  jobStatusLabel,
};
