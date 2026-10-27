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

// จ่ายหลายช่องทางในบิลเดียวพิมพ์เป็น "เงินสด 5000 + บัตรเครดิต 5000" (คั่นด้วย + & และ หรือ
// คอมมาที่ตามด้วยตัวอักษร — คอมมาในตัวเลข 5,000 ไม่นับเป็นตัวคั่น)
const SEPARATOR_RE = /\s*(?:\+|&|และ|,(?!\d))\s*/;
const TOKEN_RE = /^(.*?)\s*(\d[\d,]*(?:\.\d+)?)?\s*(?:บาท)?$/;

function aliasOf(name) {
  return ALIASES[String(name).toLowerCase().replace(/\s+/g, '')] || null;
}

// "เงินสด 5000 + บัตรเครดิต 5000" → [{ method, amount|null }] ; ไม่ใช่รูปแบบหลายช่องทาง
// (มีไม่ถึง 2 ช่อง หรือมีชื่อที่ไม่รู้จัก) คืน [] ให้ผู้เรียกถือเป็นช่องทางเดียวตามเดิม
function parseSplitsFromText(raw) {
  const tokens = String(raw ?? '').trim().split(SEPARATOR_RE).filter(Boolean);
  if (tokens.length < 2) return [];
  const splits = [];
  for (const token of tokens) {
    const m = TOKEN_RE.exec(token.trim());
    const method = m && aliasOf(m[1]);
    if (!method) return [];
    const amount = m[2] ? Number(m[2].replace(/,/g, '')) : null;
    if (amount !== null && !Number.isFinite(amount)) return [];
    splits.push({ method, amount });
  }
  return splits;
}

function summarizeSplits(splits) {
  return splits.map((s) => (s.amount == null ? s.method : `${s.method} ${Number(s.amount)}`)).join(' + ');
}

// ค่าที่ไม่รู้จัก (เช่น "โอน"/"QRCode" ของบิลเก่า) คงข้อความเดิมไว้ ให้แก้เองทีหลังได้
function normalizePaymentMethod(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const splits = parseSplitsFromText(value);
  if (splits.length >= 2) return summarizeSplits(splits);
  return aliasOf(value) || value;
}

function money(n) {
  return Math.round(Number(n) * 100) / 100;
}

// ตรวจ/เติมยอดของแต่ละช่องทางให้รวมเท่ายอดบิล — ช่องที่ไม่ใส่ยอด (มีได้ช่องเดียว) ได้ส่วนที่เหลือ
// คืน { splits } หรือ { error }
function resolveSplits(splits, total) {
  const t = money(total);
  const seen = new Set();
  for (const s of splits) {
    if (!PAYMENT_METHODS.includes(s.method)) return { error: `ช่องทางชำระไม่ถูกต้อง: ${s.method}` };
    if (seen.has(s.method)) return { error: `ช่องทาง ${s.method} ซ้ำกัน` };
    seen.add(s.method);
    if (s.amount != null && !(Number(s.amount) > 0)) return { error: 'ยอดของแต่ละช่องทางต้องมากกว่า 0' };
  }
  const blanks = splits.filter((s) => s.amount == null);
  if (blanks.length > 1) return { error: 'ใส่ยอดได้เว้นว่างแค่ช่องทางเดียว' };
  const known = splits.reduce((sum, s) => sum + (s.amount == null ? 0 : Number(s.amount)), 0);
  const resolved = splits.map((s) => ({
    method: s.method,
    amount: s.amount == null ? money(t - known) : money(s.amount),
  }));
  if (resolved.some((s) => !(s.amount > 0))) return { error: 'ยอดรวมของช่องทางเกินยอดบิล' };
  const sum = money(resolved.reduce((a, s) => a + s.amount, 0));
  if (Math.abs(sum - t) > 0.01) {
    return { error: `ยอดรวมของช่องทางชำระ (${sum.toLocaleString('en-US')}) ไม่เท่ายอดบิล (${t.toLocaleString('en-US')})` };
  }
  return { splits: resolved };
}

// บันทึกการแบ่งช่องทางของบิล (ตาราง receipt_payments เก็บเฉพาะบิลที่จ่าย ≥ 2 ช่องทาง —
// บิลช่องทางเดียวใช้ receipts.payment_method ตามเดิม ยอดจึงตามยอดบิลเสมอ)
//   splits < 2 ช่อง → ล้างแถวเดิมทิ้ง (กลับเป็นช่องทางเดียว)
//   strict=true (เว็บ): ยอดไม่ตรง → throw error status 400
//   strict=false (ไลน์): ยอดไม่ตรง/ไม่ครบ → ไม่บันทึกแถว เก็บข้อความใน payment_method ไว้เฉย ๆ
//     ไม่ให้ปิดบิลล้มเพราะพนักงานพิมพ์ยอดผิด
async function applyReceiptSplits(conn, receiptId, splits, total, { strict = true } = {}) {
  await conn.execute('DELETE FROM receipt_payments WHERE receipt_id = ?', [receiptId]);
  if (!splits || splits.length < 2) return [];
  const result = resolveSplits(splits, total);
  if (result.error) {
    if (strict) {
      const err = new Error(result.error);
      err.status = 400;
      throw err;
    }
    return [];
  }
  for (const s of result.splits) {
    await conn.execute(
      'INSERT INTO receipt_payments (receipt_id, method, amount) VALUES (?, ?, ?)',
      [receiptId, s.method, s.amount]
    );
  }
  // tenant-ok: receiptId was just loaded/created inside the caller's shop-scoped transaction
  await conn.execute('UPDATE receipts SET payment_method = ? WHERE id = ?', [summarizeSplits(result.splits), receiptId]);
  return result.splits;
}

module.exports = {
  PAYMENT_METHODS,
  normalizePaymentMethod,
  parseSplitsFromText,
  summarizeSplits,
  resolveSplits,
  applyReceiptSplits,
};
