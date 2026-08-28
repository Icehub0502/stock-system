// ทะเบียนกลาง: ทุกข้อความที่บอทไลน์ทั้ง 3 ตัวตอบกลับ/ส่งเข้ากลุ่มได้ — เจ้าของร้าน
// แก้ไขข้อความแต่ละอันได้จากหน้าตั้งค่า (SettingsPage.jsx) โดยที่ยังใช้ placeholder
// {{key}} แทนค่าจริงที่คำนวณตอนรันได้เหมือนเดิม (ดู renderTemplate ใน
// lineWebhook.routes.js) ไม่มีฟังก์ชัน/require อะไรในไฟล์นี้เลย เพื่อกันปัญหา
// circular require (bot1/bot2/bot3/settings.routes.js ต่าง import ไฟล์นี้ไปใช้)
//
// key เดิม (line_template_blank/line_template_filled) คงชื่อเดิมไว้ กันข้อมูลที่
// เจ้าของร้านอาจตั้งค่าไปแล้วก่อนหน้านี้หายไปเงียบ ๆ ตอน deploy รอบนี้
//
// group: ใช้จัดกลุ่มแสดงผลที่หน้าตั้งค่าเป็น "บอท 1/2/3" ให้ตรงกับที่พนักงานคุ้นเคย
const LINE_MESSAGE_DEFAULTS = {
  // ── บอท 1 "รับรถ" ──────────────────────────────────────────────
  line_template_blank: {
    group: 'bot1',
    label: 'เทมเพลตว่าง (ตอนพิมพ์ "คิว")',
    vars: '{{queue_no}}, {{date}}',
    default: [
      'คิว {{queue_no}}',
      '{{date}}',
      'ชื่อ:',
      'เบอโทรศัพท์:',
      'ยี่ห้อรถ:',
      'รุ่นรถ:',
      'ทะเบียนรถ:',
      'สีรถ:',
      'เลขไมค์:',
      'อาการ:',
      'รายการ:',
      '',
      '<--สิ้นสุดรายการ-->',
      'ยอดรวม:',
      'มัดจำ:',
      'วันที่มัดจำ:',
      'วันนัดหมาย:',
      'หมายเหตุ:',
      '',
      '<--ลูกค้าชำระเงิน-->',
      'ช่องทางการชำระ (โอน/บัตรเครดิต/เงินสด/QRCode):',
      'ลูกค้าชำระเงิน (ยอดที่ได้รับจริง):',
    ].join('\n'),
  },
  bot1_success_base: {
    group: 'bot1',
    label: 'สร้าง/แก้ไขใบเสนอราคาสำเร็จ — ข้อความหลัก',
    vars: '{{verb}}, {{quotation_no}}, {{queue_no}}, {{customer_name}}, {{plate_suffix}}',
    default: '✅ {{verb}} {{quotation_no}} แล้ว\nคิว {{queue_no}} · {{customer_name}}{{plate_suffix}}\nคัดลอกลงกลุ่ม "รายการ" ได้เลยครับ',
  },
  bot1_success_note: {
    group: 'bot1',
    label: 'สร้าง/แก้ไขสำเร็จ — มีข้อความเพิ่มเติมนอกรายการ',
    vars: '(ไม่มี)',
    default: '\n📝 มีข้อความเพิ่มเติมที่ไม่ได้แยกเป็นรายการ ดูในหมายเหตุของใบเสนอราคา',
  },
  bot1_success_mismatch: {
    group: 'bot1',
    label: 'สร้าง/แก้ไขสำเร็จ — ยอดที่แจ้งไม่ตรงกับผลรวมรายการ',
    vars: '{{stated_total}}, {{total_amount}}',
    default: '\n⚠️ ยอดที่แจ้งในไลน์ ({{stated_total}} บาท) ไม่ตรงกับผลรวมรายการ ({{total_amount}} บาท) กรุณาตรวจสอบ',
  },
  bot1_success_reassigned: {
    group: 'bot1',
    label: 'สร้าง/แก้ไขสำเร็จ — เลขคิวชนกัน เปลี่ยนให้อัตโนมัติ',
    vars: '{{from}}, {{to}}',
    default: '\n⚠️ คิวที่ {{from}} มีแล้ววันนี้ เปลี่ยนเป็นคิว {{to}} ให้อัตโนมัติ',
  },
  bot1_success_synced_receipt: {
    group: 'bot1',
    label: 'สร้าง/แก้ไขสำเร็จ — ใบเสร็จที่อนุมัติไว้แล้วถูกแก้ตามด้วย',
    vars: '(ไม่มี)',
    default: '\n🧾 ใบเสร็จที่อนุมัติไว้แล้วถูกแก้ตามด้วย กรุณาพิมพ์ใหม่',
  },
  bot1_success_payment_closed: {
    group: 'bot1',
    label: 'สร้าง/แก้ไขสำเร็จ — ปิดบิลไปในตัว (มีวลีแจ้งจ่ายเงินมาด้วย)',
    vars: '{{payment_method}}, {{amount}}, {{receipt_no}}',
    default: '\n💰 รับชำระแล้ว ({{payment_method}} {{amount}} บาท) — ปิดบิล ใบเสร็จ {{receipt_no}}',
  },
  bot1_success_payment_no_items: {
    group: 'bot1',
    label: 'สร้าง/แก้ไขสำเร็จ — แจ้งจ่ายเงินมาแล้วแต่ยังไม่มีรายการ ปิดบิลไม่ได้',
    vars: '(ไม่มี)',
    default: '\n⚠️ แจ้งชำระเงินมาแล้วแต่ยังไม่มีรายการสินค้า สร้างใบเสร็จไม่ได้ กรุณาเพิ่มรายการก่อน',
  },
  bot1_success_payment_no_vehicle: {
    group: 'bot1',
    label: 'สร้าง/แก้ไขสำเร็จ — แจ้งจ่ายเงินมาแล้วแต่ยังไม่มีข้อมูลรถ ปิดบิลไม่ได้',
    vars: '(ไม่มี)',
    default: '\n⚠️ แจ้งชำระเงินมาแล้วแต่ยังไม่มีข้อมูลรถ สร้างใบเสร็จไม่ได้ กรุณาเพิ่มข้อมูลรถก่อน',
  },
  bot1_success_deposit_mismatch: {
    group: 'bot1',
    label: 'สร้าง/แก้ไขสำเร็จ — ยอดมัดจำมากกว่ายอดรวมที่แจ้ง',
    vars: '{{deposit_amount}}, {{expected}}',
    default: '\n⚠️ ยอดมัดจำ ({{deposit_amount}} บาท) มากกว่ายอดรวมที่แจ้ง ({{expected}} บาท) กรุณาตรวจสอบ',
  },
  bot1_success_remaining: {
    group: 'bot1',
    label: 'สร้าง/แก้ไขสำเร็จ — มัดจำแล้ว ยังไม่ปิดบิล (บอกยอดที่เหลือ)',
    vars: '{{remaining}}',
    default: '\n💵 เหลือชำระ {{remaining}} บาท',
  },
  bot1_success_appointment: {
    group: 'bot1',
    label: 'สร้าง/แก้ไขสำเร็จ — บันทึกวันนัดหมายแล้ว',
    vars: '{{date}}',
    default: '\n📅 บันทึกวันนัดหมาย {{date}} แล้ว',
  },
  bot1_create_failed: {
    group: 'bot1',
    label: 'สร้าง/แก้ไขใบเสนอราคาไม่สำเร็จ (เกิด error)',
    vars: '{{queue_no}}',
    default: '❌ สร้างใบเสนอราคาไม่สำเร็จ (คิว {{queue_no}}) กรุณาสร้างเองในระบบ',
  },
  bot1_closed_bill_match: {
    group: 'bot1',
    label: 'พิมพ์เลขคิวที่ตรงกับบิลที่ปิดไปแล้ว',
    vars: '{{queue_no}}, {{customer_name}}',
    default: '⚠️ บิลนี้ปิดแล้ว (คิว {{queue_no}} ของ {{customer_name}}) หากเป็นงานใหม่กรุณาขอเลขคิวใหม่ด้วยการพิมพ์ "คิว"',
  },
  bot1_close_not_found: {
    group: 'bot1',
    label: 'ปิดบิลด้วยข้อความสั้น — ไม่พบบิลที่เปิดอยู่',
    vars: '{{queue_no}}',
    default: '⚠️ ไม่พบบิลที่เปิดอยู่สำหรับคิว {{queue_no}} กรุณาตรวจสอบเลขคิว',
  },
  bot1_close_ambiguous: {
    group: 'bot1',
    label: 'ปิดบิลด้วยข้อความสั้น — เจอหลายบิล ไม่แน่ใจจะปิดใบไหน',
    vars: '{{queue_no}}, {{list}}',
    default: '⚠️ คิว {{queue_no}} มีหลายบิลที่เปิดอยู่ ไม่แน่ใจว่าจะปิดใบไหน กรุณาปิดผ่านแอปแทน:\n{{list}}',
  },
  bot1_close_no_vehicle: {
    group: 'bot1',
    label: 'ปิดบิลด้วยข้อความสั้น — ยังไม่มีข้อมูลรถ',
    vars: '{{queue_no}}, {{quotation_no}}',
    default: '⚠️ คิว {{queue_no}} ({{quotation_no}}) ยังไม่มีข้อมูลรถ สร้างใบเสร็จไม่ได้ กรุณาเพิ่มข้อมูลรถก่อน',
  },
  bot1_close_no_items: {
    group: 'bot1',
    label: 'ปิดบิลด้วยข้อความสั้น — ยังไม่มีรายการสินค้า',
    vars: '{{queue_no}}, {{quotation_no}}',
    default: '⚠️ คิว {{queue_no}} ({{quotation_no}}) ยังไม่มีรายการสินค้า สร้างใบเสร็จไม่ได้ กรุณาเพิ่มรายการก่อน',
  },
  bot1_close_success: {
    group: 'bot1',
    label: 'ปิดบิลด้วยข้อความสั้น — สำเร็จ',
    vars: '{{quotation_no}}, {{queue_no}}, {{customer_name}}, {{payment_method}}, {{amount}}, {{receipt_no}}',
    default: '✅ ปิดบิล {{quotation_no}} แล้ว\nคิว {{queue_no}} · {{customer_name}}\n💰 รับชำระแล้ว ({{payment_method}} {{amount}} บาท) — ใบเสร็จ {{receipt_no}}',
  },
  bot1_close_failed: {
    group: 'bot1',
    label: 'ปิดบิลด้วยข้อความสั้น — เกิด error',
    vars: '{{queue_no}}',
    default: '❌ ปิดบิลไม่สำเร็จ (คิว {{queue_no}}) กรุณาปิดเองในระบบ',
  },

  // ── บอท 2 "รับรายการ" ──────────────────────────────────────────
  bot2_not_found: {
    group: 'bot2',
    label: 'ไม่พบใบเสนอราคาที่เปิดอยู่สำหรับเลขคิวนี้',
    vars: '{{queue_no}}',
    default: '⚠️ ไม่พบใบเสนอราคาที่เปิดอยู่สำหรับคิว {{queue_no}} กรุณาตรวจสอบเลขคิว',
  },
  bot2_no_items_yet: {
    group: 'bot2',
    label: 'เจอบิลแล้วแต่ยังไม่มีรายการอะไหล่ส่งมา',
    vars: '{{header}}',
    default: '🔄 รอรับรายการของ {{header}}\nเพิ่มรายการที่ช่อง "รายการ: " ได้เลยครับ',
  },
  bot2_saved: {
    group: 'bot2',
    label: 'บันทึกรายการสำเร็จ',
    vars: '{{verb}}, {{header}}, {{item_count}}, {{total}}, {{synced_receipt_line}}',
    default: '✅ {{verb}}\n{{header}}\nรายการ {{item_count}} ชิ้น รวม {{total}} บาท{{synced_receipt_line}}\n❗ ตรวจสอบใบเสนอราคา เพื่อความถูกต้องด้วยนะครับ ❗\nตรวจเช็คเรียบร้อยแล้ว คัดลอกและส่งลงกลุ่ม "สรุปบิล" ได้เลยครับ',
  },
  bot2_saved_verb_new: {
    group: 'bot2',
    label: 'บันทึกรายการสำเร็จ — คำกริยา (ลงรายการครั้งแรก)',
    vars: '(ไม่มี)',
    default: 'เพิ่มรายการเรียบร้อยครับ',
  },
  bot2_saved_verb_edit: {
    group: 'bot2',
    label: 'บันทึกรายการสำเร็จ — คำกริยา (แก้ไขรายการเดิม)',
    vars: '(ไม่มี)',
    default: 'แก้ไขรายการเรียบร้อยแล้วครับ',
  },
  bot2_saved_synced_receipt: {
    group: 'bot2',
    label: 'บันทึกรายการสำเร็จ — ใบเสร็จที่อนุมัติไว้แล้วถูกแก้ตามด้วย',
    vars: '(ไม่มี)',
    default: '\n🧾 ใบเสร็จที่อนุมัติไว้แล้วถูกแก้ตามด้วย',
  },
  bot2_save_failed: {
    group: 'bot2',
    label: 'บันทึกรายการไม่สำเร็จ (เกิด error)',
    vars: '{{queue_no}}',
    default: '❌ บันทึกรายการไม่สำเร็จ (คิว {{queue_no}}) กรุณาลงรายการผ่านแอปแทน',
  },

  // ── บอท 3 "ปิดบิล" ────────────────────────────────────────────
  bot3_amount_missing: {
    group: 'bot3',
    label: 'ตรวจยอด — ยังไม่ได้กรอก "ยอดรวม:"',
    vars: '{{header}}, {{computed_total}}',
    default: '⚠️ {{header}}\nยังไม่ได้กรอก "ยอดรวม:" ครับ ยอดที่คำนวณจากรายการได้ {{computed_total}} บาท กรุณาตรวจสอบและกรอกยอดรวมก่อนแจ้งลูกค้า',
  },
  bot3_amount_match: {
    group: 'bot3',
    label: 'ตรวจยอด — ยอดตรงกัน',
    vars: '{{header}}, {{computed_total}}',
    default: '✅ {{header}}\nยอดตรงกันครับ รวม {{computed_total}} บาท',
  },
  bot3_amount_mismatch: {
    group: 'bot3',
    label: 'ตรวจยอด — ยอดไม่ตรงกัน',
    vars: '{{header}}, {{computed_total}}, {{stated_total}}',
    default: '❌ {{header}}\nยอดไม่ตรงกัน! รายการรวมได้ {{computed_total}} บาท แต่กรอก "ยอดรวม:" ไว้ {{stated_total}} บาท กรุณาตรวจสอบก่อนแจ้งลูกค้า',
  },
  bot3_close_not_found: {
    group: 'bot3',
    label: 'ปิดบิล — ไม่พบบิลที่เปิดอยู่',
    vars: '{{queue_no}}',
    default: '⚠️ ไม่พบบิลที่เปิดอยู่สำหรับคิว {{queue_no}} กรุณาตรวจสอบเลขคิว',
  },
  bot3_close_ambiguous: {
    group: 'bot3',
    label: 'ปิดบิล — เจอหลายบิล ไม่แน่ใจจะปิดใบไหน',
    vars: '{{queue_no}}, {{list}}',
    default: '⚠️ คิว {{queue_no}} มีหลายบิลที่เปิดอยู่ ไม่แน่ใจว่าจะปิดใบไหน กรุณาปิดผ่านแอปแทน:\n{{list}}',
  },
  bot3_close_no_vehicle: {
    group: 'bot3',
    label: 'ปิดบิล — ยังไม่มีข้อมูลรถ',
    vars: '{{queue_no}}, {{quotation_no}}',
    default: '⚠️ คิว {{queue_no}} ({{quotation_no}}) ยังไม่มีข้อมูลรถ สร้างใบเสร็จไม่ได้ กรุณาเพิ่มข้อมูลรถก่อน',
  },
  bot3_close_no_items: {
    group: 'bot3',
    label: 'ปิดบิล — ยังไม่มีรายการสินค้า',
    vars: '{{queue_no}}, {{quotation_no}}',
    default: '⚠️ คิว {{queue_no}} ({{quotation_no}}) ยังไม่มีรายการสินค้า สร้างใบเสร็จไม่ได้ กรุณาเพิ่มรายการก่อน',
  },
  bot3_close_success: {
    group: 'bot3',
    label: 'ปิดบิล — สำเร็จ',
    vars: '{{quotation_no}}, {{queue_no}}, {{customer_name}}, {{payment_method}}, {{amount}}, {{receipt_no}}',
    default: '✅ ปิดบิล {{quotation_no}} เรียบร้อยแล้วตรับ\nคิว {{queue_no}} · {{customer_name}}\n💰 รับชำระแล้ว ({{payment_method}} {{amount}} บาท) — ใบเสร็จ {{receipt_no}}',
  },
  bot3_close_failed: {
    group: 'bot3',
    label: 'ปิดบิล — เกิด error',
    vars: '{{queue_no}}',
    default: '❌ ปิดบิลไม่สำเร็จ (คิว {{queue_no}}) กรุณาปิดเองในระบบ',
  },
};

module.exports = { LINE_MESSAGE_DEFAULTS };
