// The shop's payment methods (banks, cash, card). Each branch keeps its own list in app_settings ('payment_methods');
// a branch that never set one uses this default — keep it the same as frontend/src/utils/paymentMethods.js
const PAYMENT_METHODS = ['ออมสิน', 'คลิก', 'JPM', 'เงินสด', 'บัตรเครดิต'];
const DEFAULT_PAYMENT_METHODS = PAYMENT_METHODS;
const SETTING_KEY = 'payment_methods';
const MAX_METHODS = 12;
const MAX_NAME_LENGTH = 30;

// Words staff type for the same method. A typed word finds the shop's method in its group, whatever the shop named it
// ("kbank" → the shop's "กสิกร"). Written in keyOf form.
const ALIAS_GROUPS = [
  ['ออมสิน', 'gsb', 'mymo'],
  ['กสิกร', 'กสิกรไทย', 'kbank', 'kplus'],
  ['ไทยพาณิชย์', 'ไทยพานิชย์', 'ไทยพานิช', 'scb'],
  ['กรุงเทพ', 'bbl', 'บัวหลวง'],
  ['กรุงไทย', 'ktb'],
  ['กรุงศรี', 'กรุงศรีอยุธยา', 'bay', 'krungsri'],
  ['ทีทีบี', 'ttb', 'ทหารไทย', 'ทหารไทยธนชาต', 'ธนชาต'],
  ['ธอส', 'ghb', 'อาคารสงเคราะห์'],
  ['ธกส', 'baac'],
  ['ยูโอบี', 'uob'],
  ['พร้อมเพย์', 'promptpay'],
  ['คลิก', 'click'],
  ['jpm'],
  ['เงินสด', 'cash'],
  ['บัตรเครดิต', 'บัตร', 'credit', 'creditcard'],
  ['โอน', 'โอนเงิน', 'transfer'],
];

// compare form: no case, no spaces or dots, no leading "ธนาคาร"/"ธ."
function keyOf(name) {
  return String(name ?? '').trim().toLowerCase()
    .replace(/^ธนาคาร|^ธ\.\s*/, '')
    .replace(/[\s.]/g, '');
}

// the shop's method a typed word means, or null
function matchMethod(name, methods) {
  const key = keyOf(name);
  if (!key) return null;
  const direct = methods.find((m) => keyOf(m) === key);
  if (direct) return direct;
  const group = ALIAS_GROUPS.find((g) => g.includes(key));
  if (!group) return null;
  return methods.find((m) => group.includes(keyOf(m))) || null;
}

// A method name goes into the LINE template "ช่องทางการชำระ (a/b/c):" and into "เงินสด 500 + กสิกร 500", so it may
// not hold what those use: + & , / ( ) : digits, or the word "และ"
function validatePaymentMethods(input) {
  if (!Array.isArray(input)) return { error: 'รายการช่องทางชำระไม่ถูกต้อง' };
  const methods = input.map((m) => (typeof m === 'string' ? m.trim().replace(/\s+/g, ' ') : ''));
  if (methods.length === 0) return { error: 'ต้องมีช่องทางชำระอย่างน้อย 1 ช่องทาง' };
  if (methods.length > MAX_METHODS) return { error: `ช่องทางชำระมีได้ไม่เกิน ${MAX_METHODS} ช่องทาง` };
  const seen = [];
  for (const m of methods) {
    if (!m) return { error: 'ชื่อช่องทางชำระว่างไม่ได้' };
    if (m.length > MAX_NAME_LENGTH) return { error: `ชื่อ "${m}" ยาวเกิน ${MAX_NAME_LENGTH} ตัวอักษร` };
    if (/[+&,/():\d]/.test(m) || m.includes('และ')) {
      return { error: `ชื่อ "${m}" ห้ามมีตัวเลข เครื่องหมาย + & , / ( ) : หรือคำว่า "และ"` };
    }
    const clash = seen.find((other) => matchMethod(m, [other]));
    if (clash) return { error: `"${m}" ซ้ำกับ "${clash}"` };
    seen.push(m);
  }
  return { methods };
}

async function getShopPaymentMethods(db, shopId) {
  try {
    const [[row]] = await db.query('SELECT value FROM app_settings WHERE shop_id = ? AND `key` = ?', [shopId, SETTING_KEY]);
    if (!row) return [...DEFAULT_PAYMENT_METHODS];
    const result = validatePaymentMethods(JSON.parse(row.value));
    return result.methods || [...DEFAULT_PAYMENT_METHODS];
  } catch (err) {
    console.error('Error reading payment methods:', err);
    return [...DEFAULT_PAYMENT_METHODS];
  }
}

async function setShopPaymentMethods(db, shopId, methods) {
  await db.execute(
    'INSERT INTO app_settings (shop_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [shopId, SETTING_KEY, JSON.stringify(methods)]
  );
}

// What a bill may be paid by when edited on the web: the shop's methods now, plus what the bill already has (a bill
// paid by a bank the shop has since dropped must stay editable)
async function allowedMethodsForReceipt(db, shopId, receiptId) {
  const methods = await getShopPaymentMethods(db, shopId);
  const [[receipt]] = await db.query('SELECT payment_method FROM receipts WHERE id = ? AND shop_id = ?', [receiptId, shopId]);
  const [rows] = await db.query('SELECT method FROM receipt_payments WHERE receipt_id = ?', [receiptId]);
  const existing = rows.map((r) => r.method);
  if (receipt && receipt.payment_method && !receipt.payment_method.includes('+')) existing.push(receipt.payment_method);
  for (const m of existing) if (!methods.includes(m)) methods.push(m);
  return methods;
}

// The LINE template line "ช่องทางการชำระ (…):" lists the shop's methods: {{payment_methods}}, or the list in brackets of
// a template the owner wrote out by hand
function fillPaymentMethods(template, methods) {
  const list = methods.join('/');
  return String(template)
    .replace(/\{\{\s*payment_methods\s*\}\}/g, list)
    .replace(/ช่องทางการชำระ\s*\([^)\n]*\)/g, `ช่องทางการชำระ (${list})`);
}

// จ่ายหลายช่องทางในบิลเดียวพิมพ์เป็น "เงินสด 5000 + บัตรเครดิต 5000" (คั่นด้วย + & และ หรือ
// คอมมาที่ตามด้วยตัวอักษร — คอมมาในตัวเลข 5,000 ไม่นับเป็นตัวคั่น)
const SEPARATOR_RE = /\s*(?:\+|&|และ|,(?!\d))\s*/;
const TOKEN_RE = /^(.*?)\s*(\d[\d,]*(?:\.\d+)?)?\s*(?:บาท)?$/;


// "เงินสด 5000 + บัตรเครดิต 5000" → [{ method, amount|null }] ; ไม่ใช่รูปแบบหลายช่องทาง
// (มีไม่ถึง 2 ช่อง หรือมีชื่อที่ไม่รู้จัก) คืน [] ให้ผู้เรียกถือเป็นช่องทางเดียวตามเดิม
function parseSplitsFromText(raw, methods = DEFAULT_PAYMENT_METHODS) {
  const tokens = String(raw ?? '').trim().split(SEPARATOR_RE).filter(Boolean);
  if (tokens.length < 2) return [];
  const splits = [];
  for (const token of tokens) {
    const m = TOKEN_RE.exec(token.trim());
    const method = m && matchMethod(m[1], methods);
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
function normalizePaymentMethod(raw, methods = DEFAULT_PAYMENT_METHODS) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const splits = parseSplitsFromText(value, methods);
  if (splits.length >= 2) return summarizeSplits(splits);
  return matchMethod(value, methods) || value;
}

// The parser reads a LINE message before it knows the branch, so it names methods by the default list. Once the branch
// is known, name them by that branch's list ("กสิกร 500 + เงินสด 500" only splits where กสิกร is a method).
async function localizeParsedPayment(db, parsed, shopId) {
  if (!parsed || !parsed.payment_method) return parsed;
  const methods = await getShopPaymentMethods(db, shopId);
  parsed.payment_method = normalizePaymentMethod(parsed.payment_method, methods);
  parsed.payment_splits = parseSplitsFromText(parsed.payment_method, methods);
  parsed.payment_methods = methods;
  return parsed;
}

function money(n) {
  return Math.round(Number(n) * 100) / 100;
}

// ตรวจ/เติมยอดของแต่ละช่องทางให้รวมเท่ายอดบิล — ช่องที่ไม่ใส่ยอด (มีได้ช่องเดียว) ได้ส่วนที่เหลือ
// คืน { splits } หรือ { error }
function resolveSplits(splits, total, methods = DEFAULT_PAYMENT_METHODS) {
  const t = money(total);
  const seen = new Set();
  for (const s of splits) {
    if (!methods.includes(s.method)) return { error: `ช่องทางชำระไม่ถูกต้อง: ${s.method}` };
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
async function applyReceiptSplits(conn, receiptId, splits, total, { strict = true, methods = DEFAULT_PAYMENT_METHODS } = {}) {
  await conn.execute('DELETE FROM receipt_payments WHERE receipt_id = ?', [receiptId]);
  if (!splits || splits.length < 2) return [];
  const result = resolveSplits(splits, total, methods);
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
  DEFAULT_PAYMENT_METHODS,
  validatePaymentMethods,
  getShopPaymentMethods,
  setShopPaymentMethods,
  allowedMethodsForReceipt,
  fillPaymentMethods,
  localizeParsedPayment,
  normalizePaymentMethod,
  parseSplitsFromText,
  summarizeSplits,
  resolveSplits,
  applyReceiptSplits,
};
