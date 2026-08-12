// mirror ของ backend/src/utils/vehicleModelFromName.js — ใช้เดา "รุ่นรถ" เริ่มต้นจาก
// ชื่อรายการอะไหล่ให้ขึ้นมาโชว์ในช่องกรอกทันทีที่เลือกอะไหล่ (StockDeductionPage.jsx)
// พนักงานแก้ไขได้ถ้าเดาผิด ค่าที่ยืนยัน/แก้แล้วจะถูกส่งไป backend ตรง ๆ แทนการเดาเอง
// อีกรอบฝั่งเซิร์ฟเวอร์ (ดู POST /transactions/out, PATCH /wing-arms/:id/stock,
// PATCH /wing-arms/pair-stock)
export function vehicleModelFromRackName(name) {
  return String(name || '').replace(/^แร็ค\s*/i, '').trim();
}

export function vehicleModelFromWingArmName(name) {
  return String(name || '')
    .replace(/^ปีกนก(?:บน|ล่าง)?\s*/i, '')
    .replace(/(ซ้าย|ขวา)\s*/, '')
    .trim();
}
