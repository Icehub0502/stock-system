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

// รวมยอดตามช่องทางจากรายการบิล → [{ method, bill_count, total }] เรียงตามช่องทางมาตรฐาน
// ตามด้วยค่าอื่นที่เหลือ (บิลเก่าที่เป็น "โอน"/"QRCode") และ "ไม่ระบุ" ท้ายสุด
export function summarizeByMethod(receipts) {
  const map = new Map();
  for (const r of receipts) {
    const key = r.payment_method || UNSPECIFIED_METHOD;
    const cur = map.get(key) || { method: key, bill_count: 0, total: 0 };
    cur.bill_count += 1;
    cur.total += Number(r.total_amount || 0);
    map.set(key, cur);
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
