// ชื่อของคู่ซ้าย-ขวาที่รวมเป็นรายการเดียวในสต๊อกรวม ต้องไม่มีคำบอกข้าง (ซ้าย/ขวา/LH/RH) —
// ไม่งั้นรายการที่มีทั้งสองข้างจะแสดงชื่อ "ซ้าย ..." ค้างอยู่ ทั้งที่ข้างขวาก็อยู่ในรายการเดียวกัน
// (ตำแหน่งบอกด้วยป้ายสีของแต่ละข้างอยู่แล้ว) ถ้าลบแล้วไม่เหลืออะไรคืนชื่อเดิม
function stripSideWords(name) {
  const cleaned = String(name || '')
    .replace(/ซ้าย|ขวา/g, ' ')
    .replace(/\b(LH|RH)\b\/?/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || String(name || '').trim();
}

module.exports = { stripSideWords };
