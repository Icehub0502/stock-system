// แยกข้อความ "คิวรถเข้า" จากไลน์กลุ่มของร้าน ให้กลายเป็นข้อมูลใบเสนอราคา
//
// รูปแบบหลักที่ร้านพิมพ์จริง (ไม่มี label/โคลอนเลย — จำแนกจาก "หน้าตา" แต่ละ
// บรรทัด ไม่ใช่ตำแหน่ง):
//   คิวที่10                 ← "คิว"/"คิวที่" ตามด้วยเลขคิวติดกันหรือเว้นวรรคก็ได้
//   16/7/69                 ← มีวันที่แยกบรรทัดก็ได้ (ไม่ถูกใช้ ดูด้านล่าง)
//   คุณ เอกชัย
//   081-827-5255
//   Toyota Harrier
//   กว 6066
//   อาการ เลี้ยวติดตัวถัง
//   แร็ค OEM 5000
//   ชุดโปรช่วงล่างเก๋ง 7500
//   ซ่อมคอ 2000
//
// การจำแนกหัวข้อมูล: "คิว"/"คิวที่" ต้นบรรทัดแรกเสมอ (เลขคิวคือตัวที่ตามมา),
// บรรทัดวันที่เดี่ยว ๆ (dd/mm/yy) ไม่ถูกใช้ทิ้งไปเลย, เบอร์โทร/ทะเบียนจากรูปแบบ
// ตัวเลข, ขึ้นต้น "คุณ" → ชื่อลูกค้า, มีอักษรละตินไม่ลงท้ายด้วยราคา → ยี่ห้อ+รุ่นรถ
// (คำแรก=ยี่ห้อ ที่เหลือ=รุ่น), "อาการ ..." (โคลอนมีไม่มีก็ได้) → อาการ
//
// รายการสินค้า: ไม่ต้องมีคำว่า "รายการ:" นำหน้าก็ได้ — พอมีชื่อลูกค้าแล้ว บรรทัด
// ไหนที่ไม่เข้าพวกหัวข้อมูลด้านบนและลงท้ายด้วยราคา (เลข ≥3 หลัก) ถือว่าเป็นจุด
// เริ่มรายการสินค้าโดยอัตโนมัติ ทุกบรรทัดตั้งแต่นั้นเป็นรายการทั้งหมด (จะพิมพ์
// "รายการ:" นำหน้าเองก็ยังรองรับอยู่เหมือนเดิม) ราคาไม่ครบทุกบรรทัดก็ได้ — ชื่อ
// ไม่มีราคาต่อท้าย แล้วบรรทัดถัดไปเป็นตัวเลขล้วน จะรวมเป็นรายการเดียวกัน
// ("เพิ่มเติม รายการโช็ค 4ต้น" ตามด้วย "15500")
//
// บรรทัดรายการที่ดูเป็นข้อความโปรโมทที่คัดลอกมาทั้งย่อหน้า (ยาวมาก/มีช่องว่าง
// รัว ๆ/มีอิโมจิ เช่น "ชุดโปร ช่วงล่าง    👍สินค้าประกัน...🛠️...รวมตั้งศูนย์7500")
// จะไม่ถูกตีเป็นรายการ (เดาชื่อ/ราคาจากก้อนข้อความแบบนี้ผิดง่าย) แต่เก็บข้อความ
// เต็มไว้ในหมายเหตุแทน ให้หน้างานอ่านแล้วพิมพ์รายการที่แท้จริงเองสั้น ๆ เช่น
// "ชุดโปรช่วงล่างเก๋ง 7500" — ทุกรายการที่พาร์สได้จะถูกจับคู่กับแคตาล็อกสินค้า/
// บริการในระบบเสมอ (ดู lineWebhook.routes.js) เพื่อดึงชื่อ/ประกันมาตรฐานมาใส่ —
// ราคาใช้ตัวที่พิมพ์มาเท่านั้น ไม่มีราคาในข้อความ = 0 เสมอ (ไม่เดาราคาจากแคตาล็อก
// ให้หน้างานกรอกเองทีหลัง)
//
// บรรทัด "รวม xxxxx" ในรายการไม่ใช่รายการ — เก็บเป็นยอดรวมที่ร้านแจ้งมาเอง
// (stated_total) ให้ webhook เทียบกับผลรวมที่คำนวณจริงแล้วเตือนถ้าไม่ตรง ไม่มี
// บรรทัดนี้ก็ไม่เป็นไร ระบบคำนวณเองอยู่แล้ว
//
// ยังรองรับ label ชัดเจนแบบมีโคลอนด้วย (เผื่อร้านพิมพ์แบบนี้บางครั้ง) — บรรทัดที่
// ขึ้นต้นด้วย "ชื่อลูกค้า"/"เบอร์โทร"/"เบอโทร"/"ยี่ห้อรถ"/"รุ่นรถ"/"ทะเบียนรถ"/
// "อาการ"/"หมายเหตุ" (โคลอนมีหรือไม่มีก็ได้) จะใช้ label นั้นแทนการเดาจากหน้าตา —
// "ยี่ห้อรถ:Honda รุ่นรถ:Civic" บรรทัดเดียวกันก็ตัดถูกจุด และ "รายการ:" เป็นจุด
// เริ่มรายการแบบระบุชัดเจนก็ยังใช้ได้เหมือนเดิม
//
// คืน null ถ้าบรรทัดแรกไม่ขึ้นต้นด้วย "คิว" หรือไม่มีชื่อลูกค้า — ผู้เรียก (LINE
// webhook) จะข้ามข้อความนั้นเงียบ ๆ เพราะในกลุ่มมีแชตเรื่องอื่นปนอยู่

const PLATE_RE = /^\d?[ก-ฮ]{1,3}\s?\d{1,4}$/;
const BARE_DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
const PRICED_LINE_RE = /[\d,]{3,}\s*(?:บาท)?\s*$/;
const ITEM_SECTION_TRIGGER_RE = /^รายการ\s*:*\s*$/;
const IGNORED_LINE_RE = /^วันที่\b/; // ร้านบางทีพิมพ์วันที่มาด้วย ไม่ใช้ ไม่งั้นหลุดไปปนกับอาการ
// ช่องว่างยาว 3+ ตัว หรืออิโมจิ = สัญญาณว่าเป็นข้อความโปรโมทคัดลอกมาทั้งย่อหน้า
// ไม่ใช่ชื่อรายการจริง ("ชุดโปร ช่วงล่าง    👍...🛠️...")
const DECORATED_LINE_RE = /\s{3,}|[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
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

// บรรทัดในรายการ — ตัดเครื่องหมายหัวข้อ (-, •, ·) และคำ "เพิ่มเติม" นำหน้าทิ้งก่อน
function cleanItemName(raw) {
  return raw.trim().replace(/^[-•·]\s*/, '').replace(/^เพิ่มเติม\s*/, '').trim();
}

// แยกรายการสินค้า: ชื่อ+ราคาบรรทัดเดียวกันก็ได้ หรือชื่อบรรทัดหนึ่งแล้วราคา
// (ตัวเลขล้วน) บรรทัดถัดไปก็ได้ ไม่มีราคาเลยจนจบก็ยังเป็นรายการอยู่ (price: null)
// ให้ตอนแมตช์แคตาล็อกไปหาราคามาใส่ — บรรทัดที่ดูเป็นข้อความโปรโมทคัดลอกมาทั้งก้อน
// (ยาว/ช่องว่างรัว/มีอิโมจิ) ไม่ถูกตีเป็นรายการ ไปอยู่ในหมายเหตุแทน
function parseItemSectionLines(lines) {
  const items = [];
  const notes = [];
  let statedTotal = null;
  let pendingName = null;

  const flushPending = () => {
    if (pendingName) {
      items.push({ name: pendingName, price: null });
      pendingName = null;
    }
  };

  for (const rawLine of lines) {
    const trimmedRaw = rawLine.trim();
    if (!trimmedRaw) continue;

    if (DECORATED_LINE_RE.test(trimmedRaw)) {
      flushPending();
      notes.push(trimmedRaw);
      continue;
    }

    const line = cleanItemName(trimmedRaw);
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

  return { items, statedTotal, notes };
}

function parseLineQueueMessage(text) {
  if (!text || typeof text !== 'string') return null;

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || !/^คิว/.test(lines[0])) return null;

  // "คิว 2", "คิวที่10", "คิว:2", "คิว 1 17/07/26" (วันที่ต่อท้ายไม่ถูกใช้) ล้วนอ่านได้
  const queueMatch = /^คิว(?:ที่)?\s*:*\s*(\S+)/.exec(lines[0]);
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

    if (IGNORED_LINE_RE.test(line) || BARE_DATE_RE.test(line)) continue; // วันที่ — ไม่ใช้ ไม่งั้นหลุดไปปนกับอาการ

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
    if (!result.brand && /[A-Za-z]/.test(line) && !PRICED_LINE_RE.test(line)) {
      const parts = line.split(/\s+/);
      result.brand = parts[0];
      result.model = parts.slice(1).join(' ') || null;
      continue;
    }

    // ไม่เข้าพวกหัวข้อมูลด้านบนเลย แล้วลงท้ายด้วยราคา + มีชื่อลูกค้าแล้ว = เริ่ม
    // รายการสินค้าโดยอัตโนมัติ ไม่ต้องมี "รายการ:" นำหน้า (ร้านมักพิมพ์ต่อท้าย
    // ข้อมูลหัวบิลมาเลย) — ต้องมีชื่อลูกค้าก่อนกันไปชนกับ Pattern 1 (แจ้งอาการ
    // เฉย ๆ ไม่มีรายการ ซึ่งบรรทัดสุดท้ายมักไม่มีราคาต่อท้ายอยู่แล้ว)
    if (result.customer_name && PRICED_LINE_RE.test(line)) {
      itemSectionStartIndex = i;
      break;
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
    const { items, statedTotal, notes } = parseItemSectionLines(lines.slice(itemSectionStartIndex));
    result.items = items;
    result.stated_total = statedTotal;
    if (notes.length > 0) {
      result.remark = result.remark ? `${result.remark}\n${notes.join('\n')}` : notes.join('\n');
    }
  }

  if (!result.customer_name) return null;
  return result;
}

module.exports = parseLineQueueMessage;
