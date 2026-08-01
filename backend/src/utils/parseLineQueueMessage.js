// แยกข้อความ "คิวรถเข้า" จากไลน์กลุ่มของร้าน ให้กลายเป็นข้อมูลใบเสนอราคา
//
// เทมเพลตเดียวเท่านั้นที่รองรับ (พนักงานพิมพ์ "คิว" เดี่ยว ๆ แล้วบอทตอบกลับเทมเพลต
// ให้กรอกทับ — ดู buildQueueTemplateText ใน lineWebhook.routes.js) หมดยุคการเดา
// รูปแบบข้อความจาก "หน้าตา" แต่ละบรรทัดแล้ว ("แพทเทินเก่า" ที่เคยรองรับเบอร์โทร/
// ทะเบียน/ยี่ห้อรถ/สีรถ/เลขไมล์แบบไม่มี label ถูกถอดออกทั้งหมดตามที่ร้านต้องการ):
//
//   คิว 5
//   18/07/69
//   ชื่อ:คุณทดสอบ
//   เบอโทรศัพท์:099-000-0099
//   ยี่ห้อรถ:Toyota
//   รุ่นรถ:Vios
//   ทะเบียนรถ:1กก1234
//   สีรถ:ขาว
//   เลขไมค์:123456
//   อาการ:เช็คช่วงล่าง
//   รายการ:
//   แร็ค OEM 5000
//
//   <--สิ้นสุดรายการ-->
//   ยอดรวม:5000
//   หมายเหตุ:ลูกค้ารอรับรถ
//   วันนัดหมาย:20/07/69
//
//   <--ลูกค้าชำระเงิน-->
//   ช่องทางการชำระ:เงินสด
//   ลูกค้าชำระเงิน:5000
//
// การจำแนกหัวข้อมูล: "คิว"/"คิวที่" ต้นบรรทัดแรกเสมอ (เลขคิวคือตัวที่ตามมา ไม่มี
// label ก็ยังอ่านแบบเดิม), บรรทัดวันที่เดี่ยว ๆ (dd/mm/yy) บรรทัดที่สองไม่ถูกใช้
// ทิ้งไปเลย — นอกนั้นทุกฟิลด์หัวบิล (ชื่อ/เบอร์โทร/ยี่ห้อรถ/รุ่นรถ/ทะเบียนรถ/สีรถ/
// เลขไมล์/อาการ/หมายเหตุ) มาจาก label ที่ขึ้นต้นบรรทัดเท่านั้น (ดู OPTIONAL_LABELS
// ด้านล่าง โคลอนมีหรือไม่มีก็ได้ — เก็บ alias เก่าไว้ทุกตัวเผื่อพนักงานคุ้นเคย)
// บรรทัดไหนไม่ตรง label ที่รู้จักเลยและไม่ใช่จุดเริ่มรายการ ("รายการ:") จะถูกข้าม
// เงียบ ๆ — ไม่มีการเดารูปแบบจากหน้าตาบรรทัดอีกต่อไป
//
// รายการสินค้า: เริ่มนับก็ต่อเมื่อเจอบรรทัด "รายการ:" เท่านั้น (ไม่มีการเริ่มอัตโนมัติ
// จากบรรทัดที่ลงท้ายด้วยราคาอีกต่อไป) ทุกบรรทัดตั้งแต่นั้นเป็นรายการทั้งหมด ราคาไม่
// ครบทุกบรรทัดก็ได้ — ชื่อไม่มีราคาต่อท้าย แล้วบรรทัดถัดไปเป็นตัวเลขล้วน จะรวมเป็น
// รายการเดียวกัน ("เพิ่มเติม รายการโช็ค 4ต้น" ตามด้วย "15500")
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
// คืน null ถ้าบรรทัดแรกไม่ขึ้นต้นด้วย "คิว" หรือไม่มีชื่อลูกค้า (ไม่ได้กรอก label
// "ชื่อ:"/"ชื่อลูกค้า:") — ผู้เรียก (LINE webhook) จะข้ามข้อความนั้นเงียบ ๆ เพราะใน
// กลุ่มมีแชตเรื่องอื่นปนอยู่ (แชตทั่วไปไม่มีทางกรอก label ครบตามเทมเพลตอยู่แล้ว)
//
// ส่วนชำระเงิน (หลัง "<--สิ้นสุดรายการ-->"): ยอดรวม/หมายเหตุ/วันนัดหมาย/
// ช่องทางการชำระ/ลูกค้าชำระเงิน พาร์สเข้าฟิลด์ stated_total/remark/
// appointment_date/payment_method/paid_amount ตามลำดับ — "<--ลูกค้าชำระเงิน-->"
// เป็นแค่เส้นแบ่งจัดหน้าเทมเพลตให้ดูง่าย (คั่นระหว่างวันนัดหมายกับช่องทาง
// ชำระ) ไม่ใช่ label ข้อมูล พาร์สเลนเอนต์ — label ฝั่งไหนของเส้นนี้ก็อ่านได้เหมือนกัน
// ("ลูกค้าชำระเงิน:" กรอกมาแล้วยังเป็นแค่ฟิลด์ยอดที่ลูกค้าจ่าย ไม่ปิดบิลเองอีกต่อไป)
//
// สัญญาณปิดบิลจริง ๆ คือ "วลีแจ้งจ่ายเงินแล้ว" (PAID_PHRASE_RE ด้านล่าง — ต้องมีคำว่า
// "ชำระ" หรือ "จ่าย" คู่กับ "เรียบร้อย" หรือ "แล้ว" เช่น "ชำระเงินเรียบร้อย"/
// "จ่ายเงินเรียบร้อย"/"ลูกค้าชำระแล้ว") พิมพ์ไว้ที่บรรทัดไหนก็ได้ (ในรายการสินค้า
// หรือส่วนชำระเงิน ก่อนหรือหลัง "<--ลูกค้าชำระเงิน-->" ก็ได้ทั้งนั้น) → เจอแล้วเซ็ต
// result.paid_confirmed = true ให้ lineWebhook.routes.js ไปสร้าง/อนุมัติใบเสร็จให้
// อัตโนมัติ (ดู createQuotationFromQueue) บรรทัดที่มีวลีนี้จะไม่ถูกเก็บเป็นรายการ/
// หมายเหตุ (ถูก "กิน" ทิ้งไปเลย ไม่ใช่ข้อมูลจริง)

const BARE_DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
const ITEM_SECTION_TRIGGER_RE = /^รายการ\s*:*\s*$/;
// negative lookahead กัน "วันที่มัดจำ:" (label ใหม่ในส่วนชำระเงิน ดู PAYMENT_LABELS
// ด้านล่าง) ไม่ให้โดนกลืนเป็นบรรทัดวันที่หัวบิลที่ไม่ใช้ทิ้งไปแบบบรรทัดวันที่เฉย ๆ
// (ไม่ใช้ \b ปิดท้าย — อักษรไทยไม่ใช่ \w เลยไม่มี word boundary ให้ \b จับ ใส่ไปจะ
// เป็น regex ที่ไม่มีผลอะไรเลย)
const IGNORED_LINE_RE = /^วันที่(?!มัดจำ)/; // ร้านบางทีพิมพ์วันที่มาด้วย ไม่ใช้ ไม่งั้นหลุดไปปนกับอาการ
// ช่องว่างยาว 3+ ตัว หรืออิโมจิ = สัญญาณว่าเป็นข้อความโปรโมทคัดลอกมาทั้งย่อหน้า
// ไม่ใช่ชื่อรายการจริง ("ชุดโปร ช่วงล่าง    👍...🛠️...")
const DECORATED_LINE_RE = /\s{3,}|[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
// ⚠️ ลำดับ key สำคัญมาก: OPTIONAL_LABEL_RE ต่อคีย์ทั้งหมดด้วย | (alternation) แล้ว
// regex จะแมตช์ตัวเลือกแรกที่เจอตามลำดับที่เขียนไว้ ไม่ใช่ตัวที่ยาวที่สุด — label
// ที่เป็น "คำนำหน้า" ของอีก label หนึ่ง (เช่น "เบอร์โทร" นำหน้า "เบอร์โทรศัพท์") ต้อง
// เขียนตัวที่ยาวกว่าไว้ก่อนเสมอ ไม่งั้น "เบอร์โทรศัพท์:0812345678" จะโดนตัดที่
// "เบอร์โทร" ก่อน เหลือ "ศัพท์:0812345678" เป็นเนื้อความที่เหลือ (ผิด)
const OPTIONAL_LABELS = {
  ชื่อลูกค้า: 'customer_name',
  เบอร์โทรศัพท์: 'phone', // ยาวกว่า "เบอร์โทร" ต้องมาก่อน
  เบอร์โทร: 'phone',
  เบอโทรศัพท์: 'phone', // ยาวกว่า "เบอโทร" ต้องมาก่อน
  เบอโทร: 'phone',
  ยี่ห้อรถ: 'brand',
  รุ่นรถ: 'model',
  ทะเบียนรถ: 'license_plate',
  สีรถ: 'color',
  เลขไมล์: 'mileage',
  เลขไมค์: 'mileage', // สะกดแบบที่ร้านพิมพ์จริง
  อาการ: 'symptom',
  หมายเหตุ: 'remark',
  ชื่อ: 'customer_name', // เทมเพลตใหม่ใช้ "ชื่อ:" เฉย ๆ — ต้องมาหลัง "ชื่อลูกค้า" เสมอ
};
// escape ตัวอักษร regex พิเศษใน label ก่อนต่อเป็น alternation — จำเป็นเพราะ label
// บางตัวมีวงเล็บจริง ๆ ในข้อความ (เช่น "ช่องทางการชำระ (โอน/บัตรเครดิต/เงินสด/QRCode)")
// ถ้าไม่ escape วงเล็บจะกลายเป็น capturing group เพิ่ม ทำให้ index ของ match[1]/match[2]
// เพี้ยนไปหมด
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const OPTIONAL_LABEL_RE = new RegExp(`^(${Object.keys(OPTIONAL_LABELS).map(escapeRegExp).join('|')})\\s*:*\\s*(.*)$`);

// ── ส่วนชำระเงินของเทมเพลตใหม่ (หลัง "<--สิ้นสุดรายการ-->") ──
// แยกเป็น label set ต่างหากจาก OPTIONAL_LABELS ด้านบน เพราะอยู่คนละ section ของ
// ข้อความ (หลัง end marker) ไม่ปนกับ label หัวบิล — "หมายเหตุ" ซ้ำ label กับด้านบน
// ได้เพราะคนละ regex/section กันคนละที่ ไม่ชนกัน
const PAYMENT_LABELS = {
  ยอดรวม: 'stated_total',
  // "ยอดที่ต้องชำระ" ถูกแทนที่ด้วย "วันนัดหมาย" แล้ว — ยอดค้างชำระคำนวณเองจาก
  // total_amount - deposit_amount แล้วให้บอทตอบกลับในข้อความยืนยัน แทนที่จะให้
  // พนักงานพิมพ์เลขเอง (ดู buildSuccessReplyText ใน lineWebhook.routes.js)
  // "วันนัดหมาย:" ที่กรอกที่นี่จะถูก sync เข้า scheduled_date/status='scheduled'
  // ของใบเสนอราคา ตัวเดียวกับที่หน้า "ลูกค้าที่นัดหมาย" ใช้ (ดู createQuotationFromQueue)
  วันนัดหมาย: 'appointment_date',
  // เทมเพลตใหม่ใส่คำแนะนำในวงเล็บต่อท้าย label ให้พนักงานเห็นตัวเลือก/ความหมายชัด ๆ
  // (ดู buildQueueTemplateText/buildFilledTemplateText ใน lineWebhook.routes.js) —
  // ต้องเขียนตัวที่มีวงเล็บไว้ก่อนตัวเปล่าเสมอ (⚠️ กติกาเดียวกับ OPTIONAL_LABELS
  // ด้านบน) ไม่งั้น "ช่องทางการชำระ" เปล่าจะแมตช์ก่อนแล้วเหลือ " (โอน/...):ค่า" ติด
  // มากับ value ที่พาร์สได้
  'ช่องทางการชำระ (โอน/บัตรเครดิต/เงินสด/QRCode)': 'payment_method',
  ช่องทางการชำระ: 'payment_method',
  'ลูกค้าชำระเงิน (ยอดที่ได้รับจริง)': 'paid_amount',
  ลูกค้าชำระเงิน: 'paid_amount',
  หมายเหตุ: 'remark',
  // มัดจำเป็นฟิลด์ first-class ของบิล (deposit_amount/deposit_date ใน quotations/
  // receipts) ไม่ใช่แค่ข้อความในหมายเหตุอีกต่อไป — ยังคงรองรับ "มัดจำ" แบบข้อความ
  // เดิมในส่วนรายการสินค้า (ดู /มัดจำ/ ใน parseItemSectionLines ด้านล่าง) แยกกันไป
  // เพื่อ backward compat กับพนักงานที่คุ้นเคยพิมพ์ไว้ในรายการ
  มัดจำ: 'deposit_amount',
  วันที่มัดจำ: 'deposit_date',
};
const PAYMENT_LABEL_RE = new RegExp(`^(${Object.keys(PAYMENT_LABELS).map(escapeRegExp).join('|')})\\s*:*\\s*(.*)$`);
// จุดจบรายการแบบระบุชัดเจนในเทมเพลตใหม่ — ทุกอย่างหลังบรรทัดนี้เป็น "ส่วนชำระเงิน"
// ไม่ใช่รายการสินค้าอีกต่อไป (ทนช่องว่างรอบคำได้ เผื่อพิมพ์ "<-- สิ้นสุดรายการ -->")
const END_MARKER_RE = /^<--\s*สิ้นสุดรายการ\s*-->$/;
// เส้นแบ่งจัดหน้าที่สองในเทมเพลตใหม่ — คั่นระหว่าง "ยอดที่ต้องชำระ" กับ
// "ช่องทางการชำระ/ลูกค้าชำระเงิน" ให้ดูง่ายเฉย ๆ ไม่ใช่ label ข้อมูล พาร์สข้ามไปเลย
// (label ฝั่งไหนของเส้นนี้ก็ยังอ่านได้เหมือนกัน — parsePaymentSectionLines ไม่ได้
// แยกส่วนตาม marker นี้อยู่แล้ว)
const PAYMENT_SECTION_DIVIDER_RE = /^<--\s*ลูกค้าชำระเงิน\s*-->$/;
// คำปิดท้ายในรายการที่เป็นแค่ข้อความแจ้งคนในกลุ่ม ("ลูกค้าอนุมัติ") ไม่ใช่ชื่อสินค้า
const APPROVAL_LINE_RE = /อนุมัติ/;
// วลีแจ้งว่าลูกค้าจ่ายเงินแล้ว = สัญญาณปิดบิลจริง ("ต้องมีคำว่าชำระหรือชำระเงิน" —
// กติกาเจ้าของร้าน ครอบคลุม "จ่าย" ด้วยเพราะตัวอย่างที่แจ้งมาเองใช้ "จ่ายเงินเรียบร้อย")
// เจอที่บรรทัดไหนก็ได้ (ในรายการหรือส่วนชำระเงิน) → เซ็ต paid_confirmed แล้ว "กิน"
// บรรทัดนั้นทิ้ง ไม่ใช่ชื่อสินค้า/หมายเหตุ (เช่น "ชำระเรียบร้อยครับ"/"จ่ายเงินเรียบร้อย"/
// "ลูกค้าชำระแล้ว")
const PAID_PHRASE_RE = /(?:ชำระ|จ่าย)\s*(?:เงิน)?\s*(?:เรียบร้อย|แล้ว)/;
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

// แปลงวันที่ไทย dd/mm/yy (พ.ศ.) ที่พิมพ์มาใน "วันที่มัดจำ:" เป็น YYYY-MM-DD (ค.ศ.)
// เก็บลง DB — ปีที่พิมพ์มาแบบ 2 หลัก (เช่น "69") ถือว่าเป็น พ.ศ. 25xx เสมอ (ร้านพิมพ์
// ปีปัจจุบันรูปแบบนี้มาตลอด ไม่มีทางพิมพ์ปีอื่นที่ไกลจากวันนี้ขนาดนั้น) รูปแบบไม่ตรง/
// วัน-เดือนไม่สมเหตุสมผลคืน null (ไม่บล็อกการพาร์สทั้งข้อความ แค่ฟิลด์นี้ไม่ได้ค่า)
function parseThaiShortDate(value) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(value.trim());
  if (!match) return null;
  const dd = Number(match[1]);
  const mm = Number(match[2]);
  let buddhistYear = Number(match[3]);
  if (match[3].length <= 2) buddhistYear += 2500; // ปี 2 หลัก → พ.ศ. เต็ม (25xx)
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
  const ceYear = buddhistYear - 543; // พ.ศ. → ค.ศ.
  return `${ceYear}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ปรับ "ช่องทางการชำระ:" ให้ตรงกับตัวเลือกใน select ของหน้าสรุปยอดประจำวันเป๊ะ ๆ
// (DailySummaryDetailModal.jsx: ['โอน','บัตรเครดิต','เงินสด','QRCode']) — พนักงานพิมพ์
// "QRcode"/"qrcode"/"QR" มาก็ต้องกลายเป็น "QRCode" ตัวใหญ่-เล็กแบบนี้เป๊ะ ไม่งั้น select
// ฝั่งหน้าเว็บจะไม่มีตัวเลือกไหนตรง กลายเป็นแสดงว่างเปล่า ค่าที่ไม่รู้จักคงข้อความเดิม
// ไว้ตามที่พิมพ์มา ให้หน้างานแก้เองทีหลังในแอปได้
function normalizePaymentMethod(raw) {
  const value = raw.trim();
  if (!value) return null;
  const compact = value.toLowerCase().replace(/\s+/g, '');
  if (compact === 'qrcode' || compact === 'qr') return 'QRCode';
  return value;
}

// แปลงค่าดิบหลัง label หนึ่งตัวของ PAYMENT_LABELS ให้เป็นค่าที่พร้อมเก็บลง result —
// ใช้ร่วมกันทั้ง parsePaymentSectionLines ด้านล่าง (ส่วนชำระเงินของเทมเพลตเต็ม) และ
// fallback ในลูปหลักของ parseLineQueueMessage (ข้อความปิดบิลสั้นแบบ close_only ที่ไม่มี
// "รายการ:"/"<--สิ้นสุดรายการ-->" เลย จึงไม่มีทางเข้าถึง parsePaymentSectionLines ได้)
// ค่าว่างหลัง label คืน null เสมอ ไม่ใช่ "" (ผู้เรียกเช็คแค่ != null ว่า "มีการกรอกมา"
// ได้ตรง ๆ)
function parsePaymentLabelValue(field, rawValue) {
  const value = rawValue.trim();
  if (field === 'payment_method') return value ? normalizePaymentMethod(value) : null;
  if (field === 'deposit_date' || field === 'appointment_date') return value ? parseThaiShortDate(value) : null;
  if (field === 'remark') return value || null;
  // ฟิลด์ตัวเลขที่เหลือ: stated_total, paid_amount, deposit_amount
  if (!value) return null;
  const digits = value.replace(/,/g, '').replace(/บาท/g, '').trim();
  const num = Number(digits);
  return Number.isFinite(num) && digits !== '' ? num : null;
}

// แยกส่วนชำระเงินท้ายเทมเพลต (หลัง "<--สิ้นสุดรายการ-->") ตาม label — ไม่พบ label
// ที่รู้จักในบรรทัดไหนก็ข้ามบรรทัดนั้นเงียบ ๆ (กันข้อความแปลกปนมา ไม่ทำให้ทั้งข้อความ
// พัง) ค่าว่างหลัง label เป็น null เสมอ ไม่ใช่ "" (ผู้เรียกเช็คแค่ != null ว่า "มีการ
// กรอกมา" ได้ตรง ๆ)
function parsePaymentSectionLines(lines) {
  const result = {
    stated_total: null,
    appointment_date: null,
    payment_method: null,
    paid_amount: null,
    deposit_amount: null,
    deposit_date: null,
    remarkNotes: [],
    paid_confirmed: false,
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // เส้นแบ่งจัดหน้า "<--ลูกค้าชำระเงิน-->" ไม่ใช่ label ข้อมูล ข้ามไปเลย (label
    // ฝั่งไหนของเส้นนี้ก็อ่านได้เหมือนกันอยู่แล้ว เพราะ loop นี้ไม่ได้แยก section ตามมัน)
    if (PAYMENT_SECTION_DIVIDER_RE.test(trimmed)) continue;

    // วลีแจ้งจ่ายเงินแล้ว ("ชำระเงินเรียบร้อย" ฯลฯ) โผล่ในส่วนชำระเงินก็ได้ (พนักงาน
    // พิมพ์ต่อท้ายเทมเพลตหลังกรอกครบ) — เจอแล้ว "กิน" บรรทัดทิ้ง ไม่ใช่ label/remark
    if (PAID_PHRASE_RE.test(trimmed)) {
      result.paid_confirmed = true;
      continue;
    }

    const match = PAYMENT_LABEL_RE.exec(trimmed);
    if (!match) continue;
    const [, label, rest] = match;
    const field = PAYMENT_LABELS[label];
    const value = parsePaymentLabelValue(field, rest);

    if (field === 'remark') {
      if (value) result.remarkNotes.push(value);
      continue;
    }
    result[field] = value;
  }

  return result;
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
  let paidConfirmed = false;
  // บรรทัดที่เหลือหลัง end marker ("<--สิ้นสุดรายการ-->") — ส่วนชำระเงินของ
  // เทมเพลตใหม่ ให้ผู้เรียก (parseLineQueueMessage) เอาไปพาร์สต่อแยกจากรายการสินค้า
  let paymentSectionLines = [];

  const flushPending = () => {
    if (pendingName) {
      items.push({ name: pendingName, price: null });
      pendingName = null;
    }
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const trimmedRaw = rawLine.trim();
    if (!trimmedRaw) continue;

    if (END_MARKER_RE.test(trimmedRaw)) {
      flushPending();
      paymentSectionLines = lines.slice(lineIndex + 1);
      break; // หยุดเก็บรายการทันที ทุกอย่างหลังจากนี้ไม่ใช่รายการสินค้าอีกต่อไป
    }

    if (DECORATED_LINE_RE.test(trimmedRaw)) {
      flushPending();
      notes.push(trimmedRaw);
      continue;
    }

    // "-" นำหน้าบรรทัด (ไม่ตามด้วยตัวเลขติดกัน กันชนกับราคาส่วนลด "-500") ที่มีวงเล็บ
    // ระบุยี่ห้อต่อท้ายชื่อ (เช่น "ลูกหมากคันชักนอก (555)") = รายการย่อยของบรรทัดข้างบน
    // (เจ้าของร้านสั่งไว้ ให้ lineWebhook.routes.js เอาไปจับคู่แทนที่รายการย่อยในชุด
    // "ชุดโปร..." หรือเพิ่มเป็นรายการแยกถ้าไม่เจอที่จับคู่) ราคาไม่บังคับ — ถ้าใส่ต้อง
    // เป็นตัวเลขล้วนต่อท้ายวงเล็บอีกที (เช่น "ลูกหมากคันชักนอก (555) 200") ไม่ใส่ก็นับ
    // เป็น 0 (วงเล็บเป็นยี่ห้อ ไม่ใช่ราคา — ราคาต้องอยู่นอกวงเล็บเสมอ)
    //
    // ⚠️ ต้องแยกจากธรรมเนียมเดิมที่ "-" เป็นแค่เครื่องหมายหัวข้อ/บุลเล็ตของรายการปกติ
    // ที่ไม่มีวงเล็บเลย (เช่น "- ค่าแรง 2000") — เคสนั้นต้องปล่อยให้ประมวลผลแบบรายการ
    // ปกติเหมือนเดิมทุกประการ ไม่งั้นราคาจะหายไปเป็น 0 หมด จึงใช้ "มีวงเล็บหรือไม่" เป็น
    // ตัวตัดสินว่าเป็นรายการย่อยแบบใหม่หรือรายการปกติแบบเดิม
    const isSubItemLine = /^-(?!\d)/.test(trimmedRaw);

    const line = cleanItemName(trimmedRaw);
    if (!line) continue;

    if (isSubItemLine && /\(.*\)/.test(line)) {
      flushPending();
      // ราคา (ถ้ามี) อยู่นอกวงเล็บเสมอ เป็นตัวเลขล้วนต่อท้ายวงเล็บปิดอีกที
      const trailingPriceMatch = /^(.*\))\s+(-?[\d,]+)\s*(?:บาท)?$/.exec(line);
      if (trailingPriceMatch) {
        items.push({ name: trailingPriceMatch[1].trim(), price: Number(trailingPriceMatch[2].replace(/,/g, '')), isSubItem: true });
      } else {
        items.push({ name: line, price: 0, isSubItem: true });
      }
      continue;
    }
    // "-" นำหน้าแต่ไม่มีวงเล็บ = ธรรมเนียมเดิม บุลเล็ตนำหน้ารายการปกติเฉย ๆ ปล่อยผ่าน
    // ไปประมวลผลด้านล่างเหมือนไม่มี isSubItemLine เลย

    // คำแจ้งในกลุ่ม ไม่ใช่รายการสินค้า ("ลูกค้าอนุมัติ"/"ชำระเรียบร้อยครับ" ปิดท้าย,
    // "เพิ่มรายการ" คั่นก่อนรายการที่เพิ่มมาทีหลัง) — เจอวลีจ่ายเงินแล้วในรายการก็เซ็ต
    // paid_confirmed ไว้ด้วย (พนักงานบางทีพิมพ์ต่อท้ายรายการเลย ไม่รอถึงส่วนชำระเงิน)
    if (PAID_PHRASE_RE.test(line)) paidConfirmed = true;
    if (APPROVAL_LINE_RE.test(line) || PAID_PHRASE_RE.test(line) || SECTION_NOTE_LINE_RE.test(line)) {
      flushPending();
      continue;
    }

    // "หมายเหตุ ..." ในรายการ (โคลอนมีหรือไม่มีก็ได้ เหมือน OPTIONAL_LABEL_RE) และ
    // บรรทัดที่มีคำว่า "มัดจำ" (แม้ไม่มี label "หมายเหตุ" นำหน้า) ไม่ใช่รายการสินค้า
    // — เก็บเข้าหมายเหตุแทน (caller เอา notes ไปต่อเป็น result.remark)
    const noteLabelMatch = /^หมายเหตุ\s*:*\s*(.*)$/.exec(line);
    if (noteLabelMatch) {
      flushPending();
      notes.push(noteLabelMatch[1].trim() || line);
      continue;
    }
    if (/มัดจำ/.test(line)) {
      flushPending();
      notes.push(line);
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

    // "ลูกปืนล้อหน้า L+R 1700*2 3,400" / "2*1700" / "700x2 =1,400" — จำนวนกับ
    // ราคาต่อหน่วยคูณกัน (พิมพ์สลับข้างได้ ตัวเลขน้อยกว่า = จำนวน) ยอดรวมต่อท้าย
    // มีหรือไม่มีก็ได้ — ถ้ามีและหารด้วยจำนวนลงตัว ใช้ยอดรวมเป็นตัวตั้ง (กันพิมพ์
    // ราคาต่อหน่วยผิดแต่ยอดรวมถูก)
    const qtyCalc = /^(.*?)\s+([\d,]+)\s*[xX×*]\s*([\d,]+)(?:\s*=?\s*([\d,]+))?\s*(?:บาท)?$/.exec(line);
    if (qtyCalc && qtyCalc[1].trim()) {
      const a = Number(qtyCalc[2].replace(/,/g, ''));
      const b = Number(qtyCalc[3].replace(/,/g, ''));
      const printedTotal = qtyCalc[4] != null ? Number(qtyCalc[4].replace(/,/g, '')) : null;
      let quantity = Math.min(a, b);
      let unitPrice = Math.max(a, b);
      if (printedTotal != null && quantity > 0 && printedTotal % quantity === 0) {
        unitPrice = printedTotal / quantity;
      }
      if (quantity >= 1) {
        items.push({
          name: qtyCalc[1].trim(),
          price: printedTotal != null ? printedTotal : quantity * unitPrice,
          quantity,
          unit_price: unitPrice,
        });
        continue;
      }
    }

    // ราคาขึ้นต้นด้วย "-" ก็จับได้ (ส่วนลด เช่น "ส่วนลด -1000" → ราคาติดลบ)
    const m = /^(.*?)[\s]*(-?[\d,]+)\s*(?:บาท)?$/.exec(line);
    if (m && m[1].trim()) {
      items.push({ name: stripQtyCalc(m[1].trim()), price: Number(m[2].replace(/,/g, '')) });
    } else {
      pendingName = line;
    }
  }
  flushPending();

  return { items, statedTotal, notes, paymentSectionLines, paidConfirmed };
}

// เลขไทย (๐-๙) → เลขอารบิก — พนักงานบางทีสลับคีย์บอร์ดมือถือเป็นเลขไทยโดยไม่ทันสังเกต
// แล้วพิมพ์ราคา/จำนวนเป็นเลขไทยแทน ทุก regex ตัวเลขในไฟล์นี้ใช้ [\d] (อารบิกล้วน) จึง
// ต้องแปลงให้เป็นเลขอารบิกตั้งแต่ต้นก่อนพาร์สอะไรทั้งหมด ไม่งั้นทั้งบรรทัดจะกลายเป็น
// ชื่อรายการที่มีเลขไทยติดอยู่ ราคาอ่านไม่ได้เลยกลายเป็น 0
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
function thaiDigitsToArabic(str) {
  return str.replace(/[๐-๙]/g, (ch) => String(THAI_DIGITS.indexOf(ch)));
}

function parseLineQueueMessage(text) {
  if (!text || typeof text !== 'string') return null;
  text = thaiDigitsToArabic(text);

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
    // ฟิลด์ใหม่จากส่วนชำระเงินของเทมเพลต (หลัง "<--สิ้นสุดรายการ-->") — ว่างเสมอ
    // (null) สำหรับข้อความแบบเดิมที่ไม่มีส่วนนี้ ไม่กระทบพฤติกรรมเดิมเลย
    payment_method: null,
    paid_amount: null,
    // มัดจำ (deposit) เป็นฟิลด์ first-class เหมือนกัน — มาจาก label "มัดจำ:"/
    // "วันที่มัดจำ:" ในส่วนชำระเงิน (ดู PAYMENT_LABELS) deposit_date เป็นสตริง
    // YYYY-MM-DD พร้อมเก็บลง DB แล้ว (แปลงจาก dd/mm/yy พ.ศ. ที่พิมพ์มา)
    deposit_amount: null,
    deposit_date: null,
    // วันนัดหมาย (appointment_date) กรอกคู่กับมัดจำ — sync เข้า scheduled_date/
    // status='scheduled' ของใบเสนอราคาใน createQuotationFromQueue (lineWebhook.routes.js)
    appointment_date: null,
    // true เมื่อเจอวลีแจ้งจ่ายเงินแล้ว (PAID_PHRASE_RE) ที่บรรทัดไหนก็ได้ในข้อความ
    // — สัญญาณปิดบิลจริง (ดู lineWebhook.routes.js) ไม่ใช่แค่กรอก "ลูกค้าชำระเงิน:"
    paid_confirmed: false,
  };

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

    // ข้อความปิดบิลสั้นแบบ close_only (ดูด้านล่าง) ไม่มี "รายการ:"/end marker เลย —
    // บรรทัดจ่ายเงิน (ช่องทางการชำระ/ลูกค้าชำระเงิน/วลีแจ้งจ่ายเงินแล้ว) จึงมาถึงลูป
    // หลักนี้ตรง ๆ โดยไม่ผ่าน parsePaymentSectionLines เลย (ฟังก์ชันนั้นถูกเรียกก็
    // ต่อเมื่อเจอ end marker ในรายการสินค้าเท่านั้น) ต้องดักจับที่นี่ด้วยเป็น fallback
    // (เทมเพลตเต็มปกติไม่มีทางมาถึงจุดนี้ เพราะ "รายการ:" ทำให้ loop break ไปก่อนเจอ
    // บรรทัดพวกนี้อยู่แล้ว)
    if (PAID_PHRASE_RE.test(line)) {
      result.paid_confirmed = true;
      continue;
    }
    const paymentMatch = PAYMENT_LABEL_RE.exec(line);
    if (paymentMatch) {
      const [, paymentLabel, paymentRest] = paymentMatch;
      const paymentField = PAYMENT_LABELS[paymentLabel];
      const paymentValue = parsePaymentLabelValue(paymentField, paymentRest);
      if (paymentField === 'remark') {
        if (paymentValue) result.remark = result.remark ? `${result.remark}\n${paymentValue}` : paymentValue;
      } else {
        result[paymentField] = paymentValue;
      }
      continue;
    }

    // ไม่ตรง label ที่รู้จักเลย (เทมเพลตเดียวเท่านั้นที่รองรับแล้ว — ไม่มีการเดา
    // รูปแบบจากหน้าตาบรรทัดอีกต่อไป) ข้ามเงียบ ๆ
  }

  if (itemSectionStartIndex >= 0) {
    const { items, statedTotal, notes, paymentSectionLines, paidConfirmed } = parseItemSectionLines(lines.slice(itemSectionStartIndex));
    result.items = items;
    result.stated_total = statedTotal;
    if (paidConfirmed) result.paid_confirmed = true;
    if (notes.length > 0) {
      result.remark = result.remark ? `${result.remark}\n${notes.join('\n')}` : notes.join('\n');
    }

    // เทมเพลตใหม่: เจอ end marker แล้วมีเนื้อหาต่อท้าย → พาร์สเป็นส่วนชำระเงิน
    // "ยอดรวม:" ทับ stated_total เดิม (ถ้ามีค่า) เพราะเป็นตัวที่ระบุชัดเจนกว่าบรรทัด
    // "รวม xxxx" แบบเดา — ไม่มีค่าก็ไม่ทับ (คง stated_total จากรายการเดิมไว้)
    if (paymentSectionLines.length > 0) {
      const payment = parsePaymentSectionLines(paymentSectionLines);
      if (payment.stated_total != null) result.stated_total = payment.stated_total;
      result.appointment_date = payment.appointment_date;
      result.payment_method = payment.payment_method;
      result.paid_amount = payment.paid_amount;
      result.deposit_amount = payment.deposit_amount;
      result.deposit_date = payment.deposit_date;
      if (payment.paid_confirmed) result.paid_confirmed = true;
      if (payment.remarkNotes.length > 0) {
        result.remark = result.remark ? `${result.remark}\n${payment.remarkNotes.join('\n')}` : payment.remarkNotes.join('\n');
      }
    }
  }

  // รูปแบบ "close_only" — ข้อความปิดบิลสั้น ๆ ที่อ้างอิงงานที่เปิดไว้แล้วด้วยเลขคิว
  // เท่านั้น ไม่มีชื่อลูกค้า/รถ/รายการเลย (เช่น "คิว 3\nช่องทางการชำระ: โอน\n
  // ลูกค้าชำระเงิน: 15400\nชำระเงินเรียบร้อย") — ต้องมีเลขคิว + วลีแจ้งจ่ายเงินแล้ว
  // จริง ๆ (paid_confirmed) และไม่มีทั้งชื่อลูกค้าและรายการสินค้า ไม่งั้นถือว่าเป็น
  // ข้อความเปิดบิลใหม่/แก้ไขบิลตามปกติที่แค่ลืมกรอกชื่อ (ให้ตกไปคืน null ข้างล่าง
  // เหมือนเดิม ไม่ใช่ตีความเป็นคำสั่งปิดบิลผิด ๆ)
  if (!result.customer_name && result.queue_no && result.paid_confirmed && itemSectionStartIndex < 0) {
    return {
      close_only: true,
      queue_no: result.queue_no,
      payment_method: result.payment_method,
      paid_amount: result.paid_amount,
      paid_confirmed: true,
    };
  }

  if (!result.customer_name) return null;
  return result;
}

module.exports = parseLineQueueMessage;
// เผยแพร่ formatPhone ให้ที่อื่นเรียกใช้ได้ด้วย — ทุกจุดที่เขียนคอลัมน์ phone ของ
// customers (customers.routes.js, quotation-customers.routes.js) ต้อง normalize
// ด้วยฟังก์ชันเดียวกันนี้เสมอ ไม่งั้นการค้นหาลูกค้าด้วย `WHERE phone = ?` แบบตรง ๆ
// ใน lineWebhook.routes.js (createQuotationFromQueue) จะหาไม่เจอเบอร์ที่พิมพ์ผ่าน
// หน้าเว็บแบบไม่มีขีด กลายเป็นสร้างลูกค้าซ้ำซ้อนโดยไม่ตั้งใจ
module.exports.formatPhone = formatPhone;
