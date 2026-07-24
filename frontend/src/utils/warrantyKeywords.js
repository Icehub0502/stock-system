// ใช้ร่วมกันระหว่างใบเสนอราคา/ใบเสร็จ — คำที่ใช้จับคู่ชื่อรายการกับช่อง dropdown
// "ประกันแร็ค"/"ประกันลูกหมาก" ใน WarrantySection.jsx ส่วน "ประกันอื่นๆ" ครอบคลุม
// รายการที่เหลือทั้งหมดที่ไม่ตรงทั้งสองคำนี้
export const RACK_KEYWORDS = ['แร็ค'];
export const BALL_JOINT_KEYWORDS = ['ลูกหมาก'];
export const ALL_WARRANTY_KEYWORDS = [...RACK_KEYWORDS, ...BALL_JOINT_KEYWORDS];

// ผูกประกันที่เลือกจาก dropdown เข้ากับรายการที่ชื่อตรงคำที่กำหนด — isOther=true
// หมายถึง "รายการที่เหลือทั้งหมดที่ไม่ตรงทั้งแร็คและลูกหมาก" เลือก "ไม่มี" (warrantyId
// ว่าง) จะล้างค่าประกันของรายการที่ตรงเงื่อนไขนั้นทิ้ง — nameField ต่างกันระหว่างฟอร์ม
// ใบเสนอราคา (product_name) กับใบเสร็จ (product_name_snapshot)
export function applyWarrantyToItems(items, warranties, keywords, warrantyId, isOther, nameField) {
  const warranty = warranties.find((w) => String(w.id) === warrantyId);
  return items.map((item) => {
    const name = item[nameField] || '';
    let matches;
    if (isOther) {
      matches = name && !ALL_WARRANTY_KEYWORDS.some((kw) => name.includes(kw));
    } else {
      // ชื่อที่มีทั้งคำของแร็คและลูกหมากพร้อมกัน (เช่น "แร็คลูกหมาก...") กำกวมว่าจะ
      // ผูกกับ dropdown ไหน — เดิมเลือก dropdown ไหนทีหลังจะทับอีกอันเงียบ ๆ โดยไม่รู้ตัว
      // ตอนนี้ไม่ผูกอัตโนมัติให้ทั้งคู่เลย (ตกไปอยู่ใน "อื่นๆ" แทน) กันความกำกวมนี้
      const otherKeywords = ALL_WARRANTY_KEYWORDS.filter((kw) => !keywords.includes(kw));
      const matchesOwn = keywords.some((kw) => name.includes(kw));
      const matchesOther = otherKeywords.some((kw) => name.includes(kw));
      matches = matchesOwn && !matchesOther;
    }
    if (!matches) return item;
    return {
      ...item,
      warranty_name: warranty ? warranty.warranty_name : '',
      warranty_year: warranty ? warranty.warranty_year : 0,
      warranty_month: warranty ? warranty.warranty_month : 0,
      warranty_km: warranty ? warranty.warranty_km : 0,
    };
  });
}

// ตอนเปิดแก้ไขใบเดิม หา id ของแคตตาล็อกที่ตรงกับประกันที่บันทึกไว้แล้วในรายการที่ตรง
// เงื่อนไข เพื่อตั้งค่าเริ่มต้นของ dropdown ให้ตรงกับข้อมูลจริง — ถ้าไม่ทำแบบนี้ dropdown
// จะโชว์ "ไม่มี" เสมอทั้งที่จริงมีประกันอยู่แล้ว พอกดเลือก "ไม่มี" ซ้ำค่าเดิม (value ไม่
// เปลี่ยน) React จะไม่ยิง onChange ให้ กลายเป็นล้างค่าเดิมไม่ได้เลย (ค้างอยู่แบบนั้น)
export function findMatchingWarrantyId(items, warranties, keywords, isOther, nameField) {
  const match = items.find((item) => {
    const name = item[nameField] || '';
    if (!name || !item.warranty_name) return false;
    if (isOther) return !ALL_WARRANTY_KEYWORDS.some((kw) => name.includes(kw));
    // ชื่อที่ตรงทั้งสองคำพร้อมกัน (แร็ค+ลูกหมาก) ถือเป็น "อื่นๆ" เหมือนตอน apply —
    // กันดึงค่าประกันที่จริง ๆ ตั้งใจให้เป็น "อื่นๆ" มาโผล่ผิด dropdown ตอนเปิดแก้ไข
    const otherKeywords = ALL_WARRANTY_KEYWORDS.filter((kw) => !keywords.includes(kw));
    return keywords.some((kw) => name.includes(kw)) && !otherKeywords.some((kw) => name.includes(kw));
  });
  if (!match) return '';
  const found = warranties.find((w) =>
    w.warranty_name === match.warranty_name &&
    Number(w.warranty_year) === Number(match.warranty_year || 0) &&
    Number(w.warranty_month) === Number(match.warranty_month || 0) &&
    Number(w.warranty_km) === Number(match.warranty_km || 0)
  );
  return found ? String(found.id) : '';
}
