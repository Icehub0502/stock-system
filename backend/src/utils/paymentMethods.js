// ช่องทางชำระเงินของร้าน — ต้องตรงกับ frontend/src/utils/paymentMethods.js
const PAYMENT_METHODS = ['ออมสิน', 'คลิก', 'JPM', 'เงินสด', 'บัตรเครดิต'];

// คำที่พนักงานพิมพ์มาในไลน์ → ชื่อช่องทางมาตรฐาน (เทียบแบบตัดช่องว่าง/ไม่สนตัวใหญ่เล็ก)
const ALIASES = {
  ออมสิน: 'ออมสิน',
  gsb: 'ออมสิน',
  คลิก: 'คลิก',
  click: 'คลิก',
  jpm: 'JPM',
  เงินสด: 'เงินสด',
  cash: 'เงินสด',
  บัตรเครดิต: 'บัตรเครดิต',
  บัตร: 'บัตรเครดิต',
  credit: 'บัตรเครดิต',
  creditcard: 'บัตรเครดิต',
};

// ค่าที่ไม่รู้จัก (เช่น "โอน"/"QRCode" ของบิลเก่า) คงข้อความเดิมไว้ ให้แก้เองทีหลังได้
function normalizePaymentMethod(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const compact = value.toLowerCase().replace(/\s+/g, '');
  return ALIASES[compact] || value;
}

module.exports = { PAYMENT_METHODS, normalizePaymentMethod };
