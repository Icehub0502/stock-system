// แยกข้อความ "คิวรถเข้า" จากไลน์กลุ่มของร้าน ให้กลายเป็นข้อมูลใบเสนอราคา
//
// รูปแบบหลักที่ร้านพิมพ์จริง (ไม่มี label/โคลอนเลย — จำแนกจาก "หน้าตา" แต่ละ
// บรรทัด ไม่ใช่ตำแหน่ง):
//   คิว 2
//   คุณนอก
//   085-111-9565
//   Honda Accord G8
//   9กก4444
//   เช็คช่วงล่าง
//
//   คิว 1 17/07/26          ← มีวันที่ต่อท้ายก็ได้ (ไม่ถูกใช้ ดูด้านล่าง)
//   คุณศิริลักษณ์
//   092-241-9198
//   Honda civic FC
//   1ขพ2886
//   ที่งเปลี่ยนโช้คหลังมา มีอาการเสียงดังข้างหลัง
//
// การจำแนกหัวข้อมูล: "คิว..." ต้นบรรทัดแรกเสมอ (ตัวเลขต่อจาก "คิว" คือเลขคิว
// ส่วนวันที่ต่อท้ายถ้ามีไม่ถูกใช้ — ใบเสนอราคาใช้วันที่สร้างจริงของระบบเสมอ),
// เบอร์โทร/ทะเบียนจากรูปแบบตัวเลข, ขึ้นต้น "คุณ" → ชื่อลูกค้า, มีอักษรละตินไม่ลง
// ท้ายด้วยราคา → ยี่ห้อ+รุ่นรถ (คำแรก=ยี่ห้อ ที่เหลือ=รุ่น), ที่เหลือทั้งหมดรวม
// เป็น "อาการ"
//
// ยังรองรับ label ชัดเจนแบบมีโคลอนด้วย (เผื่อร้านพิมพ์แบบนี้บางครั้ง) — บรรทัดที่
// ขึ้นต้นด้วย "ยี่ห้อรถ"/"รุ่นรถ"/"ทะเบียนรถ"/"อาการ"/"หมายเหตุ" (โคลอนมีหรือไม่มีก็
// ได้) จะใช้ label นั้นแทนการเดาจากหน้าตา — "ยี่ห้อรถ:Honda รุ่นรถ:Civic" บรรทัด
// เดียวกันก็ตัดถูกจุด
//
// "รายการ" (มีโคลอนหรือไม่มีก็ได้ ไม่ต้องมีเนื้อหาต่อท้ายบรรทัดเดียวกัน) เป็นจุด
// เริ่ม section รายการสินค้า — ทุกบรรทัดหลังจากนี้ถือว่าเป็นรายการเจตนาจริง จนจบ
// ข้อความ:
//   รายการ:
//    - แร็ค OEM  5000
//    - ค่าแรง 2000
//    - ชุดโปรช่วงล่าง เก๋ง 6000
//   เพิ่มเติม รายการโช็ค 4ต้น
//   15500
//   รวม 23000
// บรรทัดขึ้นต้นด้วย "-"/"•" ตัดเครื่องหมายทิ้งก่อนอ่านชื่อ, ชื่อกับราคาคนละบรรทัด
// (ชื่อไม่มีเลขท้ายบรรทัด แล้วบรรทัดถัดไปเป็นตัวเลขล้วน) จะรวมเป็นรายการเดียวกัน
// ทุกรายการจะถูกจับคู่กับแคตาล็อกสินค้า/บริการในระบบเสมอ (ดู lineWebhook.routes.js)
// เพื่อดึงชื่อ/ประกันมาตรฐานมาใส่ — ราคาใช้ตัวที่พิมพ์มาถ้ามี ไม่มีค่อยใช้ราคา
// ของแคตาล็อก (เช่น ราคาชุดของ "ชุดโปรช่วงล่างเก๋ง") บรรทัด "รวม xxxxx" ไม่ใช่
// รายการ — เก็บเป็นยอดรวมที่ร้านแจ้งมาเอง (stated_total) ให้ webhook เทียบกับ
// ผลรวมที่คำนวณจริงแล้วเตือนถ้าไม่ตรง ไม่มีบรรทัดนี้ก็ไม่เป็นไร ระบบคำนวณเองอยู่แล้ว
//
// คืน null ถ้าบรรทัดแรกไม่ขึ้นต้นด้วย "คิว" หรือไม่มีชื่อลูกค้า — ผู้เรียก (LINE
// webhook) จะข้ามข้อความนั้นเงียบ ๆ เพราะในกลุ่มมีแชตเรื่องอื่นปนอยู่

const PLATE_RE = /^\d?[ก-ฮ]{1,3}\s?\d{1,4}$/;
const ITEM_SECTION_TRIGGER_RE = /^รายการ\s*:*\s*$/;
const IGNORED_LINE_RE = /^วันที่\b/; // ร้านบางทีพิมพ์วันที่มาด้วย ไม่ใช้ ไม่งั้นหลุดไปปนกับอาการ
const OPTIONAL_LABELS = {
  ชื่อลูกค้า: 'customer_name',
  เบอร์โทร: 'phone',
  เบอโทร: 'phone',
  ยี่ห้อรถ: 'brand',
  รุ่นรถ: 'model',
  ทะเบียนรถ: 'license_plate',
  อาการ: 'symptom',
  หมายเหตุ: 'remark',
};
const OPTIONAL_LABEL_RE = new RegExp(`^(${Object.keys(OPTIONAL_LABELS).join('|')})\\s*:*\\s*(.*)$`);

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// บรรทัดในเซคชัน "รายการ" — ตัดเครื่องหมายหัวข้อ (-, •, ·) และคำ "เพิ่มเติม"
// นำหน้าทิ้งก่อน
function cleanItemName(raw) {
  return raw.trim().replace(/^[-•·]\s*/, '').replace(/^เพิ่มเติม\s*/, '').trim();
}

// แยกเซคชันรายการ: ชื่อ+ราคาบรรทัดเดียวกันก็ได้ หรือชื่อบรรทัดหนึ่งแล้วราคา
// (ตัวเลขล้วน) บรรทัดถัดไปก็ได้ (ร้านบางทีพิมพ์ "เพิ่มเติม ชื่อ..." แล้วราคาคนละ
// บรรทัด) ไม่มีราคาเลยจนจบ section ก็ยังเป็นรายการอยู่ (price: null) ให้ตอนแมตช์
// แคตาล็อกไปหาราคามาตรฐานมาใส่แทน (เช่น ชุดที่ไม่ได้ระบุราคาในข้อความ)
function parseItemSectionLines(lines) {
  const items = [];
  let statedTotal = null;
  let pendingName = null;

  const flushPending = () => {
    if (pendingName) {
      items.push({ name: pendingName, price: null });
      pendingName = null;
    }
  };

  for (const rawLine of lines) {
    const line = cleanItemName(rawLine);
    if (!line) continue;

    const totalMatch = /^รวม\s*:*\s*([\d,]+)\s*(?:บาท)?\s*$/.exec(line);
    if (totalMatch) {
      flushPending();
      statedTotal = Number(totalMatch[1].replace(/,/g, '')); // ตัวสุดท้ายชนะ = ยอดรวมทั้งบิล
      continue;
    }

    // บรรทัดตัวเลขล้วน = ราคาของรายการชื่อบรรทัดก่อนหน้าที่ยังไม่มีราคา
    if (/^[\d,]+\s*(?:บาท)?$/.test(line)) {
      if (pendingName) {
        items.push({ name: pendingName, price: Number(line.replace(/[^\d]/g, '')) });
        pendingName = null;
      }
      // ไม่มีรายการค้างรอราคาอยู่ก่อนหน้า = ตัวเลขลอย ๆ ไม่รู้ของอะไร ไม่เดา ข้ามไป
      continue;
    }

    flushPending();
    const m = /^(.*?)[\s]*([\d,]+)\s*(?:บาท)?$/.exec(line);
    if (m && m[1].trim()) {
      items.push({ name: m[1].trim(), price: Number(m[2].replace(/,/g, '')) });
    } else {
      pendingName = line;
    }
  }
  flushPending();

  return { items, statedTotal };
}

function parseLineQueueMessage(text) {
  if (!text || typeof text !== 'string') return null;

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || !/^คิว/.test(lines[0])) return null;

  // "คิว 2", "คิว2", "คิว:2", "คิว 1 17/07/26" (วันที่ต่อท้ายไม่ถูกใช้) ล้วนอ่านได้
  const queueMatch = /^คิว\s*:*\s*(\S+)/.exec(lines[0]);
  const queue_no = queueMatch ? queueMatch[1] : null;

  const result = {
    queue_no,
    quotation_date: todayStr(), // ไม่ใช้วันที่ที่พิมพ์มาในข้อความ — ระบบตั้งวันที่สร้างจริงเสมอ
    customer_name: null,
    phone: null,
    brand: null,
    model: null,
    license_plate: null,
    symptom: null,
    remark: null,
    items: [],
    stated_total: null,
  };

  const leftovers = [];
  let itemSectionStartIndex = -1;

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];

    if (ITEM_SECTION_TRIGGER_RE.test(line)) {
      itemSectionStartIndex = i + 1;
      break; // ทุกอย่างหลังจากนี้เป็นรายการสินค้าล้วน ๆ ไม่จำแนกฟิลด์อื่นต่อ
    }

    if (IGNORED_LINE_RE.test(line)) continue; // "วันที่:..." — ไม่ใช้ ไม่งั้นหลุดไปปนกับอาการ

    // label ชัดเจนแบบมีโคลอนหรือไม่มีก็ได้ — "ยี่ห้อรถ:Honda รุ่นรถ:Civic" บรรทัด
    // เดียวกันก็ตัดถูกจุด (แมตช์ "ยี่ห้อรถ" ก่อน แล้วเช็ค "รุ่นรถ" ในเนื้อความที่เหลือ)
    const labelMatch = OPTIONAL_LABEL_RE.exec(line);
    if (labelMatch) {
      const [, label, rest] = labelMatch;
      if (label === 'ยี่ห้อรถ') {
        const modelSplit = /^(.*?)\s*รุ่นรถ\s*:*\s*(.*)$/.exec(rest);
        if (modelSplit) {
          result.brand = modelSplit[1].trim() || null;
          result.model = modelSplit[2].trim() || null;
        } else {
          result.brand = rest.trim() || null;
        }
      } else {
        const field = OPTIONAL_LABELS[label];
        let value = rest.trim();
        if (field === 'phone') value = value.replace(/\D/g, '');
        if (field === 'license_plate') value = value.replace(/\s+/g, '');
        result[field] = value || null;
      }
      continue;
    }

    const digitsOnly = line.replace(/[-\s]/g, '');
    if (!result.phone && /^0\d{8,9}$/.test(digitsOnly)) {
      result.phone = digitsOnly;
      continue;
    }
    if (!result.license_plate && PLATE_RE.test(line)) {
      result.license_plate = line.replace(/\s+/g, '');
      continue;
    }
    if (!result.customer_name && /^คุณ/.test(line)) {
      result.customer_name = line;
      continue;
    }
    if (!result.brand && /[A-Za-z]/.test(line) && !/[\d,]{3,}\s*(?:บาท)?\s*$/.test(line)) {
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
  if (!result.symptom && leftovers.length > 0) {
    result.symptom = leftovers.join(' ');
  }

  if (itemSectionStartIndex >= 0) {
    const { items, statedTotal } = parseItemSectionLines(lines.slice(itemSectionStartIndex));
    result.items = items;
    result.stated_total = statedTotal;
  }

  if (!result.customer_name) return null;
  return result;
}

module.exports = parseLineQueueMessage;
