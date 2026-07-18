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
//   ทอง                    ← สีรถ (มีหรือไม่มีก็ได้ จำจากคำสี "สี" นำหน้าได้)
//   215170                 ← เลขไมล์ (ตัวเลขล้วน 4-7 หลัก ก่อนเริ่มรายการสินค้า)
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
//
// ข้อความที่มีคำว่า "ชำระเงินเรียบร้อย"/"ชำระเงินแล้ว" ก็คืน null เช่นกัน — ร้านมัก
// ส่งข้อมูลคิวเดิมซ้ำพร้อมสรุปยอด/มัดจำ/ยอดค้างตอนลูกค้าจ่ายเงินเสร็จ ไม่ใช่คิวใหม่
// หรือรายการแก้ไขที่ควรสร้าง/อัปเดตใบเสนอราคา

const PLATE_RE = /^\d?[ก-ฮ]{1,3}\s?\d{1,4}$/;
// บรรทัดสีรถเดี่ยว ๆ ("ทอง", "สีขาว", "ขาวมุก", "บรอนซ์เงิน") — จำจากคำสีที่ใช้กัน
// จริงเท่านั้น กันไปกินบรรทัดอาการ/ชื่อ ("สี" นำหน้ามีหรือไม่มีก็ได้)
const COLOR_LINE_RE = /^(?:สี\s*)?(?:ขาว|ดำ|แดง|เทา|เงิน|ทอง|น้ำเงิน|ฟ้า|เขียว|เหลือง|ส้ม|น้ำตาล|ม่วง|ชมพู|บรอนซ์|ครีม|กรม|มุก)+$/;
// บรรทัดเลขไมล์เดี่ยว ๆ ("215170") — ตัวเลขล้วน 4-7 หลัก (มี , คั่นได้) ที่โผล่ก่อน
// เริ่มรายการสินค้า ไม่ใช่เบอร์โทร (เช็คเบอร์ก่อนหน้าแล้ว) ไม่ใช่ราคา (ราคาลอย ๆ
// ไม่มีชื่อรายการนำหน้าไม่เคยถูกตีความอยู่แล้ว)
const MILEAGE_LINE_RE = /^[\d,]{4,9}$/;
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
  สีรถ: 'color',
  เลขไมล์: 'mileage',
  เลขไมค์: 'mileage', // สะกดแบบที่ร้านพิมพ์จริง
  อาการ: 'symptom',
  หมายเหตุ: 'remark',
};
const OPTIONAL_LABEL_RE = new RegExp(`^(${Object.keys(OPTIONAL_LABELS).join('|')})\\s*:*\\s*(.*)$`);
// ข้อความแจ้งว่าชำระเงินแล้ว (ส่งซ้ำข้อมูลคิวเดิมพร้อมสรุปยอด/มัดจำ) — ไม่ใช่คิวใหม่
// หรือรายการแก้ไข บอทต้องไม่จับข้อความนี้เลย ปล่อยผ่านเงียบ ๆ
const PAID_MESSAGE_RE = /ชำระเงิน\s*(เรียบร้อย|แล้ว)/;
// คำปิดท้ายในรายการที่เป็นแค่ข้อความแจ้งคนในกลุ่ม ("ลูกค้าอนุมัติ") ไม่ใช่ชื่อสินค้า
const APPROVAL_LINE_RE = /อนุมัติ/;
// เช่นเดียวกับ PAID_MESSAGE_RE แต่ใช้ในรายการ (ไม่ต้องมีคำว่า "เงิน" ก็ได้ เช่น
// "ชำระเรียบร้อยครับ") — เจอตรงไหนในรายการก็ข้ามบรรทัดนั้นไปเฉย ๆ ไม่ใช่ชื่อสินค้า
// (ต่างจาก PAID_MESSAGE_RE ที่เจอแล้วทิ้งทั้งข้อความ เพราะบรรทัดนี้อาจมากับรายการ
// จริงในข้อความเดียวกัน เช่น ร้านเพิ่มรายการใหม่พร้อมแจ้งว่าลูกค้าจ่ายแล้วในข้อความเดียว)
const PAID_REMARK_LINE_RE = /ชำระ\s*(เงิน)?\s*(เรียบร้อย|แล้ว)/;
// หัวข้อบอกว่ามีรายการเพิ่มต่อจากที่แจ้งไปแล้ว ("เพิ่มรายการ") ไม่ใช่ชื่อสินค้า
// (ต่างจาก "เพิ่มเติม" ที่เป็นคำนำหน้าชื่อสินค้าใน cleanItemName)
const SECTION_NOTE_LINE_RE = /^เพิ่มรายการ\s*:*\s*$/;

// ใส่ขีดในเบอร์โทรให้อ่านง่าย ("0814567544" → "081-456-7544") — มือถือ 10 หลัก
// ใช้รูปแบบ 3-3-4, เบอร์บ้าน 9 หลัก (เช่น 02 นำหน้า) ใช้ 2-3-4 นอกนั้นคืนค่าเดิม
function formatPhone(digitsOnly) {
  if (/^0\d{9}$/.test(digitsOnly)) {
    return `${digitsOnly.slice(0, 3)}-${digitsOnly.slice(3, 6)}-${digitsOnly.slice(6)}`;
  }
  if (/^0\d{8}$/.test(digitsOnly)) {
    return `${digitsOnly.slice(0, 2)}-${digitsOnly.slice(2, 5)}-${digitsOnly.slice(5)}`;
  }
  return digitsOnly;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// บรรทัดในรายการ — ตัดเครื่องหมายหัวข้อ (-, •, ·), เลขลำดับนำหน้า ("1.", "2)")
// และคำ "เพิ่มเติม" นำหน้าทิ้งก่อน — "-" ที่ตามด้วยตัวเลขติดกันเลย (เช่น "-1000")
// ไม่ตัด เพราะเป็นเครื่องหมายลบของราคาส่วนลด ไม่ใช่หัวข้อ
function cleanItemName(raw) {
  return raw
    .trim()
    .replace(/^[-•·](?!\d)\s*/, '')
    .replace(/^\d+[.)]\s*/, '')
    .replace(/^เพิ่มเติม\s*/, '')
    .trim();
}

// ตัดส่วนคำนวณ "จำนวนxราคาต่อหน่วย =" ท้ายชื่อรายการทิ้ง (เช่น "น้ำยาหล่อเย็น
// 700x2 =1,400" → ชื่อ "น้ำยาหล่อเย็น" ราคาใช้ยอดรวมท้ายบรรทัดอยู่แล้ว 1,400)
function stripQtyCalc(name) {
  return name.replace(/\s*[\d,]+\s*[xX×]\s*\d+\s*=\s*$/, '').trim();
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

    // คำแจ้งในกลุ่ม ไม่ใช่รายการสินค้า ("ลูกค้าอนุมัติ"/"ชำระเรียบร้อยครับ" ปิดท้าย,
    // "เพิ่มรายการ" คั่นก่อนรายการที่เพิ่มมาทีหลัง)
    if (APPROVAL_LINE_RE.test(line) || PAID_REMARK_LINE_RE.test(line) || SECTION_NOTE_LINE_RE.test(line)) {
      flushPending();
      continue;
    }

    const totalMatch = /^รวม\s*:*\s*([\d,]+)\s*(?:บาท|฿)?\s*$/.exec(line);
    if (totalMatch) {
      flushPending();
      statedTotal = Number(totalMatch[1].replace(/,/g, '')); // ตัวสุดท้ายชนะ = ยอดรวมทั้งบิล
      continue;
    }

    // บรรทัดตัวเลขล้วน = ราคาของรายการชื่อบรรทัดก่อนหน้าที่ยังไม่มีราคา ("-" นำหน้า
    // ก็ได้ = ราคาติดลบ/ส่วนลด
    if (/^-?[\d,]+\s*(?:บาท)?$/.test(line)) {
      if (pendingName) {
        items.push({ name: pendingName, price: Number(line.replace(/,/g, '').replace(/บาท/g, '').trim()) });
        pendingName = null;
      }
      // ไม่มีรายการค้างรอราคาอยู่ก่อนหน้า = ตัวเลขลอย ๆ ไม่รู้ของอะไร ไม่เดา ข้ามไป
      continue;
    }

    flushPending();
    // ราคาขึ้นต้นด้วย "-" ก็จับได้ (ส่วนลด เช่น "ส่วนลด -1000" → ราคาติดลบ)
    const m = /^(.*?)[\s]*(-?[\d,]+)\s*(?:บาท)?$/.exec(line);
    if (m && m[1].trim()) {
      items.push({ name: stripQtyCalc(m[1].trim()), price: Number(m[2].replace(/,/g, '')) });
    } else {
      pendingName = line;
    }
  }
  flushPending();

  return { items, statedTotal, notes };
}

function parseLineQueueMessage(text) {
  if (!text || typeof text !== 'string') return null;
  if (PAID_MESSAGE_RE.test(text)) return null;

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
    color: null,
    mileage: null,
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
        if (field === 'phone') value = formatPhone(value.replace(/\D/g, ''));
        if (field === 'license_plate') value = value.replace(/\s+/g, '');
        if (field === 'mileage') {
          const digits = value.replace(/\D/g, '');
          result.mileage = digits ? Number(digits) : null;
          continue;
        }
        result[field] = value || null;
      }
      continue;
    }

    const digitsOnly = line.replace(/[-\s]/g, '');
    if (!result.phone && /^0\d{8,9}$/.test(digitsOnly)) {
      result.phone = formatPhone(digitsOnly);
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
    if (!result.color && COLOR_LINE_RE.test(line)) {
      result.color = line.replace(/^สี\s*/, '');
      continue;
    }
    // เลขไมล์เดี่ยว ๆ ("215170") ต้องเช็คก่อนตัวเปิดรายการสินค้าด้านล่าง ไม่งั้น
    // ตัวเลขล้วนจะถูกตีเป็นจุดเริ่มรายการ แล้วบรรทัดอาการที่ตามมาหลุดไปเป็นรายการ
    if (result.mileage == null && MILEAGE_LINE_RE.test(line)) {
      const digits = line.replace(/,/g, '');
      if (/^\d{4,7}$/.test(digits)) {
        result.mileage = Number(digits);
        continue;
      }
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
