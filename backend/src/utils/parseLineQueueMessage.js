// แยกข้อความ "คิวรถเข้า" จากไลน์กลุ่มของร้าน ให้กลายเป็นข้อมูลใบเสนอราคา
//
// รูปแบบข้อความ (label:ค่า — ลำดับ label สลับกันได้ หลาย label ในบรรทัดเดียวกันได้):
//
//   Pattern 1 — ตอนรับรถ (ไม่มีรายการ):
//     คิว:4
//     วันที่:15/07/26
//     ชื่อลูกค้า:คุณแอน
//     เบอโทร:084-140-0684
//     ยี่ห้อรถ:Honda รุ่นรถ:CRV G2
//     ทะเบียนรถ:6ขย1994
//     อาการ:ช่วงล่างดัง
//
//   Pattern 2 — ตอนเสนอราคา (คัดลอก Pattern 1 มาแล้วเติม รายการ:):
//     ...หัวข้อมูลเดิมชุดเดียวกัน...
//     รายการ:
//      - แร็ค OEM  5000
//      - ค่าแรง 2000
//      - ชุดโปรช่วงล่าง เก๋ง 6000
//      - โช๊ค 4 ต้น รวมอุปกรณ์ 10000
//     รวม 23000
//
// วิธีอ่าน: ตัดข้อความทั้งก้อนด้วยตำแหน่งของ "label:" แต่ละตัว (ไม่สนใจการขึ้น
// บรรทัดใหม่) — ค่าของ label หนึ่ง ๆ คือข้อความตั้งแต่หลัง ":" จนถึงจุดเริ่มของ
// label ถัดไปที่เจอ (หรือจบข้อความ) วิธีนี้ทำให้ "ยี่ห้อรถ:Honda รุ่นรถ:Civic" ถูก
// ตัดถูกจุดโดยอัตโนมัติ (ไม่ต้องขึ้นบรรทัดใหม่ต่อ label) และ "อาการ::เช็คช่วงล่าง"
// (โคลอนซ้ำ) ก็อ่านค่าได้ถูกต้องเช่นกัน (":+" กินโคลอนติดกันทั้งหมด)
//
// "วันที่:" ที่ร้านพิมพ์มาไม่ได้ใช้ — ใบเสนอราคาใช้วันที่สร้างจริงของระบบเสมอ
// (กันความสับสนเรื่องคิว/วันที่ที่พิมพ์มือผิดพลาด)
//
// "รายการ:" เป็น section (หลายบรรทัด) — ทุกบรรทัดถือว่าเป็นรายการสินค้าเจตนาจริง
// บรรทัดขึ้นต้นด้วย "-"/"•" (ตามที่ร้านพิมพ์) ตัดเครื่องหมายทิ้งก่อนอ่านชื่อ ทุก
// รายการจะถูกจับคู่กับแคตาล็อกสินค้า/บริการในระบบเสมอ (ดู lineWebhook.routes.js)
// เพื่อดึงชื่อ/ประกันมาตรฐานมาใส่ — ราคาใช้ตัวที่พิมพ์มาถ้ามี ถ้าไม่มีค่อยใช้ราคา
// ของแคตาล็อก (เช่น ราคาชุดของ "ชุดโปรช่วงล่างเก๋ง")
//
// บรรทัด "รวม xxxxx" ในเซคชัน "รายการ:" ไม่ใช่รายการ — เก็บเป็นยอดรวมที่ร้าน
// แจ้งมาเอง (stated_total) ให้ webhook เทียบกับผลรวมที่คำนวณจริงแล้วเตือนถ้าไม่
// ตรงกัน ไม่มีบรรทัดนี้ก็ไม่เป็นไร ระบบคำนวณผลรวมเองอยู่แล้ว
//
// คืน null ถ้าข้อความไม่มี label "คิว" เลย (ไม่ใช่ข้อความคิว) หรือไม่มีชื่อลูกค้า —
// ผู้เรียก (LINE webhook) จะข้ามข้อความนั้นเงียบ ๆ เพราะในกลุ่มมีแชตเรื่องอื่นปนอยู่
const LABELS = [
  'คิว',
  'วันที่',
  'ชื่อลูกค้า',
  'เบอร์โทร',
  'เบอโทร',
  'ยี่ห้อรถ',
  'รุ่นรถ',
  'ทะเบียนรถ',
  'อาการ',
  'รายการ',
  'หมายเหตุ',
];
const LABEL_RE = new RegExp(`(${LABELS.join('|')})\\s*:+\\s*`, 'g');

// แยกข้อความดิบเป็น { label: valueText } — ค่าอาจมีหลายบรรทัดถ้าเป็น section
function tokenize(text) {
  const matches = [...text.matchAll(LABEL_RE)];
  const fields = {};
  for (let i = 0; i < matches.length; i += 1) {
    const label = matches[i][1];
    const valueStart = matches[i].index + matches[i][0].length;
    const valueEnd = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const value = text.slice(valueStart, valueEnd).trim();
    if (!(label in fields)) fields[label] = value; // label แรกที่เจอชนะ กันบรรทัดซ้ำโดยไม่ตั้งใจ
  }
  return fields;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// บรรทัดในเซคชัน "รายการ:" — ตัดเครื่องหมายหัวข้อ (-, •, ·) และคำ "เพิ่มเติม"
// นำหน้าทิ้งก่อน แล้วลงท้ายด้วยตัวเลขก็ถือเป็นราคาในบรรทัดเดียวกัน ไม่มีเลขก็ยัง
// เป็นชื่อรายการอยู่ — รอราคาจากบรรทัดถัดไปถ้าเป็นตัวเลขล้วน (ร้านบางทีพิมพ์ชื่อ
// รายการกับราคาคนละบรรทัด เช่น "เพิ่มเติม รายการโช็ค 4ต้น" ตามด้วย "15500")
// ถ้าจบเซคชันแล้วยังไม่มีราคา ก็ยังเป็นรายการอยู่ (price: null) ให้ตอนแมตช์
// แคตาล็อกไปหาราคามาตรฐานมาใส่แทน (เช่น ชุดที่ไม่ได้ระบุราคาในข้อความ)
function cleanItemName(raw) {
  return raw.trim().replace(/^[-•·]\s*/, '').replace(/^เพิ่มเติม\s*/, '').trim();
}

function parseItemSection(sectionText) {
  const items = [];
  let statedTotal = null;
  let pendingName = null; // ชื่อรายการที่ยังไม่มีราคา รอดูบรรทัดถัดไป

  const flushPending = () => {
    if (pendingName) {
      items.push({ name: pendingName, price: null });
      pendingName = null;
    }
  };

  for (const rawLine of sectionText.split(/\r?\n/)) {
    const line = cleanItemName(rawLine);
    if (!line) continue;

    const totalMatch = /^รวม\s*:?\s*([\d,]+)\s*(?:บาท)?\s*$/.exec(line);
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

  const fields = tokenize(text);
  if (!('คิว' in fields)) return null; // ไม่มี label คิว = ไม่ใช่ข้อความคิว (แชตทั่วไปในกลุ่ม)

  const customerName = fields['ชื่อลูกค้า']?.trim();
  if (!customerName) return null; // ไม่มีชื่อ = ข้อมูลไม่พอสร้างใบเสนอราคา

  const phoneRaw = (fields['เบอร์โทร'] ?? fields['เบอโทร'] ?? '').trim();
  const { items, statedTotal } = parseItemSection(fields['รายการ'] || '');

  return {
    queue_no: fields['คิว']?.trim() || null,
    quotation_date: todayStr(), // ไม่ใช้วันที่ที่พิมพ์มาในข้อความ — ระบบตั้งวันที่สร้างจริงเสมอ
    customer_name: customerName,
    phone: phoneRaw ? phoneRaw.replace(/\D/g, '') : null,
    brand: fields['ยี่ห้อรถ']?.trim() || null,
    model: fields['รุ่นรถ']?.trim() || null,
    license_plate: fields['ทะเบียนรถ'] ? fields['ทะเบียนรถ'].replace(/\s+/g, '') : null,
    symptom: fields['อาการ']?.trim() || null,
    remark: fields['หมายเหตุ']?.trim() || null,
    items,
    stated_total: statedTotal,
  };
}

module.exports = parseLineQueueMessage;
