// Labels of a customer case (backend/src/routes/claims.routes.js), shared by the case list, the follow-up page and
// the vehicle history page.
export const CASE_TYPE_LABEL = { rework: 'มาแก้งาน', parts_claim: 'เคลมอะไหล่' };

export const CASE_STATUS = {
  open: { label: 'กำลังแก้', badge: 'status-badge-warning' },
  follow_up: { label: 'รอติดตามผล', badge: 'status-badge-paid' },
  closed: { label: 'ปิดแล้ว', badge: 'status-badge-neutral' },
};

export const REPORT_RESULT_LABEL = {
  ok: 'ลูกค้าแจ้งว่าหายดี',
  still_problem: 'ยังมีปัญหา',
  no_answer: 'ติดต่อไม่ได้',
};

export const OUTCOME_LABEL = { resolved: 'แก้สำเร็จ', partial: 'สำเร็จบางส่วน', not_resolved: 'แก้ไม่สำเร็จ' };

// "add N days / 1 month" to a yyyy-mm-dd date; a month keeps the day, clamped to the end of a shorter month
export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function addOneMonth(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, lastDay))).toISOString().slice(0, 10);
}
