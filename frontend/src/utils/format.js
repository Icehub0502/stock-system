export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const formatMoney = (value) => {
  if (Number.isNaN(Number(value))) return '0.00';
  return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// backend ตั้ง dateStrings:true ไว้ใน db/pool.js ค่าคอลัมน์ DATETIME/TIMESTAMP จึงถูกส่ง
// มาเป็นสตริงดิบ "YYYY-MM-DD HH:mm:ss" ที่ไม่มีตัวบอกโซนเวลาติดมาด้วย — เซิร์ฟเวอร์
// production รันเป็น UTC ทั้ง MySQL และ Node ค่าที่เก็บจึงเป็นเวลา UTC เสมอ แต่ตาม
// มาตรฐาน JS เบราว์เซอร์จะตีความสตริงรูปแบบนี้ (คั่นด้วยเว้นวรรค ไม่มีโซนเวลา) เป็น
// "เวลาท้องถิ่น" ทำให้เวลาที่แสดงในไทยเพี้ยนช้าไป 7 ชั่วโมง (สแกนบ่าย 2 โมง ขึ้นเป็น
// 7 โมงเช้า) — เติม Z ต่อท้ายให้ชัดเจนว่าเป็น UTC ก่อนแปลงเป็นเวลาท้องถิ่นของเครื่อง
//
// ⚠️ ใช้กับคอลัมน์ DATETIME/TIMESTAMP (มีเวลา) เท่านั้น — คอลัมน์ DATE ล้วน ๆ อย่าง
// quotation_date/receipt_date/bill_date เป็นสตริง "YYYY-MM-DD" ที่ไม่มีปัญหานี้อยู่แล้ว
// ห้ามส่งมาที่นี่ เพราะจะกลายเป็นเที่ยงคืน UTC แล้วเลื่อนวันผิดไปเลย
export const parseDbDateTime = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  const str = String(value).trim();
  // มีตัวบอกโซนเวลาติดมาแล้ว (ISO ลงท้ายด้วย Z หรือ +07:00) ปล่อยให้ Date อ่านตามปกติ
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(str)) return new Date(str);
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/.exec(str);
  if (!match) return new Date(str);
  return new Date(`${match[1]}T${match[2]}Z`);
};

// "14:06" — เวลาที่สแกน/ทำรายการจริง ตามเวลาเครื่องผู้ใช้
export const formatDbTime = (value) => {
  const d = parseDbDateTime(value);
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
};

// "13 ส.ค. 2569 14:06" — วันที่+เวลาแบบเต็ม
export const formatDbDateTime = (value) => {
  const d = parseDbDateTime(value);
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('th-TH', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

// คำนำหน้าชื่อที่พบบ่อย — ตัดออกก่อนเพื่อให้ initials สื่อถึง "ชื่อจริง" แทนคำนำหน้า
// (เช่น "คุณสมชาย" อยากได้ "สม" ไม่ใช่ "คุ" จากคำว่า "คุณ")
// เรียงคำยาวไว้ก่อนคำสั้นที่เป็น substring ของกันเอง (เช่น "นางสาว" ก่อน "นาง")
const THAI_NAME_PREFIXES = ['นางสาว', 'เด็กชาย', 'เด็กหญิง', 'คุณนาย', 'คุณนาง', 'ด.ช.', 'ด.ญ.', 'คุณ', 'นาย', 'นาง'];

// ดึงอักษรย่อ 1-2 ตัวจากชื่อ ใช้แสดงเป็น avatar กลม ๆ ในรายการลูกค้า/รถ (มือถือ)
export const getNameInitials = (name) => {
  if (!name || !name.trim()) return '?';
  let rest = name.trim();
  for (const prefix of THAI_NAME_PREFIXES) {
    if (rest.startsWith(prefix)) {
      rest = rest.slice(prefix.length).trim();
      break;
    }
  }
  if (!rest) rest = name.trim();
  return rest.slice(0, 2);
};
