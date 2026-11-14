// ใช้ร่วมกันระหว่างใบเสนอราคา/ใบเสร็จ — คำที่ใช้จับคู่ชื่อรายการกับช่อง dropdown
// "ประกันแร็ค"/"ประกันลูกหมาก" ใน WarrantySection.jsx ส่วน "ประกันอื่นๆ" ครอบคลุม
// รายการที่เหลือทั้งหมดที่ไม่ตรงทั้งสองคำนี้
export const RACK_KEYWORDS = ['แร็ค', 'rack'];
export const BALL_JOINT_KEYWORDS = ['ลูกหมาก'];
export const ALL_WARRANTY_KEYWORDS = [...RACK_KEYWORDS, ...BALL_JOINT_KEYWORDS];

// Names are typed by hand, so the same word comes with different marks: "แร็ค", "แร๊ค", "แร้ค", "แรค". Matching drops
// the marks above the letters (ไม้ไต่คู้ and the tone marks, U+0E47–U+0E4C) on both sides and ignores case; a plain
// includes() missed "แร๊ค OEM" and the rack warranty picked for it was silently not saved.
const bare = (text) => String(text ?? '').toLowerCase().replace(/[็-์]/g, '');

// true when the name contains one of the keywords, whatever marks or case it was typed with
export function nameHasKeyword(name, keywords) {
  const n = bare(name);
  return keywords.some((kw) => n.includes(bare(kw)));
}

// The rack and ball joint warranties the printout shows (the first row naming each). A set (ชุดโปรช่วงล่าง) gives every
// sub-row the same warranty, so rows like "ปีกนกล่าง" carry the ball joint warranty without the word ลูกหมาก: those rows
// belong to that warranty, not to "อื่นๆ" — the same rule as findWarrantySlotText in the print templates.
function keywordWarrantyNames(items, nameField) {
  return ALL_WARRANTY_KEYWORDS.map((kw) => items.find((item) => item.warranty_name && nameHasKeyword(item[nameField], [kw])))
    .filter(Boolean)
    .map((item) => item.warranty_name);
}

// a row of "อื่นๆ": its name has neither keyword, and it does not carry the rack or ball joint warranty
function isOtherRow(item, nameField, setNames) {
  const name = item[nameField] || '';
  return Boolean(name) && !nameHasKeyword(name, ALL_WARRANTY_KEYWORDS) && !setNames.includes(item.warranty_name);
}

// ผูกประกันที่เลือกจาก dropdown เข้ากับรายการที่ชื่อตรงคำที่กำหนด — isOther=true
// หมายถึง "รายการที่เหลือทั้งหมดที่ไม่ตรงทั้งแร็คและลูกหมาก" เลือก "ไม่มี" (warrantyId
// ว่าง) จะล้างค่าประกันของรายการที่ตรงเงื่อนไขนั้นทิ้ง — nameField ต่างกันระหว่างฟอร์ม
// ใบเสนอราคา (product_name) กับใบเสร็จ (product_name_snapshot)
export function applyWarrantyToItems(items, warranties, keywords, warrantyId, isOther, nameField) {
  const warranty = warranties.find((w) => String(w.id) === warrantyId);
  const setNames = isOther ? keywordWarrantyNames(items, nameField) : [];
  return items.map((item) => {
    const name = item[nameField] || '';
    let matches;
    if (isOther) {
      matches = isOtherRow(item, nameField, setNames);
    } else {
      // ชื่อที่มีทั้งคำของแร็คและลูกหมากพร้อมกัน (เช่น "แร็คลูกหมาก...") กำกวมว่าจะ
      // ผูกกับ dropdown ไหน — เดิมเลือก dropdown ไหนทีหลังจะทับอีกอันเงียบ ๆ โดยไม่รู้ตัว
      // ตอนนี้ไม่ผูกอัตโนมัติให้ทั้งคู่เลย (ตกไปอยู่ใน "อื่นๆ" แทน) กันความกำกวมนี้
      const otherKeywords = ALL_WARRANTY_KEYWORDS.filter((kw) => !keywords.includes(kw));
      const matchesOwn = nameHasKeyword(name, keywords);
      const matchesOther = nameHasKeyword(name, otherKeywords);
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
  return slotWarranty(items, warranties, keywords, isOther, nameField).id;
}

// The warranty the items of one dropdown carry right now: { id, name }. id is the catalog entry it matches, or '' when
// the warranty came from somewhere else (a product's own warranty, a catalog entry since changed); name is '' when no
// item of that dropdown has a warranty.
export function slotWarranty(items, warranties, keywords, isOther, nameField) {
  const setNames = isOther ? keywordWarrantyNames(items, nameField) : [];
  const match = items.find((item) => {
    const name = item[nameField] || '';
    if (!name || !item.warranty_name) return false;
    if (isOther) return isOtherRow(item, nameField, setNames);
    // ชื่อที่ตรงทั้งสองคำพร้อมกัน (แร็ค+ลูกหมาก) ถือเป็น "อื่นๆ" เหมือนตอน apply —
    // กันดึงค่าประกันที่จริง ๆ ตั้งใจให้เป็น "อื่นๆ" มาโผล่ผิด dropdown ตอนเปิดแก้ไข
    const otherKeywords = ALL_WARRANTY_KEYWORDS.filter((kw) => !keywords.includes(kw));
    return nameHasKeyword(name, keywords) && !nameHasKeyword(name, otherKeywords);
  });
  if (!match) return { id: '', name: '' };
  const found = warranties.find((w) =>
    w.warranty_name === match.warranty_name &&
    Number(w.warranty_year) === Number(match.warranty_year || 0) &&
    Number(w.warranty_month) === Number(match.warranty_month || 0) &&
    Number(w.warranty_km) === Number(match.warranty_km || 0)
  );
  return { id: found ? String(found.id) : '', name: match.warranty_name };
}

// Whether any row of the bill belongs to this dropdown — a warranty picked for a dropdown without rows is saved
// nowhere, so the form warns about it instead of letting it look saved.
export function slotHasRows(items, keywords, isOther, nameField) {
  return items.some((item) => {
    const name = item[nameField] || '';
    if (!name) return false;
    if (isOther) return !nameHasKeyword(name, ALL_WARRANTY_KEYWORDS);
    const otherKeywords = ALL_WARRANTY_KEYWORDS.filter((kw) => !keywords.includes(kw));
    return nameHasKeyword(name, keywords) && !nameHasKeyword(name, otherKeywords);
  });
}

// At save time: give the warranty chosen in each dropdown to the rows of that dropdown that still have none. A choice
// is attached to rows only when the dropdown changes, so a rack row added (or renamed to "แร็ค…") after the warranty
// was picked went out without it while the dropdown still showed it. Rows that already carry a warranty (a product's
// own, or one set by the dropdown) are left as they are; an empty choice ("ไม่มี") fills nothing.
// chosen: { rack, ballJoint, other } catalog ids as the dropdown state holds them
export function fillChosenWarranties(items, warranties, chosen, nameField) {
  const slots = [
    { id: chosen.rack, keywords: RACK_KEYWORDS, isOther: false },
    { id: chosen.ballJoint, keywords: BALL_JOINT_KEYWORDS, isOther: false },
    { id: chosen.other, keywords: ALL_WARRANTY_KEYWORDS, isOther: true },
  ];
  let result = items;
  for (const slot of slots) {
    const warranty = slot.id ? warranties.find((w) => String(w.id) === String(slot.id)) : null;
    if (!warranty) continue;
    const setNames = slot.isOther ? keywordWarrantyNames(result, nameField) : [];
    const otherKeywords = ALL_WARRANTY_KEYWORDS.filter((kw) => !slot.keywords.includes(kw));
    result = result.map((item) => {
      if (item.warranty_name) return item;
      const name = item[nameField] || '';
      const belongs = slot.isOther
        ? isOtherRow(item, nameField, setNames)
        : Boolean(name) && nameHasKeyword(name, slot.keywords) && !nameHasKeyword(name, otherKeywords);
      if (!belongs) return item;
      return {
        ...item,
        warranty_name: warranty.warranty_name,
        warranty_year: warranty.warranty_year,
        warranty_month: warranty.warranty_month,
        warranty_km: warranty.warranty_km,
      };
    });
  }
  return result;
}
