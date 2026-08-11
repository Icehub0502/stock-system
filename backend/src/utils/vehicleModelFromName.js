// อะไหล่ในสต๊อก (racks/wing_arms) ตั้งชื่อรายการโดยระบุรุ่นรถไว้ในชื่ออยู่แล้ว เช่น
// "แร็ค CHEVROLET AVEO ปี 2007-2013" หรือ "ปีกนกบน ขวา FD RANGER BT-50 PRO 4WD..."
// — แทนที่จะให้พนักงานพิมพ์ยี่ห้อ/รุ่นรถซ้ำตอนตัดสต๊อก (ซ้ำซ้อนกับข้อมูลที่มีอยู่
// แล้วในชื่อ) ดึงมาใช้เป็น vehicle_model ของ transaction แถวนั้นโดยอัตโนมัติ ตัด
// คำนำหน้าที่เป็นชื่อประเภทอะไหล่/ตำแหน่ง/ข้าง (ไม่ใช่ส่วนของรุ่นรถ) ทิ้งไป — ปีกนก
// ซ้าย/ขวาของรุ่นเดียวกันต้องตัดคำ "ซ้าย"/"ขวา" ออกด้วย ไม่งั้นรายงานจะนับเป็นคนละ
// รุ่นรถกัน (ดู GET /transactions/usage-report ใน backend_transactions.routes.js)

function vehicleModelFromRackName(name) {
  return String(name || '').replace(/^แร็ค\s*/i, '').trim();
}

function vehicleModelFromWingArmName(name) {
  return String(name || '')
    .replace(/^ปีกนก(?:บน|ล่าง)?\s*/i, '')
    .replace(/(ซ้าย|ขวา)\s*/, '')
    .trim();
}

module.exports = { vehicleModelFromRackName, vehicleModelFromWingArmName };
