// หน้าตัดสต๊อก (StockDeductionPage.jsx) มีช่องเลือกวันที่แบบ optional เผื่อของออกไป
// แล้วแต่พนักงานลืมตัด มาตัดย้อนหลังทีหลัง — ใช้วันที่ที่เลือกผสมกับเวลาปัจจุบัน
// (ตำแหน่งเดียวกับที่ DEFAULT CURRENT_TIMESTAMP จะใส่ให้ถ้าไม่ได้ระบุ) เพื่อให้
// created_at ยังเทียบ string ตรงกับที่ /usage-report กรองช่วงวันที่อยู่ (ดูคอมเมนต์
// ที่ usage-report — เทียบ created_at แบบ naive string ไม่แปลง timezone)
function resolveTransactionDate(transactionDate) {
  if (!transactionDate || !/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) return null;

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${transactionDate} ${hh}:${mm}:${ss}`;
}

module.exports = { resolveTransactionDate };
