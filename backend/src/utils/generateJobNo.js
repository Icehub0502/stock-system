// JB-YYMMDD-NNN — เลขรันต่อวัน (รีเซ็ตทุกวัน) ต่างจาก quotation_no ที่รันต่อวันเหมือน
// กันแต่คนละชุด ล็อกด้วย FOR UPDATE ในทรานแซกชันเหมือน generateQuotationNo/
// generateCustomerCode เพื่อกันสองคนกดรับรถพร้อมกันแล้วได้เลขชนกัน
//
// อยู่แยกไฟล์ (ไม่ใช่ export จาก jobs.routes.js) เพราะ lineWebhook.routes.js ต้องใช้
// เลขชุดนี้ด้วย (สร้างงานคู่กับใบเสนอราคาจากไลน์) และ jobs.routes.js -> quotations.routes.js
// -> lineWebhook.routes.js เป็น require chain ที่มีอยู่แล้ว — ถ้า lineWebhook.routes.js
// require jobs.routes.js ตรง ๆ จะเกิด circular require กลับมาที่ quotations.routes.js
// จนโมดูลนั้นโหลดไม่ครบ (generateQuotationNo ฯลฯ จะเป็น undefined)
async function generateJobNo(conn, jobDate) {
  const [y, m, d] = jobDate.split('-');
  const prefix = `JB-${y.slice(-2)}${m}${d}-`;
  const [rows] = await conn.execute(
    'SELECT MAX(CAST(SUBSTRING(job_no, -3) AS UNSIGNED)) AS maxNo FROM jobs WHERE job_no LIKE ? FOR UPDATE',
    [`${prefix}%`]
  );
  const next = (rows[0]?.maxNo || 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

module.exports = { generateJobNo };
