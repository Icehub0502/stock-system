// แยกข้อความ "คิวรถเข้า" จากไลน์กลุ่มของร้าน ให้กลายเป็นข้อมูลใบเสนอราคา
//
// รูปแบบข้อความ (label:ค่า — ลำดับ label สลับกันได้ หลาย label ในบรรทัดเดียวกันได้):
//   คิว:1
//   วันที่:17/07/26
//   ชื่อลูกค้า:คุณB
//   เบอร์โทร:081-555-9999
//   ยี่ห้อรถ:Honda รุ่นรถ:Civic
//   ทะเบียนรถ:3กอ5222
//   อาการ:เช็คช่วงล่าง
//   รายการ:
//   แร็ค OEM 5000
//   ค่าแรง 2000
//   ชุดโปรช่วงล่าง เก๋ง
//   หมายเหตุ:
//   ลูกค้ามัดจำ 2000 บาท
//
// วิธีอ่าน: ตัดข้อความทั้งก้อนด้วยตำแหน่งของ "label:" แต่ละตัว (ไม่สนใจการขึ้น
// บรรทัดใหม่) — ค่าของ label หนึ่ง ๆ คือข้อความตั้งแต่หลัง ":" จนถึงจุดเริ่มของ
// label ถัดไปที่เจอ (หรือจบข้อความ) วิธีนี้ทำให้ "ยี่ห้อรถ:Honda รุ่นรถ:Civic" ถูก
// ตัดถูกจุดโดยอัตโนมัติ (ไม่ต้องขึ้นบรรทัดใหม่ต่อ label) และ "อาการ::เช็คช่วงล่าง"
// (โคลอนซ้ำ) ก็อ่านค่าได้ถูกต้องเช่นกัน (":+" กินโคลอนติดกันทั้งหมด)
//
// "รายการ:" และ "หมายเหตุ:" เป็น section (ค่าอาจมีหลายบรรทัด) — ทุกบรรทัดใต้
// "รายการ:" ถือว่าเป็นรายการสินค้าเจตนาจริง (ไม่ใช่แค่คำอธิบายลอย ๆ เหมือน
// pattern แบบเดิมที่ต้องเดาจากหน้าตาบรรทัด) แต่ละบรรทัดจับคู่กับแคตาล็อกสินค้า/
// บริการในระบบเพื่อดึงชื่อ/ราคามาตรฐาน+ประกันมาใส่ให้ (ดู lineWebhook.routes.js)
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

// แปลงวันที่ dd/mm/yy(yy) → ISO — ตีความปีย่อ 2 หลักเป็น ค.ศ. 20xx (ตรงกับที่ร้าน
// พิมพ์จริง เช่น "26" หมายถึง 2026) ไม่ใช่ปี พ.ศ. แปลงผิดรูปแบบ/วันที่ไม่จริง → null
function parseThaiDate(value) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(value.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// บรรทัดในเซคชัน "รายการ:" — ลงท้ายด้วยตัวเลขก็ถือเป็นราคา ไม่มีเลขก็ยังเป็น
// รายการอยู่ (price: null) ให้ตอนแมตช์แคตาล็อกไปหาราคามาตรฐานมาใส่แทน (เช่น
// "ชุดโปรช่วงล่าง เก๋ง" ไม่มีราคาในข้อความ แต่มี set price อยู่ในระบบแล้ว)
function parseSectionItemLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const m = /^(.*?)[\s]*([\d,]+)\s*(?:บาท)?$/.exec(trimmed);
  if (m && m[1].trim()) {
    return { name: m[1].trim(), price: Number(m[2].replace(/,/g, '')) };
  }
  return { name: trimmed, price: null };
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseLineQueueMessage(text) {
  if (!text || typeof text !== 'string') return null;

  const fields = tokenize(text);
  if (!('คิว' in fields)) return null; // ไม่มี label คิว = ไม่ใช่ข้อความคิว (แชตทั่วไปในกลุ่ม)

  const customerName = fields['ชื่อลูกค้า']?.trim();
  if (!customerName) return null; // ไม่มีชื่อ = ข้อมูลไม่พอสร้างใบเสนอราคา

  const phoneRaw = (fields['เบอร์โทร'] ?? fields['เบอโทร'] ?? '').trim();
  const items = (fields['รายการ'] || '')
    .split(/\r?\n/)
    .map(parseSectionItemLine)
    .filter(Boolean);

  return {
    queue_no: fields['คิว']?.trim() || null,
    quotation_date: (fields['วันที่'] && parseThaiDate(fields['วันที่'])) || todayStr(),
    customer_name: customerName,
    phone: phoneRaw ? phoneRaw.replace(/\D/g, '') : null,
    brand: fields['ยี่ห้อรถ']?.trim() || null,
    model: fields['รุ่นรถ']?.trim() || null,
    license_plate: fields['ทะเบียนรถ'] ? fields['ทะเบียนรถ'].replace(/\s+/g, '') : null,
    symptom: fields['อาการ']?.trim() || null,
    remark: fields['หมายเหตุ']?.trim() || null,
    items,
  };
}

module.exports = parseLineQueueMessage;
