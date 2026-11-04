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
async function syncJobOnQuotationStatusChange(conn, shopId, quotationId, targetJobStatus, actorUserId) {
  // newest first: a quotation can have an older job that ended when the car went home (carout) and a new
  // one from when it came back. Only the new one may follow the quotation, the old one stays closed.
  const [[linkedJob]] = await conn.query(
    'SELECT id, job_date, status FROM jobs WHERE shop_id = ? AND quotation_id = ? ORDER BY id DESC LIMIT 1',
    [shopId, quotationId]
  );
  if (!linkedJob || !ELIGIBLE_JOB_STATUSES.includes(linkedJob.status)) {
    return null;
  }

  await conn.execute(
    'UPDATE jobs SET status = ?, bay = NULL, closed_at = NULL WHERE id = ? AND shop_id = ?',
    [targetJobStatus, linkedJob.id, shopId]
  );
  await conn.execute(
    'INSERT INTO job_status_history (job_id, status, changed_by) VALUES (?,?,?)',
    [linkedJob.id, targetJobStatus, actorUserId]
  );

  return { jobId: linkedJob.id, jobDate: linkedJob.job_date, status: targetJobStatus };
}

// The car of a "นัดวันมาทำ" job has come back as a new queue: the old job ends as "เอารถลง" and gives up its bay.
// Runs in the caller's transaction. exceptJobId = the job the car is on now, when that job is already linked.
async function closeWaitingJobs(conn, shopId, quotationId, actorUserId, { exceptJobId = null } = {}) {
  const [waiting] = await conn.query(
    "SELECT id FROM jobs WHERE shop_id = ? AND quotation_id = ? AND status = 'scheduled' FOR UPDATE",
    [shopId, quotationId]
  );
  const closedIds = waiting.map((j) => j.id).filter((id) => id !== exceptJobId);
  for (const id of closedIds) {
    await conn.execute(
      "UPDATE jobs SET status = 'carout', bay = NULL, closed_at = NOW() WHERE id = ? AND shop_id = ?",
      [id, shopId]
    );
    await conn.execute(
      "INSERT INTO job_status_history (job_id, status, changed_by) VALUES (?, 'carout', ?)",
      [id, actorUserId]
    );
  }
  return closedIds;
}

module.exports = { syncJobOnQuotationStatusChange, closeWaitingJobs };
