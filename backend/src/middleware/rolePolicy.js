// Two roles that do not fit the "higher role can do everything lower ones can" ladder of auth.js. They sit on the ladder
// for what they may open, and this file takes away what they must not do, checked on every signed-in request.
//
// accountant (บัญชี): sees everything a manager sees and changes nothing. Anything not listed here is refused, so a new
//   route is safe by default.
// sales (ฝ่ายขาย): daily sales work like office (customers, quotations, receipts, queue, claims), but does not move stock
//   or see what parts cost.

const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];

const ACCOUNTANT_MAY_WRITE = [
  /^\/api\/auth\/change-password$/,
  /^\/api\/(receipts|quotations)\/\d+\/mark-printed$/, // printing a document only records that it was printed
];

const SALES_MAY_NOT_WRITE = [
  /^\/api\/stock-items(\/|$)/,
  /^\/api\/stock-receive(\/|$)/,
  /^\/api\/stock-deductions(\/|$)/,
  /^\/api\/transactions(\/|$)/,
  /^\/api\/suppliers(\/|$)/,
  /^\/api\/claims\/\d+\/parts\/deduct$/,
];

const SALES_MAY_NOT_READ = [
  /^\/api\/stock-receive\/costs(\/|$)/,
  /^\/api\/suppliers(\/|$)/,
];

// Returns the message to refuse with, or null when the role may make this request
function roleRefusal(role, method, url) {
  const path = String(url).split('?')[0].replace(/\/+$/, '');
  const reading = READ_METHODS.includes(method);
  if (role === 'accountant' && !reading && !ACCOUNTANT_MAY_WRITE.some((re) => re.test(path))) {
    return 'บัญชีดูข้อมูลได้อย่างเดียว ไม่สามารถแก้ไขได้';
  }
  if (role === 'sales') {
    const rules = reading ? SALES_MAY_NOT_READ : SALES_MAY_NOT_WRITE;
    if (rules.some((re) => re.test(path))) return 'ฝ่ายขายไม่มีสิทธิ์ทำรายการสต๊อก';
  }
  return null;
}

module.exports = { roleRefusal };
