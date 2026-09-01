// เชื่อมสถานะ "งาน" (jobs.status) ให้ตามสถานะใบเสนอราคาที่เพิ่งเปลี่ยน — ใช้จุดเดียว
// จากทุก endpoint ที่เปลี่ยนสถานะใบเสนอราคา (อนุมัติ/ไม่ทำ) กันบั๊กแบบรถ Sonic ที่เจอ:
// ลูกค้ามัดจำแล้วรถ "เอาลง" (carout — หลุดจากจอบอร์ด เผื่อกลับมาทำวันหลัง) แต่กลับมา
// ทำต่อวันเดียวกัน พนักงานอนุมัติผ่านหน้าใบเสนอราคา/นัดหมาย/บอทไลน์แทนปุ่มที่หน้างาน
// เอง (ซึ่ง sync ให้เองอยู่แล้ว) งานเลยค้างสถานะเดิมทั้งที่จริงตัดสินใจไปแล้ว — ก่อนหน้านี้
// แต่ละ endpoint เขียน sync logic แยกกันเอง พอเพิ่มจุดใหม่ (บอทไลน์ปิดบิล, ปุ่ม
// "ลูกค้าไม่ได้ทำ") ก็ลืม sync ซ้ำอีก จึงรวมมาไว้ฟังก์ชันเดียวกันจุดนี้แทน
//
// เลื่อนสถานะเฉพาะงานที่ "ยังไม่ถูกตัดสินใจไปทางไหนแน่นอน" เท่านั้น
// (received/inspecting/quoted/carout) กันดึงงานที่ซ่อมไปไกลแล้ว หรือถูกตัดสินใจไป
// ทางอื่นแล้ว (scheduled/rejected/repairing/...) ให้ถอยหลังกลับมาโดยไม่ตั้งใจ
const ELIGIBLE_JOB_STATUSES = ['received', 'inspecting', 'quoted', 'carout'];

// conn: connection ที่เปิด transaction ไว้แล้วจากฝั่งเรียก (ฟังก์ชันนี้ไม่ commit/rollback เอง)
// quotationId: ใบเสนอราคาที่เพิ่งเปลี่ยนสถานะ
// targetJobStatus: สถานะงานที่จะตั้งให้ ('approved' | 'rejected')
// actorUserId: ผู้ทำรายการ ใช้บันทึก job_status_history
// คืนค่า { jobId, jobDate, status } ถ้ามีการอัปเดตจริง ไม่งั้นคืน null
async function syncJobOnQuotationStatusChange(conn, quotationId, targetJobStatus, actorUserId) {
  const [[linkedJob]] = await conn.query(
    'SELECT id, job_date, status FROM jobs WHERE quotation_id = ? LIMIT 1',
    [quotationId]
  );
  if (!linkedJob || !ELIGIBLE_JOB_STATUSES.includes(linkedJob.status)) {
    return null;
  }

  await conn.execute(
    'UPDATE jobs SET status = ?, bay = NULL, closed_at = NULL WHERE id = ?',
    [targetJobStatus, linkedJob.id]
  );
  await conn.execute(
    'INSERT INTO job_status_history (job_id, status, changed_by) VALUES (?,?,?)',
    [linkedJob.id, targetJobStatus, actorUserId]
  );

  return { jobId: linkedJob.id, jobDate: linkedJob.job_date, status: targetJobStatus };
}

module.exports = { syncJobOnQuotationStatusChange };
