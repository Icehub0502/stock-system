// แยกข้อความ "คิวรถเข้า" จากไลน์กลุ่มของร้าน ให้กลายเป็นข้อมูลใบเสนอราคา
//
// รูปแบบข้อความที่ร้านใช้ (ลำดับบรรทัดสลับกันได้ ยกเว้นบรรทัดแรกต้องขึ้นต้น "คิว"):
//   คิว 1
//   คุณพงศ์
//   089-485-1623
//   Toyota Yaris
//   9กธ7833
//   เช็คช่วงล่าง
//
// การจำแนกใช้ "หน้าตา" ของแต่ละบรรทัด ไม่ใช่ตำแหน่ง:
//   - เบอร์โทร  : ตัดขีด/ช่องว่างแล้วเป็น 0 ตามด้วยเลข 8-9 หลัก
//   - ทะเบียนรถ : [เลขนำ 0-1 ตัว][อักษรไทย 1-3 ตัว][เลข 1-4 ตัว] เช่น 9กธ7833, ฮย3371
//   - ชื่อลูกค้า : ขึ้นต้นด้วย "คุณ" (ถ้าไม่มี ใช้บรรทัดแรกที่จำแนกไม่ได้แทน)
//   - ยี่ห้อ/รุ่น : บรรทัดที่มีตัวอักษรละติน (Toyota Yaris → brand=Toyota, model=Yaris)
//   - ที่เหลือ   : รวมเป็น "อาการ"
//
// คืน null ถ้าไม่ใช่ข้อความคิว (ไม่ขึ้นต้น "คิว") หรือไม่มีชื่อลูกค้าให้ใช้ —
// ผู้เรียก (LINE webhook) จะข้ามข้อความนั้นเงียบ ๆ เพราะในกลุ่มมีแชตเรื่องอื่นปนอยู่
function parseLineQueueMessage(text) {
  if (!text || typeof text !== 'string') return null;

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || !/^คิว/.test(lines[0])) return null;

  const result = {
    queue_no: lines[0].replace(/^คิว\s*/, '').trim() || null,
    customer_name: null,
    phone: null,
    brand: null,
    model: null,
    license_plate: null,
    symptom: null,
  };

  const leftovers = [];
  for (const line of lines.slice(1)) {
    const digitsOnly = line.replace(/[-\s]/g, '');
    if (!result.phone && /^0\d{8,9}$/.test(digitsOnly)) {
      result.phone = digitsOnly;
      continue;
    }
    if (!result.license_plate && /^\d?[ก-ฮ]{1,3}\s?\d{1,4}$/.test(line)) {
      result.license_plate = line.replace(/\s+/g, '');
      continue;
    }
    if (!result.customer_name && /^คุณ/.test(line)) {
      result.customer_name = line;
      continue;
    }
    if (!result.brand && /[A-Za-z]/.test(line)) {
      const parts = line.split(/\s+/);
      result.brand = parts[0];
      result.model = parts.slice(1).join(' ') || null;
      continue;
    }
    leftovers.push(line);
  }

  // ไม่มีบรรทัด "คุณ..." → ถือว่าบรรทัดแรกที่เหลือคือชื่อ (เช่น "พี่ต้น")
  if (!result.customer_name && leftovers.length > 0) {
    result.customer_name = leftovers.shift();
  }
  if (leftovers.length > 0) {
    result.symptom = leftovers.join(' ');
  }

  if (!result.customer_name) return null;
  return result;
}

module.exports = parseLineQueueMessage;
