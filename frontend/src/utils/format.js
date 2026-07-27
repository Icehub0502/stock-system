export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const formatMoney = (value) => {
  if (Number.isNaN(Number(value))) return '0.00';
  return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
