// คัดลอกข้อความลงคลิปบอร์ด — navigator.clipboard มีเฉพาะ secure context
// (HTTPS/localhost) เท่านั้น แต่พนักงานเปิดหน้าเว็บนี้บนมือถือผ่าน http://
// ในวงแลนของร้านด้วย ซึ่ง navigator.clipboard จะเป็น undefined ทั้งก้อน จึงต้อง
// มีทางสำรองแบบเก่า (textarea + execCommand) ไม่งั้นปุ่มคัดลอกจะพังเงียบ ๆ
// บนมือถือที่ใช้งานจริง
export async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // ตกไปใช้ทางสำรองด้านล่าง (เช่นโดนปฏิเสธสิทธิ์/ไม่มี user gesture)
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  // กันหน้าจอเลื่อน/กระพริบตอนแทรก element ชั่วคราว
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.setAttribute('readonly', '');
  document.body.appendChild(textarea);
  try {
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

// ตัวเลขในข้อความไลน์เขียนแบบเรียบ ๆ ไม่มีคอมมา และตัด .00 ทิ้งถ้าเป็นจำนวนเต็ม
// (ตามรูปแบบที่ร้านพิมพ์กันจริงในไลน์ เช่น "แร็คบิลด์รวมเทิร์น 6500") — ต่างจาก
// formatMoney ที่ใช้ในเอกสาร A4 ซึ่งต้องมีคอมมาและทศนิยม 2 ตำแหน่งเสมอ
function formatPlainAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// dd/mm/yy พ.ศ. (2 หลัก) — ใช้กับข้อความคัดลอกไปวางในไลน์ ตามฟอร์แมตที่ร้านใช้จริง
function formatThaiDateShort(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String((d.getFullYear() + 543) % 100).padStart(2, '0');
  return `${dd}/${mm}/${yy}`;
}

// สร้างข้อความสำเร็จรูปสำหรับคัดลอกไปวางในไลน์ — ตามฟอร์แมตที่ร้านใช้จริง
// (ชื่อ label สะกดตามที่ร้านใช้เป๊ะๆ เช่น "เบอโทรศัพท์"/"เลขไมค์" ไม่ใช่การพิมพ์ผิด)
export function buildLineQuoteText(quotation) {
  const items = quotation.items || [];
  const itemLines = items.map((it) => {
    const name = it.product_name || it.product_name_snapshot || '';
    const qty = Number(it.quantity ?? it.qty ?? 1);
    const price = Number(it.unit_price ?? it.price ?? 0);
    const amount = qty * price;
    const label = qty > 1 ? `${name} x${qty}` : name;
    // แถวย่อยของ "ชุดโปร" ตั้งใจไม่ใส่ราคา (ราคารวมอยู่ที่บรรทัดชื่อชุดแล้ว) —
    // ไม่ต้องพิมพ์เลข 0 ต่อท้ายให้รกตา ปล่อยเป็นชื่อรายการเปล่า ๆ
    return amount > 0 ? `${label} ${formatPlainAmount(amount)}` : label;
  });

  const totalAmount = Number(
    quotation.total_amount ??
      items.reduce((sum, it) => sum + Number(it.quantity ?? it.qty ?? 0) * Number(it.unit_price ?? it.price ?? 0), 0)
  );
  const depositAmount = quotation.deposit_amount != null && quotation.deposit_amount !== ''
    ? Number(quotation.deposit_amount)
    : null;

  const lines = [
    `คิว ${quotation.queue_no || ''}`,
    formatThaiDateShort(quotation.quotation_date),
    `ชื่อ:${quotation.customer_name || ''}`,
    `เบอโทรศัพท์:${quotation.phone || ''}`,
    `ยี่ห้อรถ:${quotation.brand || quotation.car_brand || ''}`,
    `รุ่นรถ:${quotation.model || quotation.car_model || ''}`,
    `ทะเบียนรถ:${quotation.license_plate || ''}`,
    `สีรถ:${quotation.color || quotation.car_color || ''}`,
    `เลขไมค์:${quotation.mileage || quotation.vehicle_mileage || ''}`,
    `อาการ:${quotation.symptom || ''}`,
    'รายการ:',
    ...itemLines,
    '',
    '<--สิ้นสุดรายการ-->',
    `ยอดรวม:${totalAmount ? formatPlainAmount(totalAmount) : ''}`,
    `มัดจำ:${depositAmount ? formatPlainAmount(depositAmount) : ''}`,
    `วันที่มัดจำ:${formatThaiDateShort(quotation.deposit_date)}`,
    // "ยอดที่ต้องชำระ" ถูกแทนที่ด้วย "วันนัดหมาย" ในเทมเพลตปัจจุบันของบอทแล้ว (ยอดค้าง
    // ชำระบอทคำนวณเองจาก total_amount - deposit_amount ไม่ต้องพิมพ์ — ดู
    // backend/src/utils/parseLineQueueMessage.js PAYMENT_LABELS) เดิมข้อความคัดลอกจาก
    // ที่นี่ยังพิมพ์ label เก่าอยู่ ทำให้บอทอ่านไม่รู้จักบรรทัดนี้เลย (ข้ามเงียบ ๆ ทิ้ง)
    `วันนัดหมาย:${formatThaiDateShort(quotation.scheduled_date)}`,
    `หมายเหตุ:${quotation.remark || ''}`,
    '',
    '<--ลูกค้าชำระเงิน-->',
    'ช่องทางการชำระ (โอน/บัตรเครดิต/เงินสด/QRCode):',
    'ลูกค้าชำระเงิน (ยอดที่ได้รับจริง):',
  ];

  return lines.join('\n');
}
