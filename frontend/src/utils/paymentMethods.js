// ช่องทางชำระเงินของร้าน — ต้องตรงกับ backend/src/utils/paymentMethods.js
export const PAYMENT_METHODS = ['ออมสิน', 'คลิก', 'JPM', 'เงินสด', 'บัตรเครดิต'];

export const PAYMENT_METHOD_CLASS = {
  'ออมสิน': 'pay-chip-gsb',
  'คลิก': 'pay-chip-click',
  'JPM': 'pay-chip-jpm',
  'เงินสด': 'pay-chip-cash',
  'บัตรเครดิต': 'pay-chip-credit',
};

export const UNSPECIFIED_METHOD = 'ไม่ระบุ';

const EXTRA_CLASSES = ['pay-chip-p0', 'pay-chip-p1', 'pay-chip-p2', 'pay-chip-p3', 'pay-chip-p4', 'pay-chip-p5'];

// A chip colour for any method: the fixed colours above, and for a bank a branch added (กสิกร, ไทยพาณิชย์…) one picked
// from its name, so it keeps the same colour on every screen
export function paymentMethodClass(method) {
  if (PAYMENT_METHOD_CLASS[method]) return PAYMENT_METHOD_CLASS[method];
  if (!method || method === UNSPECIFIED_METHOD) return 'pay-chip-other';
  let hash = 0;
  for (const ch of String(method)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return EXTRA_CLASSES[hash % EXTRA_CLASSES.length];
}

// รวมยอดตามช่องทางจากรายการบิล → [{ method, bill_count, total }] เรียงตามช่องทางมาตรฐาน
// ตามด้วยค่าอื่นที่เหลือ (บิลเก่าที่เป็น "โอน"/"QRCode") และ "ไม่ระบุ" ท้ายสุด
export function summarizeByMethod(receipts) {
  const map = new Map();
  const add = (key, amount) => {
    const cur = map.get(key) || { method: key, bill_count: 0, total: 0 };
    cur.bill_count += 1;
    cur.total += Number(amount || 0);
    map.set(key, cur);
  };
  for (const r of receipts) {
    // บิลที่แบ่งจ่ายหลายช่องทางนับยอดตามที่แบ่งไว้ ส่วนบิลช่องทางเดียวใช้ยอดบิลทั้งก้อน
    if (Array.isArray(r.payments) && r.payments.length > 0) {
      for (const p of r.payments) add(p.method, p.amount);
    } else {
      add(r.payment_method || UNSPECIFIED_METHOD, r.total_amount);
    }
  }
  return orderMethods(Array.from(map.values()));
}

// แปลง by_method ที่ backend ส่งมา ({ method: { bill_count, total } }) ให้เป็นรายการเดียวกัน
export function methodsFromObject(byMethod) {
  const list = Object.entries(byMethod || {}).map(([method, v]) => ({
    method,
    bill_count: Number(v.bill_count || 0),
    total: Number(v.total || 0),
  }));
  return orderMethods(list);
}

// รวมหลายวันเข้าด้วยกัน (ใช้กับยอดเดือนบนแดชบอร์ด)
export function mergeByMethod(objects) {
  const out = {};
  for (const obj of objects) {
    for (const [method, v] of Object.entries(obj || {})) {
      const cur = out[method] || { bill_count: 0, total: 0 };
      cur.bill_count += Number(v.bill_count || 0);
      cur.total += Number(v.total || 0);
      out[method] = cur;
    }
  }
  return out;
}

function orderMethods(list) {
  const rank = (m) => {
    const i = PAYMENT_METHODS.indexOf(m);
    if (i >= 0) return i;
    return m === UNSPECIFIED_METHOD ? 1000 : 100;
  };
  return list.sort((a, b) => rank(a.method) - rank(b.method) || a.method.localeCompare(b.method));
}
